#!/usr/bin/env node
// ===========================================================================
// OpenClaw Management API Server
// 提供 Web 管理界面的后端 API
// ===========================================================================

const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const env = require("./core/env");
const { readJSON, writeJSON, readText, readBody, execCommand } = require("./core/io");
const {
  badRequestError,
  conflictError,
  forbiddenError,
} = require("./core/http-errors");
const { createBackupService } = require("./services/backup");
const { createPluginService } = require("./services/plugins");
const { createSkillsService } = require("./services/skills");
const { createManagementAccessService } = require("./services/management-access");
const { createApiKeyProtectionService } = require("./services/api-key-protection");
const { createDashboardProxyService } = require("./http/dashboard-proxy");
const { createGatewayService } = require("./services/gateway");
const { createConfigService } = require("./services/config");
const { createModelTestService } = require("./services/model-test");
const { createRouter } = require("./http/router");
const { createStaticFileService } = require("./http/static");

console.log(`[Manager] PM2_HOME 已固化为: ${process.env.PM2_HOME}`);

const {
  PORT,
  BIND_ADDR,
  TRIM_PKGVAR,
  TRIM_APPDEST,
  CONFIG_FILE,
  INITIAL_CONFIG_FILE,
  MANAGEMENT_ACCESS_FILE,
  API_KEY_PROTECTION_FILE,
  OC_HOME,
  OC_BIN_PATH,
  OC_JS_PATH,
  OC_PKG_JSON_PATH,
  TOKEN_FILE,
  DASHBOARD_PID_FILE,
  GATEWAY_PID_FILE,
  LOG_FILE,
  GATEWAY_PORT,
  NODE_BIN,
  NODE_BIN_DIR,
  PKG_NODE_BIN_DIR,
  DEFAULT_ALLOWED_PLUGINS,
  BACKUP_MANIFEST_FILE,
  USER_BACKUP_ROOT,
  MAX_BACKUP_UPLOAD_BYTES,
  GATEWAY_RESTART_DELAY,
  NPM_VIEW_TIMEOUT,
  NPM_INSTALL_TIMEOUT,
  MODEL_TEST_TIMEOUT_MS,
  SKILLS_SEARCH_API,
  SKILLS_PRIMARY_DOWNLOAD_API,
  SKILLS_FALLBACK_DOWNLOAD_BASE,
  STATUS_CACHE_TTL,
  MANAGEMENT_ALLOW_REMOTE_DEFAULT,
} = env;

// 工具函数：检查进程是否运行
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

// 工具函数：读取 Gateway token（多源兜底）
function getTokenFromConfig() {
  try {
    const config = readJSON(CONFIG_FILE);
    const configToken = String(config?.gateway?.auth?.token || "").trim();
    if (configToken) {
      return configToken;
    }
  } catch (err) {}

  try {
    const fileToken = String(readText(TOKEN_FILE) || "").trim();
    if (fileToken) {
      return fileToken;
    }
  } catch (err) {}

  return "";
}

function getSystemPaths() {
  return {
    ocHome: OC_HOME,
    configFile: CONFIG_FILE,
    initialConfigFile: INITIAL_CONFIG_FILE,
    configBackupDir: path.dirname(CONFIG_FILE),
    skillsDir: path.join(OC_HOME, "skills"),
    skillsLockFile: path.join(OC_HOME, "skills", ".skills_store_lock.json"),
    pluginsDir: path.join(OC_HOME, "plugins"),
    runtimeDir: TRIM_PKGVAR,
    appDir: TRIM_APPDEST,
    logFile: LOG_FILE,
    infoLogFile: path.join(TRIM_PKGVAR, "info.log"),
    ocBinPath: OC_BIN_PATH,
    dashboardPidFile: DASHBOARD_PID_FILE,
    gatewayPidFile: GATEWAY_PID_FILE,
  };
}

