#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
source "${TEST_DIR}/lib/server-test-helpers.sh"
READY_MAX_ATTEMPTS="${CAP_READY_MAX_ATTEMPTS:-20}"
READY_INTERVAL_SECONDS="${CAP_READY_INTERVAL_SECONDS:-0.1}"
HTTP_CONNECT_TIMEOUT_SECONDS="${CAP_CONNECT_TIMEOUT_SECONDS:-0.5}"
HTTP_MAX_TIME_SECONDS="${CAP_HTTP_MAX_TIME_SECONDS:-3}"

TMP_DIR="$(mktemp -d /tmp/oc-deploy-capability-XXXXXX)"
MANAGEMENT_PORT="${CAP_MANAGEMENT_PORT:-$((20000 + RANDOM % 10000))}"
GATEWAY_PORT="${CAP_GATEWAY_PORT:-$((31000 + RANDOM % 10000))}"

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

curl_common=(
  -fsS
  --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
  --max-time "${HTTP_MAX_TIME_SECONDS}"
)

cleanup() {
  stop_process_if_running "${API_PID:-}"
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

mkdir -p "${TRIM_PKGVAR}" "${OC_HOME}"
cat > "${OC_JS_PATH}" <<'EOF'
process.exit(0);
EOF

request_json() {
  local method="$1"
  local path="$2"
  local outfile="$3"
  local body="${4:-}"
  local extra_header="${5:-}"
  local status

  local curl_args=(
    -sS -o "${outfile}" -w "%{http_code}"
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}"
    --max-time "${HTTP_MAX_TIME_SECONDS}"
    -X "${method}"
  )

  if [ -n "${extra_header}" ]; then
    curl_args+=( -H "${extra_header}" )
  fi

  if [ -n "${body}" ]; then
    curl_args+=( -H "Content-Type: application/json" --data "${body}" )
  fi

  status="$(curl "${curl_args[@]}" "${API_BASE}${path}")"

  if [ "${status}" != "200" ]; then
    echo "[capability] unexpected HTTP ${status} for ${method} ${path}"
    cat "${outfile}" || true
    exit 1
  fi
}

get_config_version() {
  local headers_file="$1"
  local outfile="$2"

  curl -sS -D "${headers_file}" -o "${outfile}" \
    --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${HTTP_MAX_TIME_SECONDS}" \
    "${API_BASE}/config" >/dev/null

  awk 'BEGIN{IGNORECASE=1} /^x-config-version:/ {gsub(/\r/, "", $2); print $2; exit}' "${headers_file}"
}

request_expect_status() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local outfile="$4"
  local body="${5:-}"
  local status

  if [ -n "${body}" ]; then
    status="$(
      curl -sS -o "${outfile}" -w "%{http_code}" \
        --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
        --max-time "${HTTP_MAX_TIME_SECONDS}" \
        -X "${method}" \
        -H "Content-Type: application/json" \
        --data "${body}" \
        "${API_BASE}${path}"
    )"
  else
    status="$(
      curl -sS -o "${outfile}" -w "%{http_code}" \
        --connect-timeout "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
        --max-time "${HTTP_MAX_TIME_SECONDS}" \
        -X "${method}" \
        "${API_BASE}${path}"
    )"
  fi

  if [ "${status}" != "${expected_status}" ]; then
    echo "[capability] unexpected HTTP ${status} for ${method} ${path}, expected ${expected_status}"
    cat "${outfile}" || true
    exit 1
  fi
}

assert_json_expr() {
  local file="$1"
  local expr="$2"
  local message="$3"
  node "${TEST_DIR}/lib/assert-json-expr.js" "${file}" "${expr}" "${message}" "capability"
}

