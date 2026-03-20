#!/bin/bash
# 简化 smoke 测试：仅验证关键 API 是否可用（HTTP 200）
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
source "${TEST_DIR}/lib/server-test-helpers.sh"
READY_MAX_ATTEMPTS="${SMOKE_READY_MAX_ATTEMPTS:-20}"
READY_INTERVAL_SECONDS="${SMOKE_READY_INTERVAL_SECONDS:-0.1}"
HTTP_CONNECT_TIMEOUT_SECONDS="${SMOKE_CONNECT_TIMEOUT_SECONDS:-0.5}"
HTTP_MAX_TIME_SECONDS="${SMOKE_HTTP_MAX_TIME_SECONDS:-2}"

PORT="${MANAGEMENT_PORT:-}"
if [ -z "${PORT}" ]; then
  PORT="$(find_free_port)"
fi

GATEWAY_TEST_PORT="${GATEWAY_PORT:-}"
if [ -z "${GATEWAY_TEST_PORT}" ]; then
  GATEWAY_TEST_PORT="$(find_free_port)"
fi

TMP_DIR="$(mktemp -d /tmp/oc-deploy-smoke-XXXXXX)"
export TRIM_PKGVAR="${TMP_DIR}"
export TRIM_APPDEST="${PROJECT_ROOT}/app"
export MANAGEMENT_PORT="${PORT}"
export GATEWAY_PORT="${GATEWAY_TEST_PORT}"
export CONFIG_FILE="${TMP_DIR}/openclaw.json"
export OPENCLAW_CONFIG_PATH="${TMP_DIR}/openclaw.json"

API_LOG="${TMP_DIR}/management-api.log"

curl_common=(
  -fsS
  --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
  --max-time "${HTTP_MAX_TIME_SECONDS}"
)

curl_status_only=(
  -sS
  -o /dev/null
  -w "%{http_code}"
  --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
  --max-time "${HTTP_MAX_TIME_SECONDS}"
)

cleanup() {
  stop_process_if_running "${API_PID:-}"
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

API_PID="$(start_management_api "${PROJECT_ROOT}" "${API_LOG}")"
wait_http_ready \
  "http://127.0.0.1:${PORT}/api/status" \
  "smoke" \
  "${API_LOG}" \
  "${READY_MAX_ATTEMPTS}" \
  "${READY_INTERVAL_SECONDS}" \
  "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
  "${HTTP_MAX_TIME_SECONDS}"

# 静态入口与缓存协商
curl "${curl_common[@]}" -I "http://127.0.0.1:${PORT}/" >/dev/null

ASSET_HEADERS="$(curl "${curl_common[@]}" -I "http://127.0.0.1:${PORT}/assets/management.js" | tr -d '\r')"
ETAG="$(printf '%s\n' "${ASSET_HEADERS}" | awk 'BEGIN{IGNORECASE=1} /^ETag:/ {print $2; exit}')"

if [ -z "${ETAG}" ]; then
  echo "[smoke] missing ETag header on static asset"
  exit 1
fi

ASSET_REVALIDATE_STATUS="$(
  curl "${curl_status_only[@]}" \
    -H "If-None-Match: ${ETAG}" \
    "http://127.0.0.1:${PORT}/assets/management.js"
)"

if [ "${ASSET_REVALIDATE_STATUS}" != "304" ]; then
  echo "[smoke] expected 304 for static asset revalidation, got ${ASSET_REVALIDATE_STATUS}"
  exit 1
fi

# Dashboard 上游未启动时，应该返回可恢复的提示页，而不是挂死
DASHBOARD_STATUS="$(
  curl -sS --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" --max-time "${HTTP_MAX_TIME_SECONDS}" -o "${TMP_DIR}/dashboard.html" -w "%{http_code}" \
    "http://127.0.0.1:${PORT}/dashboard/"
)"

if [ "${DASHBOARD_STATUS}" != "503" ] && [ "${DASHBOARD_STATUS}" != "504" ]; then
  echo "[smoke] expected dashboard fallback status 503/504, got ${DASHBOARD_STATUS}"
  exit 1
fi

if ! grep -q "Dashboard" "${TMP_DIR}/dashboard.html"; then
  echo "[smoke] dashboard fallback page content missing"
  exit 1
fi

# 关键端点（仅验证 HTTP 200）
curl "${curl_common[@]}" "http://127.0.0.1:${PORT}/api/config/validate" \
  -H "Content-Type: application/json" \
  -d '{"models":{"mode":"merge","providers":{}},"channels":{}}' >/dev/null
curl "${curl_common[@]}" "http://127.0.0.1:${PORT}/api/status" >/dev/null &
pid_status=$!
curl "${curl_common[@]}" "http://127.0.0.1:${PORT}/api/config" >/dev/null &
pid_config=$!
curl "${curl_common[@]}" "http://127.0.0.1:${PORT}/api/console/url" >/dev/null &
pid_console=$!
curl "${curl_common[@]}" "http://127.0.0.1:${PORT}/api/logs?lines=5" >/dev/null &
pid_logs=$!
wait "${pid_status}" "${pid_config}" "${pid_console}" "${pid_logs}"

echo "[smoke] all checks passed"