const gatewayService = createGatewayService({
  CONFIG_FILE,
  GATEWAY_PORT,
  LOG_FILE,
  NODE_BIN,
  OC_JS_PATH,
  OC_PKG_JSON_PATH,
  GATEWAY_PID_FILE,
  TRIM_PKGVAR,
  GATEWAY_RESTART_DELAY,
  NPM_VIEW_TIMEOUT,
  NPM_INSTALL_TIMEOUT,
  STATUS_CACHE_TTL,
  readJSON,
  writeJSON,
  execCommand,
  isProcessRunning,
  getTokenFromConfig,
});
const {
  startGateway,
  stopGateway,
  restartGateway,
  getStatus,
  getCurrentVersion,
  getLatestVersion,
  updateVersion,
  getConsoleUrl,
  getLogs,
} = gatewayService;

const apiKeyProtectionService = createApiKeyProtectionService({
  API_KEY_PROTECTION_FILE,
  readJSON,
  writeJSON,
});
const {
  isApiKeyProtectionEnabled,
  getApiKeyProtection,
  setApiKeyProtection: persistApiKeyProtection,
} = apiKeyProtectionService;

const configService = createConfigService({
  CONFIG_FILE,
  INITIAL_CONFIG_FILE,
  GATEWAY_PORT,
  OC_HOME,
  OC_PKG_JSON_PATH,
  DEFAULT_ALLOWED_PLUGINS,
  readJSON,
  writeJSON,
  getTokenFromConfig,
  restartGateway,
  isApiKeyProtectionEnabled,
});
const {
  getConfig,
  saveConfig,
  resetConfig,
  validateConfig,
  addModel,
  deleteModel,
  setPrimaryModel,
  upsertChannel,
  deleteChannel,
  updateToolProfile,
  clearAllModelConfigs,
  analyzeConfigImpact,
} = configService;

async function setApiKeyProtection(payload) {
  if (!payload || typeof payload !== "object") {
    throw badRequestError("请求体必须是 JSON 对象");
  }
  if (typeof payload.enabled !== "boolean") {
    throw badRequestError("enabled 必须是布尔值");
  }

  const currentState = await getApiKeyProtection();
  const currentEnabled = currentState.enabled === true;
  const nextEnabled = payload.enabled === true;

  if (currentEnabled === nextEnabled) {
    return {
      success: true,
      unchanged: true,
      ...currentState,
      modelsReset: {
        performed: false,
      },
    };
  }

  if (payload.confirmReset !== true) {
    throw badRequestError("切换 API 防护前必须确认清空全部模型配置");
  }

  const reason = nextEnabled
    ? "enable-api-key-protection"
    : "disable-api-key-protection";
  const resetResult = await clearAllModelConfigs({ reason });

  try {
    const persisted = await persistApiKeyProtection({ enabled: nextEnabled });
    return {
      ...persisted,
      modelsReset: {
        performed: true,
        reason,
        backupFile: resetResult.backupFile || null,
        secretFilePath: resetResult.secretFilePath || null,
        secretBackupFile: resetResult.secretBackupFile || null,
        providersCleared: resetResult.providersCleared || 0,
        modelsCleared: resetResult.modelsCleared || 0,
        agentMappingsCleared: resetResult.agentMappingsCleared || 0,
        secretCleanupErrors: resetResult.secretCleanupErrors || 0,
      },
    };
  } catch (err) {
    let rollbackError = "";
    if (resetResult.backupFile && fs.existsSync(resetResult.backupFile)) {
      try {
        fs.copyFileSync(resetResult.backupFile, CONFIG_FILE);
      } catch (restoreErr) {
        rollbackError = `模型配置回滚失败: ${restoreErr.message}`;
      }
    }
    if (resetResult.secretBackupFile && fs.existsSync(resetResult.secretBackupFile)) {
      try {
        const secretFilePath = String(resetResult.secretFilePath || "").trim();
        if (secretFilePath) {
          fs.copyFileSync(resetResult.secretBackupFile, secretFilePath);
        }
      } catch (restoreErr) {
        rollbackError = rollbackError
          ? `${rollbackError}；密钥文件回滚失败: ${restoreErr.message}`
          : `密钥文件回滚失败: ${restoreErr.message}`;
      }
    }
    if (rollbackError) {
      throw conflictError(`切换 API 防护失败，且${rollbackError}`);
    }
    throw err;
  }
}

