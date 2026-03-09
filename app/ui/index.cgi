#!/bin/bash

# ===========================================================================
# OpenClaw Management Console CGI Gateway
# 路由请求到 Management API 或静态文件
# ===========================================================================

# 静态文件根目录
BASE_PATH="${TRIM_APPDEST}/ui"
# Management API 地址
MANAGEMENT_API="http://127.0.0.1:18790"
# iframe-proxy 地址
IFRAME_PROXY="http://127.0.0.1:18791"

# 从 REQUEST_URI 中提取相对路径
URI_NO_QUERY="${REQUEST_URI%%\?*}"
REL_PATH="/"

case "$URI_NO_QUERY" in
    *index.cgi*)
        REL_PATH="${URI_NO_QUERY#*index.cgi}"
        ;;
esac

# 默认访问 management.html
if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
    REL_PATH="/management.html"
fi

# 处理 API 请求 - 代理到 Management API
if [[ "$REL_PATH" == /api/* ]]; then
    # 读取请求体（如果是 POST）
    if [[ "$REQUEST_METHOD" == "POST" ]]; then
        # 读取 Content-Length 字节的数据
        if [ -n "$CONTENT_LENGTH" ]; then
            BODY=$(head -c "$CONTENT_LENGTH")
        fi
        RESPONSE=$(curl -s -X POST "${MANAGEMENT_API}${REL_PATH}${QUERY_STRING:+?$QUERY_STRING}" \
            -H "Content-Type: application/json" \
            -d "$BODY")
    else
        RESPONSE=$(curl -s "${MANAGEMENT_API}${REL_PATH}${QUERY_STRING:+?$QUERY_STRING}")
    fi

    echo "Content-Type: application/json; charset=utf-8"
    echo "Access-Control-Allow-Origin: *"
    echo ""
    echo "$RESPONSE"
    exit 0
fi

# 处理 Dashboard 代理请求 - 代理到 iframe-proxy
if [[ "$REL_PATH" == /dashboard* ]]; then
    # 去掉 /dashboard 前缀，转发到 iframe-proxy
    PROXY_PATH="${REL_PATH#/dashboard}"
    if [ -z "$PROXY_PATH" ]; then
        PROXY_PATH="/"
    fi

    # 转发所有请求到 iframe-proxy
    if [[ "$REQUEST_METHOD" == "POST" ]]; then
        if [ -n "$CONTENT_LENGTH" ]; then
            BODY=$(head -c "$CONTENT_LENGTH")
        fi
        curl -s -X POST "${IFRAME_PROXY}${PROXY_PATH}${QUERY_STRING:+?$QUERY_STRING}" \
            -H "Content-Type: ${CONTENT_TYPE:-application/octet-stream}" \
            --data-binary "$BODY"
    else
        curl -s "${IFRAME_PROXY}${PROXY_PATH}${QUERY_STRING:+?$QUERY_STRING}"
    fi
    exit 0
fi

# 处理静态文件请求
TARGET_FILE="${BASE_PATH}${REL_PATH}"

# 安全检查：防止目录穿越
if echo "$TARGET_FILE" | grep -q '\.\.'; then
    echo "Status: 400 Bad Request"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "400 Bad Request: Invalid path"
    exit 0
fi

# 检查文件是否存在
if [ ! -f "$TARGET_FILE" ]; then
    echo "Status: 404 Not Found"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "404 Not Found: ${REL_PATH}"
    exit 0
fi

# 根据文件扩展名设置 MIME 类型
ext="${TARGET_FILE##*.}"
case "$ext" in
    html|htm) mime="text/html; charset=utf-8" ;;
    css)      mime="text/css; charset=utf-8" ;;
    js)       mime="application/javascript; charset=utf-8" ;;
    jpg|jpeg) mime="image/jpeg" ;;
    png)      mime="image/png" ;;
    svg)      mime="image/svg+xml" ;;
    json)     mime="application/json; charset=utf-8" ;;
    *)        mime="application/octet-stream" ;;
esac

# 输出 HTTP 响应
echo "Content-Type: $mime"
echo ""
cat "$TARGET_FILE"
