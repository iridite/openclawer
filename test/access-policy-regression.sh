#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
source "${TEST_DIR}/lib/server-test-helpers.sh"
READY_MAX_ATTEMPTS="${ACCESS_READY_MAX_ATTEMPTS:-20}"
READY_INTERVAL_SECONDS="${ACCESS_READY_INTERVAL_SECONDS:-0.1}"
HTTP_CONNECT_TIMEOUT_SECONDS="${ACCESS_CONNECT_TIMEOUT_SECONDS:-0.5}"
HTTP_MAX_TIME_SECONDS="${ACCESS_HTTP_MAX_TIME_SECONDS:-3}"

TMP_DIR="$(mktemp -d /tmp/oc-deploy-access-XXXXXX)"
MANAGEMENT_PORT="${ACCESS_MANAGEMENT_PORT:-$((23000 + RANDOM % 10000))}"
GATEWAY_PORT="${ACCESS_GATEWAY_PORT:-$((34000 + RANDOM % 10000))}"

export TRIM_PKGVAR="${TMP_DIR}/pkgvar"
export TRIM_APPDEST="${PROJECT_ROOT}/app"
export MANAGEMENT_PORT
export GATEWAY_PORT
export OC_HOME="${TMP_DIR}/oc-home"
export CONFIG_FILE="${OC_HOME}/openclaw.json"
export OPENCLAW_CONFIG_PATH="${CONFIG_FILE}"
export NODE_BIN="$(command -v node)"
export OC_JS_PATH="${TMP_DIR}/dummy-gateway.js"

API_LOG="${TMP_DIR}/management-api.log"
API_BASE="http://127.0.0.1:${MANAGEMENT_PORT}/api"
WEB_BASE="http://127.0.0.1:${MANAGEMENT_PORT}"

cleanup() {
  stop_process_if_running "${API_PID:-}"
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

mkdir -p "${TRIM_PKGVAR}" "${OC_HOME}"
cat > "${OC_JS_PATH}" <<'EOF'
process.exit(0);
EOF

assert_json_expr() {
  local file="$1"
  local expr="$2"
  local message="$3"
  node "${TEST_DIR}/lib/assert-json-expr.js" "${file}" "${expr}" "${message}" "access"
}

request_api_status() {
  local outfile="$1"
  local expected_status="$2"
  local extra_header="${3:-}"

  local curl_args=(
    -sS -o "${outfile}" -w "%{http_code}"
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
    --max-time "${HTTP_MAX_TIME_SECONDS}"
  )
  if [ -n "${extra_header}" ]; then
    curl_args+=( -H "${extra_header}" )
  fi

  local status
  status="$(curl "${curl_args[@]}" "${API_BASE}/status")"
  if [ "${status}" != "${expected_status}" ]; then
    echo "[access] unexpected HTTP ${status} for GET /api/status, expected ${expected_status}"
    cat "${outfile}" || true
    exit 1
  fi
}

request_web_root() {
  local outfile="$1"
  local expected_status="$2"
  local extra_header="${3:-}"

  local curl_args=(
    -sS -o "${outfile}" -w "%{http_code}"
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
    --max-time "${HTTP_MAX_TIME_SECONDS}"
  )
  if [ -n "${extra_header}" ]; then
    curl_args+=( -H "${extra_header}" )
  fi

  local status
  status="$(curl "${curl_args[@]}" "${WEB_BASE}/")"
  if [ "${status}" != "${expected_status}" ]; then
    echo "[access] unexpected HTTP ${status} for GET /, expected ${expected_status}"
    cat "${outfile}" || true
    exit 1
  fi
}

request_set_access() {
  local allow_remote="$1"
  local outfile="$2"

  local status
  status="$(
    curl -sS -o "${outfile}" -w "%{http_code}" \
      --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
      --max-time "${HTTP_MAX_TIME_SECONDS}" \
      -X POST \
      -H "Content-Type: application/json" \
      --data "{\"allowRemote\":${allow_remote}}" \
      "${API_BASE}/management/access"
  )"

  if [ "${status}" != "200" ]; then
    echo "[access] unexpected HTTP ${status} for POST /api/management/access"
    cat "${outfile}" || true
    exit 1
  fi
}

API_PID="$(start_management_api "${PROJECT_ROOT}" "${API_LOG}")"
wait_http_ready \
  "${API_BASE}/status" \
  "access" \
  "${API_LOG}" \
  "${READY_MAX_ATTEMPTS}" \
  "${READY_INTERVAL_SECONDS}" \
  "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
  "${HTTP_MAX_TIME_SECONDS}"

# 默认本机请求可访问
request_api_status "${TMP_DIR}/status-local.json" "200"

# 默认拒绝公网来源（通过受信 loopback 转发头模拟公网来源）
request_api_status "${TMP_DIR}/status-remote-denied.json" "403" "X-Forwarded-For: 8.8.8.8"
assert_json_expr "${TMP_DIR}/status-remote-denied.json" "data.code === 'forbidden' && data.status === 403" "默认远程访问未返回 forbidden"

# 静态页面同样拒绝公网来源
request_web_root "${TMP_DIR}/web-remote-denied.txt" "403" "X-Forwarded-For: 8.8.8.8"
if ! grep -q "localhost/LAN" "${TMP_DIR}/web-remote-denied.txt"; then
  echo "[access] static forbidden page missing localhost/LAN hint"
  cat "${TMP_DIR}/web-remote-denied.txt" || true
  exit 1
fi

# 内网来源默认允许
request_api_status "${TMP_DIR}/status-lan-allowed.json" "200" "X-Forwarded-For: 192.168.1.25"

# x-real-ip 回退链路同样受策略约束
request_api_status "${TMP_DIR}/status-realip-denied.json" "403" "X-Real-IP: 8.8.4.4"
assert_json_expr "${TMP_DIR}/status-realip-denied.json" "data.code === 'forbidden'" "x-real-ip 远程来源未被拒绝"

# 开启远程访问后，公网来源应放行
request_set_access true "${TMP_DIR}/set-access-enable.json"
assert_json_expr "${TMP_DIR}/set-access-enable.json" "data.success === true && data.allowRemote === true" "开启 allowRemote 失败"
request_api_status "${TMP_DIR}/status-remote-allowed.json" "200" "X-Forwarded-For: 8.8.8.8"

# 关闭远程访问后，公网来源再次被拒绝
request_set_access false "${TMP_DIR}/set-access-disable.json"
assert_json_expr "${TMP_DIR}/set-access-disable.json" "data.success === true && data.allowRemote === false" "关闭 allowRemote 失败"
request_api_status "${TMP_DIR}/status-remote-denied-again.json" "403" "X-Forwarded-For: 8.8.8.8"
assert_json_expr "${TMP_DIR}/status-remote-denied-again.json" "data.code === 'forbidden'" "关闭 allowRemote 后远程来源未被拒绝"

echo "[access] all checks passed"
