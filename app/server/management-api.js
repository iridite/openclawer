#!/usr/bin/env node
// ===========================================================================
// OpenClaw Management API Server
// 提供 Web 管理界面的后端 API
// ===========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const env = require("./core/env");
const { readJSON, writeJSON, readText, readBody, execCommand } = require("./core/io");
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
  STATUS_CACHE_TTL,
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

// 工具函数：从 openclaw.json 读取 token
function getTokenFromConfig() {
  try {
    const config = readJSON(CONFIG_FILE);
    return config?.gateway?.auth?.token || "";
  } catch (err) {
    return "";
  }
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
  clearAllModelConfigs,
  analyzeConfigImpact,
} = configService;

async function setApiKeyProtection(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("请求体必须是 JSON 对象");
  }
  if (typeof payload.enabled !== "boolean") {
    throw new Error("enabled 必须是布尔值");
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
    throw new Error("切换 API 防护前必须确认清空全部模型配置");
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
      throw new Error(`切换 API 防护失败，且${rollbackError}`);
    }
    throw err;
  }
}

const modelTestService = createModelTestService({
  CONFIG_FILE,
  readJSON,
  isApiKeyProtectionEnabled,
});
const { testModel } = modelTestService;

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
  readJSON,
  writeJSON,
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
  getStatus,
  getConfig,
  saveConfig,
  resetConfig,
  validateConfig,
  analyzeConfigImpact,
  addModel,
  deleteModel,
  testModel,
  startGateway,
  stopGateway,
  restartGateway,
  getCurrentVersion,
  getLatestVersion,
  updateVersion,
  getQqbotPluginStatus,
  installQqbotPlugin,
  getWecomPluginStatus,
  installWecomPlugin,
  getConsoleUrl,
  getLogs,
  createBackupArchive,
  importBackupArchiveFromRequest,
  cleanupPathQuietly,
  searchSkills,
  installSkill,
  listSkills,
  uninstallSkill,
  toggleSkill,
  updateSkill,
  updateAllSkills,
  getManagementAccess,
  setManagementAccess,
  getApiKeyProtection,
  setApiKeyProtection,
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

function isLoopbackIp(ip) {
  const normalized = normalizeRemoteIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function getClientIp(req) {
  return normalizeRemoteIp(req?.socket?.remoteAddress || "");
}

function isAccessAllowed(req) {
  if (isLoopbackIp(getClientIp(req))) {
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

// HTTP 请求处理
function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  applyCorsHeaders(req, res);

  if (!isAccessAllowed(req)) {
    const message =
      "Forbidden: Management API is local-only. Enable remote access from System -> Management Access in WebUI.";
    if (pathname.startsWith("/api/")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
      return;
    }
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
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
}

// 启动服务器
const server = http.createServer(handleRequest);

// WebSocket 升级处理 - 转发到 Gateway
server.on("upgrade", (req, socket, head) => {
  handleDashboardUpgrade(req, socket);
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
