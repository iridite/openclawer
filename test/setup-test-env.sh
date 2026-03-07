#!/bin/bash
# ============================================================================
# 本地测试环境准备脚本
# 用途：模拟 fnOS 环境，准备测试所需的目录和依赖
# ============================================================================

set -e

echo "=========================================="
echo "OpenClaw 本地测试环境准备"
echo "=========================================="

# 获取项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="${PROJECT_ROOT}/test"
TEST_DATA="${TEST_DIR}/test-data"

echo "项目根目录: ${PROJECT_ROOT}"
echo "测试数据目录: ${TEST_DATA}"

# 创建测试目录结构
echo ""
echo "📁 创建测试目录结构..."
mkdir -p "${TEST_DATA}"
mkdir -p "${TEST_DATA}/data/.openclaw"
mkdir -p "${TEST_DATA}/logs"
mkdir -p "${TEST_DATA}/.pm2"

# 安装 OpenClaw (如果未安装)
if [ ! -d "${TEST_DATA}/node_modules/openclaw" ]; then
    echo ""
    echo "📦 安装 OpenClaw & pm2..."
    cd "${TEST_DATA}"
    npm install openclaw@latest
    npm install pm2
    echo "✅ OpenClaw 安装完成"
else
    echo ""
    echo "✅ OpenClaw 已安装，跳过"
fi

# 生成测试 token
TOKEN_FILE="${TEST_DATA}/gateway_token"
if [ ! -f "${TOKEN_FILE}" ]; then
    echo ""
    echo "🔑 生成测试 token..."
    TEST_TOKEN=$(openssl rand -hex 32 2>/dev/null || echo "test-token-$(date +%s)")
    echo "${TEST_TOKEN}" > "${TOKEN_FILE}"
    echo "✅ Token 已生成: ${TEST_TOKEN}"
else
    echo ""
    echo "✅ Token 已存在: $(cat ${TOKEN_FILE})"
fi

# 初始化 OpenClaw 配置
CONFIG_FILE="${TEST_DATA}/data/.openclaw/openclaw.json"
if [ ! -f "${CONFIG_FILE}" ]; then
    echo ""
    echo "⚙️  初始化 OpenClaw 配置..."

    # 方法 1: 使用 openclaw setup (如果支持)
    if [ -x "${TEST_DATA}/node_modules/.bin/openclaw" ]; then
        export HOME="${TEST_DATA}/data"
        cd "${TEST_DATA}/data"
        "${TEST_DATA}/node_modules/.bin/openclaw" setup 2>/dev/null || echo "⚠️  openclaw setup 失败，将创建默认配置"
    fi

    # 方法 2: 创建默认配置
    if [ ! -f "${CONFIG_FILE}" ]; then
        cat > "${CONFIG_FILE}" <<EOF
{
  "version": "1.0",
  "gateway": {
    "port": 18789,
    "bind": "0.0.0.0",
    "auth": {
      "mode": "token",
      "token": "$(cat ${TOKEN_FILE})"
    }
  },
  "models": {
    "test-model": {
      "provider": "openai",
      "apiKey": "sk-test-key",
      "baseURL": "https://api.openai.com"
    }
  },
  "channels": {}
}
EOF
    fi
    echo "✅ 配置已创建"
else
    echo ""
    echo "✅ 配置已存在"
fi

# 创建环境变量文件
ENV_FILE="${TEST_DIR}/.env.test"
echo ""
echo "📝 创建环境变量文件..."
cat > "${ENV_FILE}" <<EOF
# OpenClaw 本地测试环境变量
# 由 setup-test-env.sh 自动生成

# 模拟 fnOS 环境变量
export TRIM_PKGVAR="${TEST_DATA}"
export TRIM_APPDEST="${PROJECT_ROOT}"
export TRIM_APPNAME="oc-deploy"

# 端口配置
export MANAGEMENT_PORT=18790
export GATEWAY_PORT=18789

# OpenClaw 配置
export HOME="${TEST_DATA}/data"
export OPENCLAW_CONFIG_DIR="${TEST_DATA}/data/.openclaw"
export OPENCLAW_WORKSPACE_DIR="${TEST_DATA}/data/.openclaw/workspace"

# Node.js 路径 (使用系统 Node.js)
export NODE_BIN="$(which node)"
export NPM_BIN="$(which npm)"
export NODE_PATH="${TEST_DATA}/node_modules"

# 添加 openclaw bin 到 PATH
export PATH="${TEST_DATA}/node_modules/.bin:\${PATH}"
EOF

echo "✅ 环境变量文件已创建: ${ENV_FILE}"

echo ""
echo "=========================================="
echo "✅ 测试环境准备完成！"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 启动测试: bash test/local-test.sh"
echo "2. 或手动启动: source test/.env.test && node app/server/management-api.js"
echo ""
