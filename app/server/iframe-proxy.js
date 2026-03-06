#!/usr/bin/env node
// ===========================================================================
// OpenClaw iframe 反向代理 v3
// 监听 PROXY_PORT (默认 18790)，将请求转发到 Gateway (默认 18789)
//
// 功能:
//   1. 剥离 X-Frame-Options / CSP frame-ancestors，允许 iframe 嵌入
//   2. 伪装 Origin/Host/Referer 为 localhost，绕过服务端 origin 检查
//   3. 在 HTML 响应中注入 JS，自动配置 token + 绕过设备身份验证
//   4. 转发 WebSocket 并自动注入 token
// ===========================================================================

const http = require('http');
const fs   = require('fs');

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const PROXY_PORT   = parseInt(process.env.PROXY_PORT   || '18790', 10);
const BIND_ADDR    = process.env.BIND_ADDR || '0.0.0.0';

// 读取 token
let gatewayToken = process.env.GATEWAY_TOKEN || '';
const tokenFile = process.env.TOKEN_FILE || '';
if (!gatewayToken && tokenFile) {
  try { gatewayToken = fs.readFileSync(tokenFile, 'utf8').trim(); } catch (e) {}
}

// 生成注入到首页 HTML 中的 script
// 作用: 在 OpenClaw SPA 加载前，把 token 写入 localStorage，
// 这样前端自动使用 token 认证，无需设备身份验证
function getInjectionScript() {
  if (!gatewayToken) return '';
  return `<script>
(function(){
  // 自动配置 OpenClaw Control UI 连接参数
  var SETTINGS_KEY = 'openclaw.control.settings.v1';
  var wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  var wsUrl = wsProto + '://' + location.host;
  try {
    var existing = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    existing.gatewayUrl = wsUrl;
    existing.token = '${gatewayToken}';
    if (!existing.sessionKey) existing.sessionKey = 'main';
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(existing));
  } catch(e) {}
})();
</script>`;
}

// 构建转发请求头（伪装为 localhost）
function buildProxyHeaders(originalHeaders) {
  const headers = Object.assign({}, originalHeaders);
  headers.host    = '127.0.0.1:' + GATEWAY_PORT;
  headers.origin  = 'http://127.0.0.1:' + GATEWAY_PORT;
  headers.referer = 'http://127.0.0.1:' + GATEWAY_PORT + '/';
  return headers;
}

// 修改响应头：移除 iframe 限制
function fixResponseHeaders(headers) {
  const fixed = Object.assign({}, headers);
  delete fixed['x-frame-options'];
  if (fixed['content-security-policy']) {
    fixed['content-security-policy'] = fixed['content-security-policy']
      .replace(/frame-ancestors\s+'none'/gi, "frame-ancestors *")
      .replace(/frame-ancestors\s+'self'/gi, "frame-ancestors *")
      // 允许内联 script（我们注入的 localStorage 配置脚本）
      .replace(/script-src\s+'self'/gi, "script-src 'self' 'unsafe-inline'");
  }
  return fixed;
}

function isHtmlResponse(headers) {
  const ct = headers['content-type'] || '';
  return ct.includes('text/html');
}

const server = http.createServer((clientReq, clientRes) => {
  let reqPath = clientReq.url || '/';
  if (gatewayToken && !reqPath.includes('token=')) {
    const sep = reqPath.includes('?') ? '&' : '?';
    reqPath = reqPath + sep + 'token=' + gatewayToken;
  }

  // 禁用 gzip（这样我们能修改 HTML body）
  const proxyHeaders = buildProxyHeaders(clientReq.headers);
  delete proxyHeaders['accept-encoding'];

  const proxyOpts = {
    hostname: '127.0.0.1',
    port:     GATEWAY_PORT,
    path:     reqPath,
    method:   clientReq.method,
    headers:  proxyHeaders
  };

  const proxyReq = http.request(proxyOpts, (proxyRes) => {
    const headers = fixResponseHeaders(proxyRes.headers);

    if (isHtmlResponse(proxyRes.headers)) {
      // HTML 响应: 收集完整 body 后注入 script
      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');

        const injection = getInjectionScript();
        if (injection) {
          if (body.includes('<head>')) {
            body = body.replace('<head>', '<head>' + injection);
          } else if (body.includes('<head ')) {
            body = body.replace(/<head\s[^>]*>/, '$&' + injection);
          } else {
            body = injection + body;
          }
        }

        const buf = Buffer.from(body, 'utf8');
        headers['content-length'] = String(buf.length);
        delete headers['content-encoding'];

        clientRes.writeHead(proxyRes.statusCode, headers);
        clientRes.end(buf);
      });
    } else {
      clientRes.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(clientRes, { end: true });
    }
  });

  proxyReq.on('error', (err) => {
    clientRes.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    clientRes.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OpenClaw</title>
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;
font-family:system-ui,sans-serif;background:#fff5f0;color:#666;}
.c{text-align:center;}.s{font-size:3rem;margin-bottom:1rem;}
</style><meta http-equiv="refresh" content="3">
</head><body><div class="c"><div class="s">🦀</div>
<h2>OpenClaw Gateway 启动中...</h2><p>页面将自动刷新</p></div></body></html>`);
  });

  clientReq.pipe(proxyReq, { end: true });
});

// WebSocket 升级转发
server.on('upgrade', (clientReq, clientSocket, head) => {
  let reqPath = clientReq.url || '/';
  if (gatewayToken && !reqPath.includes('token=')) {
    const sep = reqPath.includes('?') ? '&' : '?';
    reqPath = reqPath + sep + 'token=' + gatewayToken;
  }

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port:     GATEWAY_PORT,
    path:     reqPath,
    method:   'GET',
    headers:  buildProxyHeaders(clientReq.headers)
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    let response = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      response += key + ': ' + value + '\r\n';
    }
    response += '\r\n';
    clientSocket.write(response);
    if (proxyHead && proxyHead.length) clientSocket.write(proxyHead);

    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);

    proxySocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => proxySocket.destroy());
  });

  proxyReq.on('error', () => {
    clientSocket.destroy();
  });

  proxyReq.end();
});

server.listen(PROXY_PORT, BIND_ADDR, () => {
  console.log(`[iframe-proxy] v3 listening on ${BIND_ADDR}:${PROXY_PORT} -> 127.0.0.1:${GATEWAY_PORT}`);
  if (gatewayToken) console.log('[iframe-proxy] Token auto-injection enabled (URL + localStorage)');
});