assert_config_expr() {
  local expr="$1"
  local message="$2"
  node - "${CONFIG_FILE}" "${expr}" "${message}" <<'NODE'
const fs = require("fs");

const [file, expr, message] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const ok = Function("data", `return (${expr});`)(data);

if (!ok) {
  console.error(`[capability] ${message}`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
NODE
}

API_PID="$(start_management_api "${PROJECT_ROOT}" "${API_LOG}")"
wait_http_ready \
  "${API_BASE}/status" \
  "capability" \
  "${API_LOG}" \
  "${READY_MAX_ATTEMPTS}" \
  "${READY_INTERVAL_SECONDS}" \
  "${HTTP_CONNECT_TIMEOUT_SECONDS}" \
  "${HTTP_MAX_TIME_SECONDS}"

# 初始化 openclaw.json
CONFIG_HEADERS_FILE="${TMP_DIR}/config-default.headers"
CONFIG_VERSION="$(get_config_version "${CONFIG_HEADERS_FILE}" "${TMP_DIR}/config-default.json")"
if [ -z "${CONFIG_VERSION}" ]; then
  echo "[capability] missing x-config-version header from GET /config"
  exit 1
fi
request_json POST "/config" "${TMP_DIR}/config-save.json" "$(cat "${TMP_DIR}/config-default.json")" "If-Match: \"${CONFIG_VERSION}\""
assert_json_expr "${TMP_DIR}/config-save.json" "data.success === true" "初始化配置失败"

# 模型：添加、编辑、切换主模型、删除
request_json POST "/models/add" "${TMP_DIR}/model-add-1.json" '{
  "modelId": "gpt-4o",
  "providerName": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-openai-plain",
  "apiKeyStorageMode": "plaintext",
  "apiProtocol": "openai",
  "apiType": "openai-completions",
  "advanced": {
    "reasoning": false,
    "input": ["text"],
    "contextWindow": 200000,
    "maxTokens": 8192
  }
}'
assert_json_expr "${TMP_DIR}/model-add-1.json" "data.success === true && data.modelKey === 'openai/gpt-4o'" "添加第一个模型失败"

request_json POST "/models/add" "${TMP_DIR}/model-add-2.json" '{
  "modelId": "claude-3-5-sonnet",
  "providerName": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "apiKey": "sk-anthropic-plain",
  "apiKeyStorageMode": "plaintext",
  "apiProtocol": "anthropic",
  "apiType": "anthropic",
  "advanced": {
    "reasoning": false,
    "input": ["text"],
    "contextWindow": 200000,
    "maxTokens": 8192
  }
}'
assert_json_expr "${TMP_DIR}/model-add-2.json" "data.success === true && data.modelKey === 'anthropic/claude-3-5-sonnet'" "添加第二个模型失败"

request_json POST "/models/add" "${TMP_DIR}/model-edit.json" '{
  "modelId": "gpt-4o",
  "providerName": "openai",
  "baseUrl": "https://api.openai.com/v1/compat",
  "apiKey": "sk-openai-plain-edited",
  "apiKeyStorageMode": "plaintext",
  "apiProtocol": "openai",
  "apiType": "openai-completions",
  "isEditMode": true,
  "editModelKey": "openai/gpt-4o",
  "advanced": {
    "reasoning": true,
    "input": ["text", "image"],
    "contextWindow": 128000,
    "maxTokens": 4096
  }
}'
assert_json_expr "${TMP_DIR}/model-edit.json" "data.success === true" "编辑模型失败"
assert_config_expr "data.models.providers.openai.baseUrl === 'https://api.openai.com/v1/compat'" "模型编辑后 baseUrl 未更新"
assert_config_expr "data.models.providers.openai.models[0].maxTokens === 4096" "模型编辑后高级配置未更新"

request_json POST "/models/primary" "${TMP_DIR}/model-primary.json" '{"modelKey":"anthropic/claude-3-5-sonnet"}'
assert_json_expr "${TMP_DIR}/model-primary.json" "data.success === true && data.modelKey === 'anthropic/claude-3-5-sonnet'" "切换主模型失败"
assert_config_expr "data.agents.defaults.model.primary === 'anthropic/claude-3-5-sonnet'" "主模型未写入配置"

request_json POST "/models/delete" "${TMP_DIR}/model-delete.json" '{"modelKey":"openai/gpt-4o"}'
assert_json_expr "${TMP_DIR}/model-delete.json" "data.success === true" "删除模型失败"
assert_config_expr "!data.models.providers.openai" "删除模型后 provider 未清理"

# 渠道：添加、编辑、删除
request_json POST "/channels/upsert" "${TMP_DIR}/channel-add.json" '{
  "channelId": "telegram",
  "channel": {
    "type": "telegram",
    "enabled": true,
    "botToken": "123456:telegram-token",
    "dmPolicy": "open",
    "allowFrom": ["*"],
    "groups": {
      "*": {
        "requireMention": true
      }
    }
  }
}'
assert_json_expr "${TMP_DIR}/channel-add.json" "data.success === true && data.channelId === 'telegram'" "添加渠道失败"