const modelTestService = createModelTestService({
  CONFIG_FILE,
  readJSON,
  isApiKeyProtectionEnabled,
  timeoutMs: MODEL_TEST_TIMEOUT_MS,
});
const { prepareModelTest, testModel } = modelTestService;

const backupService = createBackupService({
  OC_HOME,
  TRIM_PKGVAR,
  BACKUP_MANIFEST_FILE,
  USER_BACKUP_ROOT,
  MAX_BACKUP_UPLOAD_BYTES,
  readJSON,
  execCommand,
  restartGateway,
});
const {
  createBackupArchive,
  importBackupArchiveFromRequest,
  cleanupPathQuietly,
} = backupService;
const pluginService = createPluginService({
  OC_HOME,
  TRIM_PKGVAR,
  CONFIG_FILE,
  OC_BIN_PATH,
  NODE_BIN,
  NODE_BIN_DIR,
  PKG_NODE_BIN_DIR,
  readJSON,
  writeJSON,
  execCommand,
  restartGateway,
});
const {
  getQqbotPluginStatus,
  installQqbotPlugin,
  getWecomPluginStatus,
  installWecomPlugin,
} = pluginService;

const skillsService = createSkillsService({
  OC_HOME,
  TRIM_PKGVAR,
  CONFIG_FILE,
  SKILLS_SEARCH_API,
  SKILLS_PRIMARY_DOWNLOAD_API,
  SKILLS_FALLBACK_DOWNLOAD_BASE,
  readJSON,
  writeJSON,
  execCommand,
});
const {
  search: searchSkills,
  install: installSkill,
  list: listSkills,
  uninstall: uninstallSkill,
  toggle: toggleSkill,
  update: updateSkill,
  updateAll: updateAllSkills,
} = skillsService;

const managementAccessService = createManagementAccessService({
  MANAGEMENT_ACCESS_FILE,
  MANAGEMENT_ALLOW_REMOTE_DEFAULT,
  readJSON,
  writeJSON,
});
const {
  isRemoteAccessEnabled,
  getManagementAccess,
  setManagementAccess,
} = managementAccessService;

const dashboardProxy = createDashboardProxyService({
  CONFIG_FILE,
  GATEWAY_PORT,
  readJSON,
});
const { handleDashboardHttp, handleDashboardUpgrade } = dashboardProxy;

const router = createRouter({
  readBody,
  services: {
    gateway: gatewayService,
    config: configService,
    modelTest: modelTestService,
    plugins: pluginService,
    backup: backupService,
    skills: skillsService,
    managementAccess: managementAccessService,
    apiKeyProtection: {
      getApiKeyProtection,
      setApiKeyProtection,
    },
    system: {
      getSystemPaths,
    },
  },
});
const { handleApiRoutes } = router;

const staticFileService = createStaticFileService({
  UI_DIR: path.join(TRIM_APPDEST, "ui"),
});
const { handleStaticRequest } = staticFileService;

function normalizeRemoteIp(ip) {
  const raw = String(ip || "").trim();
  if (!raw) return "";
  if (raw.startsWith("::ffff:")) {
    return raw.slice("::ffff:".length);
  }
  return raw;
}

function normalizeForwardedToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return "";

  // RFC 7239 style: for=1.2.3.4
  const forwarded = token.match(/^for=(.+)$/i);
  const value = forwarded ? String(forwarded[1] || "").trim() : token;
  const unquoted = value.replace(/^"|"$/g, "").trim();

  if (unquoted.startsWith("[") && unquoted.includes("]")) {
    return unquoted.slice(1, unquoted.indexOf("]")).trim();
  }

  // 仅处理 IPv4:port；IPv6 直接交给 net.isIP 判断。
  if (unquoted.includes(".") && unquoted.includes(":")) {
    const maybeIpv4 = unquoted.split(":")[0];
    if (net.isIP(maybeIpv4) === 4) {
      return maybeIpv4;
    }
  }

  return unquoted;
}

