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
  readJSON,
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

const configService = createConfigService({
  CONFIG_FILE,
  INITIAL_CONFIG_FILE,
  GATEWAY_PORT,
  OC_PKG_JSON_PATH,
  DEFAULT_ALLOWED_PLUGINS,
  readJSON,
  writeJSON,
  getTokenFromConfig,
  restartGateway,
});
const {
  getConfig,
  saveConfig,
  resetConfig,
  addModel,
  deleteModel,
  validateConfig,
} = configService;

const modelTestService = createModelTestService({ execCommand });
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
  execCommand,
});
const {
  getQqbotPluginStatus,
  installQqbotPlugin,
  getWecomPluginStatus,
  installWecomPlugin,
} = pluginService;

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
});
const { handleApiRoutes } = router;

const staticFileService = createStaticFileService({
  UI_DIR: path.join(TRIM_APPDEST, "ui"),
});
const { handleStaticRequest } = staticFileService;

// HTTP 请求处理
function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS 头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(200);
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
  handleStaticRequest(pathname, res);
}

// 启动服务器
const server = http.createServer(handleRequest);

// WebSocket 升级处理 - 转发到 Gateway
server.on("upgrade", (req, socket, head) => {
  handleDashboardUpgrade(req, socket);
});

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
