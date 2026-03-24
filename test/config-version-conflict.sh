#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
source "${TEST_DIR}/lib/server-test-helpers.sh"
READY_MAX_ATTEMPTS="${CFG_LOCK_READY_MAX_ATTEMPTS:-20}"
READY_INTERVAL_SECONDS="${CFG_LOCK_READY_INTERVAL_SECONDS:-0.1}"
HTTP_CONNECT_TIMEOUT_SECONDS="${CFG_LOCK_CONNECT_TIMEOUT_SECONDS:-0.5}"
HTTP_MAX_TIME_SECONDS="${CFG_LOCK_HTTP_MAX_TIME_SECONDS:-3}"

TMP_DIR="$(mktemp -d /tmp/oc-deploy-config-lock-XXXXXX)"
MANAGEMENT_PORT="${CFG_LOCK_MANAGEMENT_PORT:-$((22000 + RANDOM % 10000))}"
GATEWAY_PORT="${CFG_LOCK_GATEWAY_PORT:-$((33000 + RANDOM % 10000))}"

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
  node "${TEST_DIR}/lib/assert-json-expr.js" "${file}" "${expr}" "${message}" "config-lock"
}

API_PID="$(start_management_api "${PROJECT_ROOT}" "${API_LOG}")"
wait_http_ready \
  "${API_BASE}/status" \
  "config-lock" \
  "${API_LOG}" \
  "${READY_MAX_ATTEMPTS}" \
  "${READY_INTERVAL_SECONDS}" \
  "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
  "${HTTP_MAX_TIME_SECONDS}"

CONFIG_HEADERS_FILE="${TMP_DIR}/config.headers"
curl -sS -D "${CONFIG_HEADERS_FILE}" -o "${TMP_DIR}/config.json" \
  --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
  --max-time "${HTTP_MAX_TIME_SECONDS}" \
  "${API_BASE}/config" >/dev/null

CONFIG_VERSION="$(awk 'BEGIN{IGNORECASE=1} /^x-config-version:/ {gsub(/\r/, "", $2); print $2; exit}' "${CONFIG_HEADERS_FILE}")"
if [ -z "${CONFIG_VERSION}" ]; then
  echo "[config-lock] missing x-config-version header from GET /config"
  exit 1
fi

# 先用正确版本保存一次，确保路径可用
save_status="$(
  curl -sS -o "${TMP_DIR}/save-ok.json" -w "%{http_code}" \
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${HTTP_MAX_TIME_SECONDS}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "If-Match: \"${CONFIG_VERSION}\"" \
    --data "$(cat "${TMP_DIR}/config.json")" \
    "${API_BASE}/config"
)"
if [ "${save_status}" != "200" ]; then
  echo "[config-lock] expected 200 for save with valid If-Match, got ${save_status}"
  cat "${TMP_DIR}/save-ok.json" || true
  exit 1
fi

# 再用错误版本提交，必须返回 409 + config_version_conflict
conflict_status="$(
  curl -sS -o "${TMP_DIR}/save-conflict.json" -w "%{http_code}" \
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${HTTP_MAX_TIME_SECONDS}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H 'If-Match: "deadbeef"' \
    --data "$(cat "${TMP_DIR}/config.json")" \
    "${API_BASE}/config"
)"

if [ "${conflict_status}" != "409" ]; then
  echo "[config-lock] expected 409 for stale If-Match, got ${conflict_status}"
  cat "${TMP_DIR}/save-conflict.json" || true
  exit 1
fi

assert_json_expr "${TMP_DIR}/save-conflict.json" "data.code === 'config_version_conflict'" "冲突错误码不是 config_version_conflict"
assert_json_expr "${TMP_DIR}/save-conflict.json" "data.status === 409" "冲突状态码不是 409"
assert_json_expr "${TMP_DIR}/save-conflict.json" "data.details && data.details.expectedVersion === 'deadbeef'" "冲突详情缺少 expectedVersion"
assert_json_expr "${TMP_DIR}/save-conflict.json" "data.details && typeof data.details.currentVersion === 'string' && data.details.currentVersion.length > 0" "冲突详情缺少 currentVersion"

echo "[config-lock] all checks passed"
