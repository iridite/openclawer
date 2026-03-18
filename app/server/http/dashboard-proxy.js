const http = require("http");

const DASHBOARD_PROXY_TIMEOUT_MS = 15000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function createDashboardProxyService(options) {
  const { CONFIG_FILE, GATEWAY_PORT, readJSON } = options;

  function getRequestHost(req) {
    const raw = String(req?.headers?.host || "").trim();
    return raw || "127.0.0.1";
  }

  function parseRequestUrl(req) {
    const rawUrl = typeof req?.url === "string" && req.url ? req.url : "/";
    const host = getRequestHost(req);

    try {
      return new URL(rawUrl, `http://${host}`);
    } catch (err) {
      console.error(
        `[Dashboard Proxy] Invalid request URL "${rawUrl}": ${err.message}`,
      );
      return new URL("/", `http://${host}`);
    }
  }

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
    const fixed = stripHopByHopHeaders(headers);
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

  function stripHopByHopHeaders(headers) {
    const normalized = Object.assign({}, headers);
    Object.keys(normalized).forEach((key) => {
      if (HOP_BY_HOP_HEADERS.has(String(key).toLowerCase())) {
        delete normalized[key];
      }
    });
    return normalized;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildProxyErrorHtml(title, message, detail) {
    const safeTitle = escapeHtml(title || "OpenClaw");
    const safeMessage = escapeHtml(message || "页面暂时不可用");
    const safeDetail = escapeHtml(String(detail || "").trim());
    const detailMarkup = safeDetail
      ? `<p class="detail">${safeDetail}</p>`
      : "";

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: system-ui, sans-serif;
  background: linear-gradient(180deg, #fff7ed 0%, #fff 100%);
  color: #2f1c0f;
}
.card {
  width: min(560px, 100%);
  background: rgba(255,255,255,0.96);
  border: 1px solid #fed7aa;
  border-radius: 18px;
  box-shadow: 0 18px 48px rgba(194, 65, 12, 0.12);
  padding: 28px;
}
.badge {
  display: inline-block;
  margin-bottom: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #ffedd5;
  color: #9a3412;
  font-size: 13px;
  font-weight: 700;
}
h1 {
  margin: 0 0 10px;
  font-size: 24px;
}
p {
  margin: 0 0 10px;
  line-height: 1.6;
}
.detail {
  color: #7c2d12;
  font-size: 14px;
  word-break: break-word;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 18px;
}
a,
button {
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  font: inherit;
  cursor: pointer;
  text-decoration: none;
}
.primary {
  background: #ea580c;
  color: white;
}
.secondary {
  background: #fff;
  color: #9a3412;
  border: 1px solid #fdba74;
}
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Dashboard Proxy</span>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${detailMarkup}
    <div class="actions">
      <button class="primary" onclick="location.reload()">立即重试</button>
      <a class="secondary" href="/">返回管理面板</a>
    </div>
  </div>
</body>
</html>`;
  }

  function sendProxyError(req, res, statusCode, title, message, detail) {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }

    const content = buildProxyErrorHtml(title, message, detail);
    const body = Buffer.from(content, "utf8");
    res.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    res.end(body);
  }

  function buildProxyErrorContext(err) {
    const code = String(err?.code || "").trim();
    const message = String(err?.message || "").trim();
    const detail = code ? `${code}: ${message}` : message;

    if (code === "ECONNREFUSED") {
      return {
        statusCode: 503,
        title: "OpenClaw Gateway 尚未就绪",
        message: "Dashboard 上游服务还没有接受连接，请稍后重试。",
        detail,
      };
    }

    if (
      code === "ETIMEDOUT" ||
      code === "ESOCKETTIMEDOUT" ||
      /timed?\s*out/i.test(message)
    ) {
      return {
        statusCode: 504,
        title: "Dashboard 连接超时",
        message: "已连到管理服务，但 Gateway 上游响应过慢，请检查网关状态或稍后重试。",
        detail,
      };
    }

    return {
      statusCode: 503,
      title: "Dashboard 暂时不可用",
      message: "管理服务无法稳定连接到 Gateway 上游，页面暂时无法显示。",
      detail,
    };
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
    const proxyHeaders = stripHopByHopHeaders(req.headers);
    proxyHeaders.host = `127.0.0.1:${GATEWAY_PORT}`;
    proxyHeaders.origin = `http://127.0.0.1:${GATEWAY_PORT}`;
    proxyHeaders.referer = `http://127.0.0.1:${GATEWAY_PORT}/`;
    delete proxyHeaders["accept-encoding"]; // 禁用 gzip，方便修改 HTML

    let activeProxyRes = null;
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: GATEWAY_PORT,
        path: finalPath,
        method: req.method,
        headers: proxyHeaders,
      },
      (proxyRes) => {
        activeProxyRes = proxyRes;
        const headers = fixResponseHeaders(proxyRes.headers);
        headers["Cache-Control"] = "no-store";
        headers["X-Content-Type-Options"] = "nosniff";

        proxyRes.on("aborted", () => {
          if (!res.headersSent) {
            sendProxyError(
              req,
              res,
              502,
              "Dashboard 响应中断",
              "Gateway 上游在返回页面时提前断开，页面未能完整加载。",
              "",
            );
            return;
          }
          res.destroy();
        });

        proxyRes.on("error", (err) => {
          console.error(`[Dashboard Proxy Upstream Error] ${err.message}`);
          if (!res.headersSent) {
            const context = buildProxyErrorContext(err);
            sendProxyError(
              req,
              res,
              context.statusCode,
              context.title,
              context.message,
              context.detail,
            );
            return;
          }
          res.destroy(err);
        });

        if (isHtmlResponse(proxyRes.headers)) {
          const chunks = [];
          proxyRes.on("data", (chunk) => chunks.push(chunk));
          proxyRes.on("end", () => {
            if (res.writableEnded) {
              return;
            }
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
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            res.end(buf);
          });
        } else {
          res.writeHead(proxyRes.statusCode, headers);
          if (req.method === "HEAD") {
            proxyRes.resume();
            res.end();
            return;
          }
          proxyRes.pipe(res, { end: true });
        }
      },
    );

    proxyReq.setTimeout(DASHBOARD_PROXY_TIMEOUT_MS, () => {
      proxyReq.destroy(new Error("Dashboard upstream timed out"));
    });

    proxyReq.on("error", (err) => {
      console.error(`[Dashboard Proxy Error] ${err.message}`);
      const context = buildProxyErrorContext(err);
      sendProxyError(
        req,
        res,
        context.statusCode,
        context.title,
        context.message,
        context.detail,
      );
    });

    const abortProxy = () => {
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
      if (activeProxyRes && !activeProxyRes.destroyed) {
        activeProxyRes.destroy();
      }
    };

    req.on("aborted", abortProxy);
    res.on("close", abortProxy);

    if (req.method === "GET" || req.method === "HEAD") {
      proxyReq.end();
    } else {
      req.pipe(proxyReq, { end: true });
    }
    return true;
  }

  function handleDashboardUpgrade(req, socket) {
    const url = parseRequestUrl(req);
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

    const proxyHeaders = stripHopByHopHeaders(req.headers);
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

    proxyReq.setTimeout(DASHBOARD_PROXY_TIMEOUT_MS, () => {
      proxyReq.destroy(new Error("Dashboard websocket upstream timed out"));
    });

    proxyReq.on("response", (proxyRes) => {
      const statusCode = proxyRes.statusCode || 502;
      const statusMessage = proxyRes.statusMessage || "Bad Gateway";
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusMessage}\r\nConnection: close\r\n\r\n`,
      );
      proxyRes.resume();
      socket.destroy();
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
      try {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      } catch (writeErr) {
        // Ignore write failures on a dead socket.
      }
      socket.destroy();
    });

    socket.on("close", () => {
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
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
