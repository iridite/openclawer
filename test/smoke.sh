#!/bin/bash
# 简化 smoke 测试：仅验证关键 API 是否可用（HTTP 200）
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"

find_free_port() {
  python - <<'PY'
import socket
s = socket.socket()
s.bind(('', 0))
print(s.getsockname()[1])
s.close()
PY
}

PORT="${MANAGEMENT_PORT:-}"
if [ -z "${PORT}" ]; then
  PORT="$(find_free_port)"
fi

TMP_DIR="$(mktemp -d /tmp/oc-deploy-smoke-XXXXXX)"
export TRIM_PKGVAR="${TMP_DIR}"
export TRIM_APPDEST="${PROJECT_ROOT}"
export MANAGEMENT_PORT="${PORT}"
export GATEWAY_PORT="${GATEWAY_PORT:-18789}"
export CONFIG_FILE="${TMP_DIR}/openclaw.json"
export OPENCLAW_CONFIG_PATH="${TMP_DIR}/openclaw.json"

API_LOG="${TMP_DIR}/management-api.log"

cleanup() {
  if [ -n "${API_PID:-}" ]; then
    kill "${API_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

node "${PROJECT_ROOT}/app/server/management-api.js" > "${API_LOG}" 2>&1 &
API_PID=$!

READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done

if [ "${READY}" -ne 1 ]; then
  echo "API 未启动，日志如下:"
  tail -n 50 "${API_LOG}" || true
  exit 1
fi

echo "[smoke] API ready on ${PORT}"

# 关键端点（仅验证 HTTP 200）
curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/config" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/config/validate" \
  -H "Content-Type: application/json" \
  -d '{"models":{"mode":"merge","providers":{}},"channels":{}}' >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/console/url" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/logs?lines=5" >/dev/null

echo "[smoke] all checks passed"
