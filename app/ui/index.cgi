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

    # 转发所有请求到 iframe-proxy，使用 -i 获取完整响应头
    if [[ "$REQUEST_METHOD" == "POST" ]]; then
        if [ -n "$CONTENT_LENGTH" ]; then
            BODY=$(head -c "$CONTENT_LENGTH")
        fi
        RESPONSE=$(curl -i -s --max-time 5 -X POST "${IFRAME_PROXY}${PROXY_PATH}${QUERY_STRING:+?$QUERY_STRING}" \
            -H "Content-Type: ${CONTENT_TYPE:-application/octet-stream}" \
            --data-binary "$BODY" 2>&1)
        CURL_EXIT=$?
    else
        RESPONSE=$(curl -i -s --max-time 5 "${IFRAME_PROXY}${PROXY_PATH}${QUERY_STRING:+?$QUERY_STRING}" 2>&1)
        CURL_EXIT=$?
    fi

    # 检查 curl 是否成功
    if [ $CURL_EXIT -ne 0 ]; then
        echo "Status: 503 Service Unavailable"
        echo "Content-Type: text/html; charset=utf-8"
        echo ""
        cat <<'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>控制台服务不可用</title>
    <style>
        body {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            font-family: system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            margin: 0;
        }
        .container {
            text-align: center;
            max-width: 500px;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin: 0 0 1rem 0; }
        p { font-size: 1rem; line-height: 1.6; opacity: 0.9; margin: 0 0 1.5rem 0; }
        .btn {
            display: inline-block;
            padding: 0.8rem 2rem;
            background: #fff;
            color: #667eea;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .btn:hover { transform: translateY(-2px); }
    </style>
    <meta http-equiv="refresh" content="5">
</head>
<body>
    <div class="container">
        <div class="icon">🦀</div>
        <h1>控制台服务启动中</h1>
        <p>OpenClaw Dashboard 代理服务正在启动，请稍候...</p>
        <p style="font-size: 0.9rem; opacity: 0.7;">页面将在 5 秒后自动刷新</p>
        <a href="javascript:location.reload()" class="btn">立即刷新</a>
    </div>
</body>
</html>
EOF
        exit 0
    fi

    # 解析响应：分离状态行、响应头和响应体
    # 读取第一行作为状态行
    STATUS_LINE=$(echo "$RESPONSE" | head -n 1 | tr -d '\r')
    # 提取状态码
    STATUS_CODE=$(echo "$STATUS_LINE" | cut -d' ' -f2)

    # 输出状态码
    if [ -n "$STATUS_CODE" ] && [ "$STATUS_CODE" != "200" ]; then
        echo "Status: $STATUS_CODE"
    fi

    # 输出响应头（跳过状态行，直到空行）
    echo "$RESPONSE" | sed '1d' | sed '/^$/q' | while IFS= read -r line; do
        line=$(echo "$line" | tr -d '\r')
        # 跳过某些不需要的响应头
        if [[ ! "$line" =~ ^Transfer-Encoding: ]] && [[ ! "$line" =~ ^Connection: ]]; then
            echo "$line"
        fi
    done

    # 输出空行分隔符
    echo ""

    # 输出响应体（空行之后的所有内容）
    echo "$RESPONSE" | sed '1,/^$/d'

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
