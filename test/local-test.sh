#!/bin/bash
# ============================================================================
# 本地测试启动脚本
# 用途：加载测试环境变量，启动 management-api
# ============================================================================

set -e

# 获取脚本所在目录
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
ENV_FILE="${TEST_DIR}/.env.test"

print_divider() {
    echo "=========================================="
}

print_json_or_raw() {
    local url="$1"
    curl -s "${url}" | python3 -m json.tool 2>/dev/null || curl -s "${url}"
}

start_management_api() {
    node "${PROJECT_ROOT}/app/server/management-api.js"
}

start_gateway() {
    openclaw gateway --port "${GATEWAY_PORT}" --token "$(cat "${TRIM_PKGVAR}/gateway_token")"
}

stop_all_services() {
    pkill -f "management-api.js" 2>/dev/null && echo "✅ Management API 已停止" || echo "ℹ️  Management API 未运行"

    if [ -f "${TRIM_PKGVAR}/gateway.pid" ]; then
        kill "$(cat "${TRIM_PKGVAR}/gateway.pid")" 2>/dev/null && echo "✅ Gateway 已停止 (PID)" || true
        rm -f "${TRIM_PKGVAR}/gateway.pid"
    fi
    pkill -f "openclaw.*gateway" 2>/dev/null && echo "✅ Gateway 已停止 (pkill)" || echo "ℹ️  Gateway 未运行"
}

show_menu() {
    echo "请选择操作:"
    echo "1. 启动 Management API (Web 管理界面)"
    echo "2. 启动 OpenClaw Gateway"
    echo "3. 同时启动两者"
    echo "4. 测试 API 连接"
    echo "5. 查看日志"
    echo "6. 停止所有服务"
    echo "0. 退出"
    echo ""
}

# 检查环境是否准备好
if [ ! -f "${ENV_FILE}" ]; then
    echo "❌ 测试环境未准备，请先运行:"
    echo "   bash test/setup-test-env.sh"
    exit 1
fi

# 加载环境变量
echo "📦 加载测试环境变量..."
source "${ENV_FILE}"

print_divider
echo "OpenClaw 本地测试环境"
print_divider
echo "项目根目录: ${PROJECT_ROOT}"
echo "测试数据目录: ${TRIM_PKGVAR}"
echo "Management API: http://localhost:${MANAGEMENT_PORT}"
echo "Gateway: http://localhost:${GATEWAY_PORT}"
print_divider
echo ""

show_menu

read -p "请输入选项 [0-6]: " choice

case "${choice}" in
    1)
        echo ""
        echo "🚀 启动 Management API..."
        echo "访问地址: http://localhost:${MANAGEMENT_PORT}"
        echo "按 Ctrl+C 停止"
        echo ""
        start_management_api
        ;;
    2)
        echo ""
        echo "🚀 启动 OpenClaw Gateway..."
        echo "访问地址: http://localhost:${GATEWAY_PORT}"
        echo "按 Ctrl+C 停止"
        echo ""
        start_gateway
        ;;
    3)
        echo ""
        echo "🚀 同时启动 Management API 和 Gateway..."
        echo ""

        # 在后台启动 Gateway
        echo "启动 Gateway (后台)..."
        start_gateway \
            >> "${TRIM_PKGVAR}/logs/gateway.log" 2>&1 &
        GATEWAY_PID=$!
        echo "Gateway PID: ${GATEWAY_PID}"
        echo "${GATEWAY_PID}" > "${TRIM_PKGVAR}/gateway.pid"

        # 等待 Gateway 启动
        sleep 2

        # 前台启动 Management API
        echo "启动 Management API (前台)..."
        echo "访问地址: http://localhost:${MANAGEMENT_PORT}"
        echo "按 Ctrl+C 停止所有服务"
        echo ""

        # 设置退出时清理
        cleanup_gateway_on_exit() {
            echo ""
            echo "停止服务..."
            kill "${GATEWAY_PID}" 2>/dev/null || true
            rm -f "${TRIM_PKGVAR}/gateway.pid"
            exit
        }
        trap cleanup_gateway_on_exit INT TERM

        start_management_api
        ;;
    4)
        echo ""
        echo "🧪 测试 API 连接..."
        echo ""

        # 启动临时服务器
        start_management_api &
        API_PID=$!

        sleep 3

        # 测试接口
        echo "测试 /api/status..."
        print_json_or_raw "http://localhost:${MANAGEMENT_PORT}/api/status"

        echo ""
        echo "测试 /api/version/current..."
        print_json_or_raw "http://localhost:${MANAGEMENT_PORT}/api/version/current"

        echo ""
        echo ""
        echo "✅ API 测试完成"

        # 停止服务器
        kill "${API_PID}"
        ;;
    5)
        echo ""
        echo "📋 查看日志..."
        echo ""

        if [ -f "${TRIM_PKGVAR}/info.log" ]; then
            echo "=== info.log ==="
            tail -20 "${TRIM_PKGVAR}/info.log"
        fi

        if [ -f "${TRIM_PKGVAR}/logs/gateway.log" ]; then
            echo ""
            echo "=== gateway.log ==="
            tail -20 "${TRIM_PKGVAR}/logs/gateway.log"
        fi

        if [ ! -f "${TRIM_PKGVAR}/info.log" ] && [ ! -f "${TRIM_PKGVAR}/logs/gateway.log" ]; then
            echo "暂无日志文件"
        fi
        ;;
    6)
        echo ""
        echo "🛑 停止所有服务..."
        stop_all_services
        echo ""
        echo "✅ 所有服务已停止"
        ;;
    0)
        echo "退出"
        exit 0
        ;;
    *)
        echo "❌ 无效选项"
        exit 1
        ;;
esac