request_json POST "/channels/upsert" "${TMP_DIR}/channel-edit.json" '{
  "channelId": "telegram",
  "editKey": "telegram",
  "channel": {
    "type": "telegram",
    "enabled": false,
    "botToken": "123456:telegram-token-updated",
    "dmPolicy": "open",
    "allowFrom": ["*"],
    "groups": {
      "*": {
        "requireMention": false
      }
    }
  }
}'
assert_json_expr "${TMP_DIR}/channel-edit.json" "data.success === true" "编辑渠道失败"
assert_config_expr "data.channels.telegram.enabled === false && data.channels.telegram.groups['*'].requireMention === false" "渠道编辑未生效"

request_json POST "/channels/delete" "${TMP_DIR}/channel-delete.json" '{"channelId":"telegram"}'
assert_json_expr "${TMP_DIR}/channel-delete.json" "data.success === true" "删除渠道失败"
assert_config_expr "!data.channels.telegram" "删除渠道后配置仍存在"

# API Key 防护：切换后清空模型，再验证 managed-file 存储
request_json POST "/security/api-key-protection" "${TMP_DIR}/protection-enable.json" '{"enabled":true,"confirmReset":true}'
assert_json_expr "${TMP_DIR}/protection-enable.json" "data.enabled === true && data.modelsReset && data.modelsReset.performed === true" "启用 API 防护失败"
assert_config_expr "Object.keys(data.models.providers || {}).length === 0" "启用 API 防护后模型未清空"

request_json POST "/models/add" "${TMP_DIR}/model-managed-file.json" '{
  "modelId": "gpt-4.1",
  "providerName": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-managed-secret",
  "apiKeyStorageMode": "managed-file",
  "apiProtocol": "openai",
  "apiType": "openai-completions",
  "advanced": {
    "reasoning": false,
    "input": ["text"],
    "contextWindow": 200000,
    "maxTokens": 8192
  }
}'
assert_json_expr "${TMP_DIR}/model-managed-file.json" "data.success === true && data.apiKeyStorage === 'managed-file'" "managed-file 模式添加模型失败"
assert_config_expr "typeof data.models.providers.openai.apiKey === 'object' && data.models.providers.openai.apiKey.source === 'file'" "模型未保存为文件 SecretRef"
assert_config_expr "data.secrets && data.secrets.providers && data.secrets.providers['oc-deploy-file']" "配置未写入文件 Secret Provider"
assert_config_expr "data.secrets.defaults.file === 'oc-deploy-file'" "默认文件 Secret Provider 未写入"

SECRET_FILE="${OC_HOME}/oc-deploy-secrets.json"
if [ ! -f "${SECRET_FILE}" ]; then
  echo "[capability] managed-file secret file not found: ${SECRET_FILE}"
  exit 1