function isLoopbackIp(ip) {
  const normalized = normalizeRemoteIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function isPrivateLanIp(ip) {
  const normalized = normalizeRemoteIp(ip);
  if (!normalized) {
    return false;
  }

  if (net.isIP(normalized) === 4) {
    const parts = normalized.split(".").map((part) => parseInt(part, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      return false;
    }
    const [a, b] = parts;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (net.isIP(normalized) === 6) {
    const lower = normalized.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }

  return false;
}

function getClientIp(req) {
  const socketIp = normalizeRemoteIp(req?.socket?.remoteAddress || "");
  const trustForwardedHeaders = isLoopbackIp(socketIp);

  // Security boundary: forwarded IP headers are only trusted when the immediate
  // peer is local loopback (typically an on-box reverse proxy).
  if (!trustForwardedHeaders) {
    return socketIp;
  }

  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const tokens = forwardedFor.split(",");
    for (const token of tokens) {
      const parsed = normalizeRemoteIp(normalizeForwardedToken(token));
      if (net.isIP(parsed)) {
        return parsed;
      }
    }
  }

  const realIp = normalizeRemoteIp(normalizeForwardedToken(req?.headers?.["x-real-ip"] || ""));
  if (net.isIP(realIp)) {
    return realIp;
  }

  return socketIp;
}

function getRequestHost(req) {
  const raw = String(req?.headers?.host || "").trim();
  return raw || `127.0.0.1:${PORT}`;
}

function parseRequestUrl(req) {
  const rawUrl = typeof req?.url === "string" && req.url ? req.url : "/";
  const host = getRequestHost(req);

  try {
    return new URL(rawUrl, `http://${host}`);
  } catch (err) {
    console.error(
      `[management-api] Invalid request URL "${rawUrl}": ${err.message}`,
    );
    return new URL("/", `http://${host}`);
  }
}

function isAccessAllowed(req) {
  const clientIp = getClientIp(req);
  if (isLoopbackIp(clientIp) || isPrivateLanIp(clientIp)) {
    return true;
  }
  return isRemoteAccessEnabled();
}

function applyCorsHeaders(req, res) {
  // Management UI is same-origin by design. Reflect only same-origin requests.
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    const expectedHttp = `http://${host}`;
    const expectedHttps = `https://${host}`;
    if (origin === expectedHttp || origin === expectedHttps) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildForbiddenHelpHtml(clientIp) {
  const safeIp = escapeHtml(clientIp || "unknown");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>管理访问被拦截 (403)</title>
<style>
  body { margin:0; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; background:#f7f8fa; color:#111827; }
  .wrap { max-width:760px; margin:40px auto; padding:0 16px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:20px; box-shadow:0 8px 24px rgba(0,0,0,.06); }
  .badge { display:inline-block; font-size:12px; padding:4px 8px; border-radius:999px; background:#fef3c7; color:#92400e; margin-bottom:10px; }
  h1 { margin:0 0 8px; font-size:22px; }
  p { margin:8px 0; line-height:1.6; }
  ol { margin:8px 0 12px 20px; line-height:1.7; }
  code { background:#f3f4f6; padding:2px 6px; border-radius:6px; }
  .tip { font-size:13px; color:#6b7280; }
  .actions { margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; }
  a, button { border:0; border-radius:10px; padding:10px 14px; font-size:14px; cursor:pointer; text-decoration:none; }
  .primary { background:#2563eb; color:#fff; }
  .secondary { background:#eef2ff; color:#1e40af; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge">HTTP 403 · Access Blocked</div>
      <h1>管理访问被策略拦截</h1>
      <p>当前来源地址 <code>${safeIp}</code> 不在允许范围内，所以管理面板暂时不可访问。</p>
      <p>可以按下面步骤恢复：</p>
      <ol>
        <li>先通过 <b>fnOS 本地入口 / 局域网入口</b> 打开 OC-Deploy 管理面板。</li>
        <li>进入 <b>系统 → 管理访问</b>，开启 <b>允许非内网地址访问</b>。</li>
        <li>刷新当前页面重试远程访问。</li>
      </ol>
      <p class="tip">如果你就是通过 fnOS 提供的远程链接访问，通常开启上述选项后即可恢复。</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">刷新重试</button>
        <a class="secondary" href="/">返回首页</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// HTTP 请求处理
function handleRequest(req, res) {
  const rawUrl = String(req?.url || "");
  let url = null;
  let pathname = "/";
  try {
    url = parseRequestUrl(req);
    pathname = url.pathname;
    const method = req.method;

    applyCorsHeaders(req, res);

    if (!isAccessAllowed(req)) {
      const clientIp = getClientIp(req);
      const message =
        "管理访问被策略拦截：当前来源不在允许范围。可在 WebUI「系统 -> 管理访问」中开启“允许非内网地址访问”。";
      if (pathname.startsWith("/api/")) {
        res.writeHead(403, { "Content-Type": "application/json" });
        const error = forbiddenError(message);
        res.end(JSON.stringify({
          error: error.message,
          code: error.code,
          status: error.statusCode,
          details: {
            clientIp,
            action: "开启 WebUI 系统 -> 管理访问 -> 允许非内网地址访问",
            fallback: "改用 fnOS 本地/局域网入口后开启该选项",
          },
        }));
        return;
      }
      const html = buildForbiddenHelpHtml(clientIp);
      const body = Buffer.from(html, "utf8");
      res.writeHead(403, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(body.length),
        "Cache-Control": "no-store",
      });
      if (method === "HEAD") {
        res.end();
      } else {
        res.end(body);
      }
      return;
    }

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Dashboard 代理处理 - 直接转发到 Gateway (18789)
    if (handleDashboardHttp(req, res, url, pathname)) {
      return;
    }

    // API 路由处理
    if (pathname.startsWith("/api/")) {
      handleApiRoutes(req, res, pathname, method, url);
      return;
    }

    // 静态文件处理
    handleStaticRequest(req, pathname, res);
  } catch (err) {
    console.error(
      `[management-api] Request handling failed for ${rawUrl || "/"}: ${err.stack || err.message}`,
    );

    if (res.headersSent || res.writableEnded) {
      res.destroy(err);
      return;
    }

    if (pathname.startsWith("/api/") || rawUrl.startsWith("/api/")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Internal Server Error",
        code: "internal_error",
        status: 500,
      }));
      return;
    }

    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
}

// 启动服务器
const server = http.createServer(handleRequest);
server.on("clientError", (err, socket) => {
  console.error(`[management-api] Client error: ${err.message}`);
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

// WebSocket 升级处理 - 转发到 Gateway
server.on("upgrade", (req, socket, head) => {
  try {
    if (!isAccessAllowed(req)) {
      try {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\n" +
          "Content-Type: text/plain; charset=utf-8\r\n" +
          "Connection: close\r\n\r\n" +
          "Forbidden: Management API only allows localhost/LAN by default.",
        );
      } catch (writeErr) {
        // Ignore write failures on broken sockets.
      }
      socket.destroy();
      return;
    }

    handleDashboardUpgrade(req, socket, head);
  } catch (err) {
    console.error(
      `[management-api] Upgrade handling failed: ${err.stack || err.message}`,
    );
    socket.destroy();
  }
});

async function bootstrap() {
  try {
    await getConfig();
    console.log("[management-api] Config migration preflight completed");
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown error";
    console.warn(`[management-api] Config preflight failed: ${message}`);
  }

  server.listen(PORT, BIND_ADDR, () => {
    console.log(`[management-api] Listening on ${BIND_ADDR}:${PORT}`);
    console.log(`[management-api] Config file: ${CONFIG_FILE}`);
    console.log(
      `[management-api] Token source: openclaw.json (gateway.auth.token)`,
    );
    console.log(
      `[management-api] WebSocket upgrade enabled for /dashboard -> Gateway:${GATEWAY_PORT}`,
    );
  });
}

bootstrap();

// 优雅退出
process.on("SIGTERM", () => {
  console.log("[management-api] Received SIGTERM, shutting down...");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[management-api] Received SIGINT, shutting down...");
  server.close(() => {
    process.exit(0);
  });
});
