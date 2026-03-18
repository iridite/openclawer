#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
READY_MAX_ATTEMPTS="${BACKUP_IMPORT_READY_MAX_ATTEMPTS:-20}"
READY_INTERVAL_SECONDS="${BACKUP_IMPORT_READY_INTERVAL_SECONDS:-0.1}"
HTTP_CONNECT_TIMEOUT_SECONDS="${BACKUP_IMPORT_CONNECT_TIMEOUT_SECONDS:-0.5}"
HTTP_MAX_TIME_SECONDS="${BACKUP_IMPORT_HTTP_MAX_TIME_SECONDS:-10}"

TMP_DIR="$(mktemp -d /tmp/oc-deploy-backup-import-XXXXXX)"
MANAGEMENT_PORT="${BACKUP_IMPORT_MANAGEMENT_PORT:-$((20000 + RANDOM % 10000))}"
GATEWAY_PORT="${BACKUP_IMPORT_GATEWAY_PORT:-$((31000 + RANDOM % 10000))}"

export TRIM_PKGVAR="${TMP_DIR}/pkgvar"
export TRIM_APPDEST="${PROJECT_ROOT}/app"
export MANAGEMENT_PORT
export GATEWAY_PORT
export BIND_ADDR="127.0.0.1"
export OC_HOME="${TMP_DIR}/oc-home"
export CONFIG_FILE="${OC_HOME}/openclaw.json"
export OPENCLAW_CONFIG_PATH="${CONFIG_FILE}"
export USER_BACKUP_ROOT="${TMP_DIR}/user-backups"
export MAX_BACKUP_UPLOAD_BYTES="${BACKUP_IMPORT_MAX_BACKUP_UPLOAD_BYTES:-16777216}"
export NODE_BIN="$(command -v node)"
export OC_JS_PATH="${TMP_DIR}/dummy-gateway.js"

API_LOG="${TMP_DIR}/management-api.log"
API_BASE="http://127.0.0.1:${MANAGEMENT_PORT}/api"
EXPORT_ARCHIVE="${TMP_DIR}/backup-export.tar.gz"

curl_common=(
  -fsS
  --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
  --max-time "${HTTP_MAX_TIME_SECONDS}"
)

cleanup() {
  if [ -n "${API_PID:-}" ]; then
    kill "${API_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

assert_json_expr() {
  local file="$1"
  local expr="$2"
  local message="$3"
  node - "${file}" "${expr}" "${message}" <<'NODE'
const fs = require("fs");

const [file, expr, message] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const ok = Function("data", `return (${expr});`)(data);

if (!ok) {
  console.error(`[backup-import] ${message}`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
NODE
}

mkdir -p "${TRIM_PKGVAR}" "${OC_HOME}"
cat > "${OC_JS_PATH}" <<'EOF'
process.exit(0);
EOF

node "${PROJECT_ROOT}/app/server/management-api.js" > "${API_LOG}" 2>&1 &
API_PID=$!

READY=0
for _ in $(seq 1 "${READY_MAX_ATTEMPTS}"); do
  if curl "${curl_common[@]}" "${API_BASE}/status" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep "${READY_INTERVAL_SECONDS}"
done

if [ "${READY}" -ne 1 ]; then
  echo "[backup-import] API 未启动，日志如下:"
  tail -n 50 "${API_LOG}" || true
  exit 1
fi

echo "[backup-import] API ready on ${MANAGEMENT_PORT}"

mkdir -p "${OC_HOME}/memory" "${TRIM_PKGVAR}/plugins/demo-plugin"
cat > "${CONFIG_FILE}" <<'EOF'
{
  "gateway": {
    "port": 18789,
    "bind": "lan"
  }
}
EOF
printf 'demo-plugin\n' > "${TRIM_PKGVAR}/plugins/demo-plugin/plugin.txt"
head -c 1048576 /dev/zero | tr '\0' 'A' > "${OC_HOME}/memory/large.txt"

curl "${curl_common[@]}" \
  -o "${EXPORT_ARCHIVE}" \
  "${API_BASE}/backup/export"

if [ ! -s "${EXPORT_ARCHIVE}" ]; then
  echo "[backup-import] 导出备份文件为空"
  exit 1
fi

rm -rf "${OC_HOME}" "${TRIM_PKGVAR}/plugins"
mkdir -p "${OC_HOME}" "${TRIM_PKGVAR}"

IMPORT_RESULT="${TMP_DIR}/backup-import-result.json"
IMPORT_STATUS="$(
  curl -sS -o "${IMPORT_RESULT}" -w "%{http_code}" \
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${HTTP_MAX_TIME_SECONDS}" \
    -X POST \
    -F "backupFile=@${EXPORT_ARCHIVE}" \
    "${API_BASE}/backup/import"
)"

if [ "${IMPORT_STATUS}" != "200" ]; then
  echo "[backup-import] 导入备份失败，HTTP ${IMPORT_STATUS}"
  cat "${IMPORT_RESULT}" || true
  exit 1
fi

assert_json_expr "${IMPORT_RESULT}" "data.success === true && data.restoredCount >= 1" "导入结果不正确"

if [ ! -f "${OC_HOME}/memory/large.txt" ]; then
  echo "[backup-import] large.txt 未恢复"
  exit 1
fi

if [ ! -f "${TRIM_PKGVAR}/plugins/demo-plugin/plugin.txt" ]; then
  echo "[backup-import] plugin.txt 未恢复"
  exit 1
fi

RESTORED_SIZE="$(wc -c < "${OC_HOME}/memory/large.txt" | tr -d '[:space:]')"
if [ "${RESTORED_SIZE}" != "1048576" ]; then
  echo "[backup-import] 恢复后的 large.txt 大小不正确: ${RESTORED_SIZE}"
  exit 1
fi

if ! grep -q '^demo-plugin$' "${TRIM_PKGVAR}/plugins/demo-plugin/plugin.txt"; then
  echo "[backup-import] 恢复后的 plugin.txt 内容不正确"
  exit 1
fi

echo "[backup-import] all checks passed"
