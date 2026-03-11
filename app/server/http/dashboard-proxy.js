const http = require("http");

function createDashboardProxyService(options) {
  const { CONFIG_FILE, GATEWAY_PORT, readJSON } = options;

  function getInjectionScript(token) {
    if (!token) return "";
    return `<script>
(function(){
  // 自动配置 OpenClaw Control UI 连接参数
  var SETTINGS_KEY = 'openclaw.control.settings.v1';
  var wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  var wsUrl = wsProto + '://' + location.host + '/dashboard';
  var targetToken = '${token}';

  // 强制设置配置的函数
  function forceSetConfig() {
    try {
      var existing = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      var needsUpdate = false;

      if (existing.gatewayUrl !== wsUrl) {
        existing.gatewayUrl = wsUrl;
        needsUpdate = true;
      }
      if (existing.token !== targetToken) {
        existing.token = targetToken;
        needsUpdate = true;
      }
      if (!existing.sessionKey) {
        existing.sessionKey = 'main';
        needsUpdate = true;
      }

      if (needsUpdate) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(existing));
        console.log('[OC-Deploy] Config enforced:', {
          gatewayUrl: wsUrl,
          token: targetToken.substring(0, 8) + '...'
        });
      }
    } catch(e) {
      console.error('[OC-Deploy] Failed to enforce config:', e);
    }
  }

  // 立即执行一次
  forceSetConfig();

  // 每5秒检查一次，确保配置不被覆盖
  setInterval(forceSetConfig, 5000);

  // 监听 localStorage 变化（其他标签页或代码修改时）
  window.addEventListener('storage', function(e) {
    if (e.key === SETTINGS_KEY) {
      forceSetConfig();
    }
  });
})();
</script>`;
  }

  function fixResponseHeaders(headers) {
    const fixed = Object.assign({}, headers);
    delete fixed["x-frame-options"];
    if (fixed["content-security-policy"]) {
      fixed["content-security-policy"] = fixed["content-security-policy"]
        .replace(/frame-ancestors\s+'none'/gi, "frame-ancestors *")
        .replace(/frame-ancestors\s+'self'/gi, "frame-ancestors *")
        .replace(/script-src\s+'self'/gi, "script-src 'self' 'unsafe-inline'");
    }
    return fixed;
  }

  function isHtmlResponse(headers) {
    const ct = headers["content-type"] || "";
    return ct.includes("text/html");
  }

  function readGatewayToken() {
    try {
      const config = readJSON(CONFIG_FILE);
      return config?.gateway?.auth?.token || "";
    } catch (err) {
      return "";
    }
  }

  function handleDashboardHttp(req, res, url, pathname) {
    if (!pathname.startsWith("/dashboard")) {
      return false;
    }

    const proxyPath = pathname.replace(/^\/dashboard/, "") || "/";
    const gatewayToken = readGatewayToken();

    // 添加 token 到 URL
    let finalPath = proxyPath + url.search;
    if (gatewayToken && !finalPath.includes("token=")) {
      const sep = finalPath.includes("?") ? "&" : "?";
      finalPath += sep + "token=" + gatewayToken;
    }

    // 构建代理请求头（伪装为 localhost）
    const proxyHeaders = Object.assign({}, req.headers);
    proxyHeaders.host = `127.0.0.1:${GATEWAY_PORT}`;
    proxyHeaders.origin = `http://127.0.0.1:${GATEWAY_PORT}`;
    proxyHeaders.referer = `http://127.0.0.1:${GATEWAY_PORT}/`;
    delete proxyHeaders["accept-encoding"]; // 禁用 gzip，方便修改 HTML

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: GATEWAY_PORT,
        path: finalPath,
        method: req.method,
        headers: proxyHeaders,
      },
      (proxyRes) => {
        const headers = fixResponseHeaders(proxyRes.headers);

        if (isHtmlResponse(proxyRes.headers)) {
          const chunks = [];
          proxyRes.on("data", (chunk) => chunks.push(chunk));
          proxyRes.on("end", () => {
            let body = Buffer.concat(chunks).toString("utf8");

            const injection = getInjectionScript(gatewayToken);
            if (injection) {
              if (body.includes("<head>")) {
                body = body.replace("<head>", "<head>" + injection);
              } else if (body.includes("<head ")) {
                body = body.replace(/<head\s[^>]*>/, "$&" + injection);
              } else {
                body = injection + body;
              }
            }

            const buf = Buffer.from(body, "utf8");
            headers["content-length"] = String(buf.length);
            delete headers["content-encoding"];

            res.writeHead(proxyRes.statusCode, headers);
            res.end(buf);
          });
        } else {
          res.writeHead(proxyRes.statusCode, headers);
          proxyRes.pipe(res, { end: true });
        }
      },
    );

    proxyReq.on("error", (err) => {
      console.error(`[Dashboard Proxy Error] ${err.message}`);
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OpenClaw</title>
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;
font-family:system-ui,sans-serif;background:#fff5f0;color:#666;}
.c{text-align:center;}.s{font-size:3rem;margin-bottom:1rem;}
</style><meta http-equiv="refresh" content="3">
</head><body><div class="c"><div class="s">🦀</div>
<h2>OpenClaw Gateway 启动中...</h2><p>页面将自动刷新</p></div></body></html>`);
    });

    req.pipe(proxyReq, { end: true });
    return true;
  }

  function handleDashboardUpgrade(req, socket) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (!pathname.startsWith("/dashboard")) {
      socket.destroy();
      return false;
    }

    let gatewayToken = "";
    try {
      const config = readJSON(CONFIG_FILE);
      gatewayToken = config?.gateway?.auth?.token || "";
    } catch (e) {
      console.error("[WebSocket] Failed to read token:", e.message);
    }

    // 构建转发路径（去掉 /dashboard 前缀）
    let proxyPath = pathname.replace(/^\/dashboard/, "") || "/";
    if (url.search) {
      proxyPath += url.search;
    }
    if (gatewayToken && !proxyPath.includes("token=")) {
      const sep = proxyPath.includes("?") ? "&" : "?";
      proxyPath += sep + "token=" + gatewayToken;
    }

    const proxyHeaders = Object.assign({}, req.headers);
    proxyHeaders.host = `127.0.0.1:${GATEWAY_PORT}`;
    proxyHeaders.origin = `http://127.0.0.1:${GATEWAY_PORT}`;
    proxyHeaders.referer = `http://127.0.0.1:${GATEWAY_PORT}/`;

    console.log(
      `[WebSocket] Upgrading: ${pathname} -> Gateway:${GATEWAY_PORT}${proxyPath}`,
    );

    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: GATEWAY_PORT,
      path: proxyPath,
      method: "GET",
      headers: proxyHeaders,
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      let response = "HTTP/1.1 101 Switching Protocols\r\n";
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        response += `${key}: ${value}\r\n`;
      }
      response += "\r\n";

      socket.write(response);
      if (proxyHead && proxyHead.length) {
        socket.write(proxyHead);
      }

      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      proxySocket.on("error", (err) => {
        console.error("[WebSocket] Gateway socket error:", err.message);
        socket.destroy();
      });
      socket.on("error", (err) => {
        console.error("[WebSocket] Client socket error:", err.message);
        proxySocket.destroy();
      });
    });

    proxyReq.on("error", (err) => {
      console.error("[WebSocket] Proxy request error:", err.message);
      socket.destroy();
    });

    proxyReq.end();
    return true;
  }

  return {
    handleDashboardHttp,
    handleDashboardUpgrade,
  };
}

module.exports = {
  createDashboardProxyService,
};