fi
node - "${SECRET_FILE}" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data?.providers?.openai?.apiKey !== "sk-managed-secret") {
  console.error("[capability] managed-file secret content mismatch");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
NODE

request_json POST "/security/api-key-protection" "${TMP_DIR}/protection-disable.json" '{"enabled":false,"confirmReset":true}'
assert_json_expr "${TMP_DIR}/protection-disable.json" "data.enabled === false && data.modelsReset && data.modelsReset.performed === true" "关闭 API 防护失败"
assert_config_expr "Object.keys(data.models.providers || {}).length === 0" "关闭 API 防护后模型未清空"

# 错误语义：参数错误 / 目标不存在 / 路由不存在
request_expect_status POST "/models/primary" "400" "${TMP_DIR}/error-bad-request.json" '{"modelKey":""}'
assert_json_expr "${TMP_DIR}/error-bad-request.json" "data.status === 400 && data.code === 'bad_request' && /模型标识不能为空/.test(data.error)" "400 bad_request 语义不正确"

request_expect_status POST "/models/delete" "404" "${TMP_DIR}/error-not-found.json" '{"modelKey":"openai/not-exists"}'
assert_json_expr "${TMP_DIR}/error-not-found.json" "data.status === 404 && data.code === 'not_found' && /不存在/.test(data.error)" "404 not_found 语义不正确"

request_expect_status GET "/route-not-found" "404" "${TMP_DIR}/error-route-not-found.json"
assert_json_expr "${TMP_DIR}/error-route-not-found.json" "data.status === 404 && data.code === 'not_found'" "未知路由未返回 404 not_found"

request_json GET "/management/access" "${TMP_DIR}/management-access-default.json"
assert_json_expr "${TMP_DIR}/management-access-default.json" "data.success === true && data.allowRemote === false && data.source === 'default'" "management access 默认值不正确（应默认拒绝非内网访问）"

request_expect_status POST "/management/access" "400" "${TMP_DIR}/error-invalid-management-access.json" '{"allowRemote":"yes"}'
assert_json_expr "${TMP_DIR}/error-invalid-management-access.json" "data.status === 400 && data.code === 'bad_request'" "management access 参数错误未返回 400 bad_request"

# 插件：状态识别 + plugins.allow 修正
mkdir -p "${OC_HOME}/plugins/openclaw-qqbot"
cat > "${OC_HOME}/plugins/openclaw-qqbot/package.json" <<'EOF'
{
  "name": "@tencent-connect/openclaw-qqbot",
  "version": "1.0.0-test",
  "openclaw": {
    "channels": ["qqbot"]
  }
}
EOF
cat > "${OC_HOME}/plugins/openclaw-qqbot/openclaw.plugin.json" <<'EOF'
{
  "id": "openclaw-qqbot",
  "version": "1.0.0-test",
  "channels": ["qqbot"]
}
EOF

node - "${CONFIG_FILE}" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data.plugins = data.plugins || {};
data.plugins.enabled = true;
data.plugins.allow = [];
fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
NODE

request_json GET "/plugins/qqbot/status" "${TMP_DIR}/qqbot-status-disabled.json"
assert_json_expr "${TMP_DIR}/qqbot-status-disabled.json" "data.success === true && data.state === 'disabled'" "QQ 插件 disabled 状态识别失败"

request_json POST "/plugins/qqbot/install" "${TMP_DIR}/qqbot-install.json"
assert_json_expr "${TMP_DIR}/qqbot-install.json" "data.success === true" "QQ 插件 allow 修正失败"
assert_config_expr "Array.isArray(data.plugins.allow) && data.plugins.allow.includes('openclaw-qqbot')" "QQ 插件 allow 未自动修正"

# WeCom 插件：状态识别 + plugins.allow 修正
mkdir -p "${OC_HOME}/plugins/wecom-openclaw-plugin"
cat > "${OC_HOME}/plugins/wecom-openclaw-plugin/package.json" <<'EOF'
{
  "name": "@wecom/wecom-openclaw-plugin",
  "version": "1.0.0-test",
  "openclaw": {
    "channels": ["wecom"]
  }
}
EOF
cat > "${OC_HOME}/plugins/wecom-openclaw-plugin/openclaw.plugin.json" <<'EOF'
{
  "id": "wecom-openclaw-plugin",
  "version": "1.0.0-test",
  "channels": ["wecom"]
}
EOF

node - "${CONFIG_FILE}" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data.plugins = data.plugins || {};
data.plugins.enabled = true;
data.plugins.allow = ["openclaw-qqbot"];
fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
NODE

request_json GET "/plugins/wecom/status" "${TMP_DIR}/wecom-status-disabled.json"
assert_json_expr "${TMP_DIR}/wecom-status-disabled.json" "data.success === true && data.state === 'disabled'" "WeCom 插件 disabled 状态识别失败"

request_json POST "/plugins/wecom/install" "${TMP_DIR}/wecom-install.json"
assert_json_expr "${TMP_DIR}/wecom-install.json" "data.success === true" "WeCom 插件 allow 修正失败"
assert_config_expr "Array.isArray(data.plugins.allow) && data.plugins.allow.includes('wecom-openclaw-plugin')" "WeCom 插件 allow 未自动修正"

# 技能：user + builtin 列表识别与启用/禁用写入
mkdir -p "${OC_HOME}/skills/demo-skill"
cat > "${OC_HOME}/skills/demo-skill/SKILL.md" <<'EOF'
---
name: Demo Skill
skillKey: demo-skill-key
---

Minimal user skill for regression test.
EOF

mkdir -p "${TRIM_PKGVAR}/node_modules/openclaw/skills/builtin-demo"
cat > "${TRIM_PKGVAR}/node_modules/openclaw/skills/builtin-demo/SKILL.md" <<'EOF'
---
name: Builtin Demo
skillKey: builtin-demo-key
---

Minimal builtin skill for regression test.
EOF

cat > "${OC_HOME}/skills/.skills_store_lock.json" <<'EOF'
{
  "version": 1,
  "skills": {
    "demo-skill": {
      "name": "demo-skill",
      "source": "test",
      "version": "0.0.1",
      "installed_at": "2026-03-18T00:00:00.000Z"
    }
  }
}
EOF

request_json GET "/skills/list" "${TMP_DIR}/skills-list.json"
assert_json_expr "${TMP_DIR}/skills-list.json" "data.success === true && data.skills.some((skill) => skill.slug === 'demo-skill' && skill.location === 'user' && skill.enabled === true)" "技能列表未识别用户技能"
assert_json_expr "${TMP_DIR}/skills-list.json" "data.success === true && data.skills.some((skill) => skill.slug === 'builtin-demo' && skill.location === 'builtin' && skill.enabled === true)" "技能列表未识别 builtin 技能"

request_json POST "/skills/toggle" "${TMP_DIR}/skill-disable.json" '{"slug":"demo-skill","enabled":false,"entryKey":"demo-skill-key","location":"user"}'
assert_json_expr "${TMP_DIR}/skill-disable.json" "data.success === true && data.enabled === false" "禁用技能失败"
assert_config_expr "data.skills.entries['demo-skill-key'].enabled === false" "禁用技能后配置未写入"

request_json POST "/skills/toggle" "${TMP_DIR}/skill-enable.json" '{"slug":"demo-skill","enabled":true,"entryKey":"demo-skill-key","location":"user"}'
assert_json_expr "${TMP_DIR}/skill-enable.json" "data.success === true && data.enabled === true" "启用技能失败"
assert_config_expr "!data.skills || !data.skills.entries || !data.skills.entries['demo-skill-key']" "启用技能后禁用标记未清理"

request_json POST "/skills/toggle" "${TMP_DIR}/builtin-skill-disable.json" '{"slug":"builtin-demo","enabled":false,"entryKey":"builtin-demo-key","location":"builtin"}'
assert_json_expr "${TMP_DIR}/builtin-skill-disable.json" "data.success === true && data.enabled === false" "禁用 builtin 技能失败"
assert_config_expr "data.skills.entries['builtin-demo-key'].enabled === false" "禁用 builtin 技能后配置未写入"

request_json POST "/skills/toggle" "${TMP_DIR}/builtin-skill-enable.json" '{"slug":"builtin-demo","enabled":true,"entryKey":"builtin-demo-key","location":"builtin"}'
assert_json_expr "${TMP_DIR}/builtin-skill-enable.json" "data.success === true && data.enabled === true" "启用 builtin 技能失败"
assert_config_expr "!data.skills || !data.skills.entries || !data.skills.entries['builtin-demo-key']" "启用 builtin 技能后禁用标记未清理"

request_expect_status POST "/skills/install" "400" "${TMP_DIR}/skill-install-invalid.json" '{"slug":"bad slug"}'
assert_json_expr "${TMP_DIR}/skill-install-invalid.json" "data.status === 400 && data.code === 'bad_request'" "技能安装参数错误未返回 400 bad_request"

request_expect_status POST "/skills/uninstall" "404" "${TMP_DIR}/skill-uninstall-missing.json" '{"slug":"missing-skill"}'
assert_json_expr "${TMP_DIR}/skill-uninstall-missing.json" "data.status === 404 && data.code === 'not_found'" "技能卸载缺失未返回 404 not_found"

request_expect_status POST "/skills/toggle" "404" "${TMP_DIR}/skill-toggle-missing.json" '{"slug":"missing-skill","enabled":false,"entryKey":"missing-skill","location":"user"}'
assert_json_expr "${TMP_DIR}/skill-toggle-missing.json" "data.status === 404 && data.code === 'not_found'" "技能切换缺失未返回 404 not_found"

echo "[capability] all checks passed"
