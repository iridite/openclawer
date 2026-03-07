#!/usr/bin/env node
// ===========================================================================
// OpenClaw Management API Server
// 提供 Web 管理界面的后端 API
// ===========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");

const PORT = parseInt(process.env.MANAGEMENT_PORT || "18790", 10);
const BIND_ADDR = process.env.BIND_ADDR || "0.0.0.0";

// 路径配置
const TRIM_PKGVAR = process.env.TRIM_PKGVAR || "/var/apps/openclaw/var";
const TRIM_APPDEST = process.env.TRIM_APPDEST || "/var/apps/openclaw/target";
const CONFIG_FILE = "/root/.openclaw/openclaw.json"; // hard-coded
const OC_HOME = "/root/.openclaw";
const OC_PKG_JSON_PATH = path.join(
  TRIM_PKGVAR,
  "node_modules",
  "openclaw",
  "package.json",
);
const TOKEN_FILE = path.join(TRIM_PKGVAR, "gateway_token");
const DASHBOARD_PID_FILE = path.join(TRIM_PKGVAR, "app.pid"); // name's different
const GATEWAY_PID_FILE = path.join(TRIM_PKGVAR, "gateway.pid"); // name's different
const LOG_FILE = path.join(TRIM_PKGVAR, "openclaw.log"); // TODO 暂时不能确定 openclaw 的log 在哪里

const GATEWAY_PORT = 18789;
// 使用 fnOS 系统 Node.js (nodejs_v22 依赖包)
const NODE_BIN_DIR = "/var/apps/nodejs_v22/target/bin";
const PKG_NODE_BIN_DIR = path.join(TRIM_PKGVAR, "node_modules", ".bin");

// 工具函数：读取 JSON 文件
function readJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

// 工具函数：写入 JSON 文件
function writeJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("写入文件失败:", err);
    return false;
  }
}

// 工具函数：读取文本文件
function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (err) {
    return "";
  }
}

// 工具函数：检查进程是否运行
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

// 工具函数：执行命令
function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`,
      ...options.env,
    };

    exec(command, { ...options, env }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// API: 获取系统状态
async function getStatus() {
  const status = {
    gateway: "stopped",
    gatewayPid: null,
    version: "unknown",
    configExists: fs.existsSync(CONFIG_FILE),
    token: readText(TOKEN_FILE),
    uptime: null,
  };

  // 检查 Gateway 进程
  if (fs.existsSync(GATEWAY_PID_FILE)) {
    const pid = parseInt(readText(GATEWAY_PID_FILE), 10);
    if (pid && isProcessRunning(pid)) {
      status.gateway = "running";
      status.gatewayPid = pid;
    }
  }

  // 获取版本信息
  try {
    const packageJson = readJSON(OC_PKG_JSON_PATH);
    if (packageJson && packageJson.version) {
      status.version = packageJson.version;
    }
  } catch (err) {
    // 忽略错误
  }

  return status;
}

// API: 获取配置
async function getConfig() {
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    return {
      models: {},
      channels: {},
      gateway: {
        port: GATEWAY_PORT,
        bind: "0.0.0.0",
        auth: {
          mode: "token",
          token: readText(TOKEN_FILE),
        },
      },
    };
  }
  return config;
}

// API: 保存配置
async function saveConfig(newConfig) {
  // 验证配置
  if (!newConfig || typeof newConfig !== "object") {
    throw new Error("无效的配置格式");
  }

  // 备份旧配置
  if (fs.existsSync(CONFIG_FILE)) {
    const backupFile = CONFIG_FILE + ".backup." + Date.now();
    fs.copyFileSync(CONFIG_FILE, backupFile);
  }

  // 写入新配置
  const success = writeJSON(CONFIG_FILE, newConfig);
  if (!success) {
    throw new Error("写入配置文件失败");
  }

  return { success: true };
}

// API: 验证配置
async function validateConfig(config) {
  const errors = [];

  // 验证 models
  if (config.models) {
    for (const [name, model] of Object.entries(config.models)) {
      if (!model.provider) {
        errors.push(`模型 ${name} 缺少 provider 字段`);
      }
      if (!model.apiKey) {
        errors.push(`模型 ${name} 缺少 apiKey 字段`);
      }
    }
  }

  // 验证 channels
  if (config.channels) {
    for (const [name, channel] of Object.entries(config.channels)) {
      if (!channel.type) {
        errors.push(`渠道 ${name} 缺少 type 字段`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// API: 重启 Gateway
async function restartGateway() {
  try {
    // TODO 需要调用 Pm2 指令进行 gateway 控制
    // 晚点修复
    const mainScript = path.join(TRIM_APPDEST, "..", "..", "cmd", "main");
    await execCommand(`bash ${mainScript} restart`);
    return { success: true };
  } catch (err) {
    throw new Error("重启失败: " + err.message);
  }
}

// API: 获取当前版本
async function getCurrentVersion() {
  const packageJson = readJSON(OC_PKG_JSON_PATH);
  return {
    version: packageJson ? packageJson.version : "unknown",
  };
}

// API: 获取最新版本
async function getLatestVersion() {
  try {
    const output = await execCommand("npm view openclaw version"); // 需要指定环境变量，已经在 execCommand 中搞定了
    const latestVersion = output.trim();
    const currentVersion = (await getCurrentVersion()).version;

    return {
      version: latestVersion,
      current: currentVersion,
      available: latestVersion !== currentVersion,
    };
  } catch (err) {
    throw new Error("无法获取最新版本: " + err.message);
  }
}

// API: 更新版本
async function updateVersion() {
  // TODO：应该是通过 npm 的内置升级功能进行升级
  return {
    success: false,
    message: "还没做",
  };
}

// API: 获取控制台 URL
async function getConsoleUrl() {
  const token = readText(TOKEN_FILE);
  const host = "127.0.0.1"; // TODO 或从请求头获取
  return {
    url: `http://${host}:${GATEWAY_PORT}`,
    token,
  };
}

// API: 获取日志
async function getLogs(lines = 100) {
  try {
    const output = await execCommand(`tail -n ${lines} ${LOG_FILE}`);
    return { logs: output };
  } catch (err) {
    return { logs: "" };
  }
}

// 工具函数：获取 MIME 类型
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// 工具函数：提供静态文件
function serveStaticFile(filePath, res) {
  // 安全检查：防止目录穿越
  if (filePath.includes("..")) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("400 Bad Request");
    return;
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
    return;
  }

  // 读取并返回文件
  const mimeType = getMimeType(filePath);
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": mimeType });
  res.end(content);
}

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

  // API 路由处理
  if (pathname.startsWith("/api/")) {
    const routes = {
      "GET /api/status": getStatus,
      "GET /api/config": getConfig,
      "POST /api/config": async () => {
        const body = await readBody(req);
        return saveConfig(JSON.parse(body));
      },
      "POST /api/config/validate": async () => {
        const body = await readBody(req);
        return validateConfig(JSON.parse(body));
      },
      "POST /api/gateway/restart": restartGateway,
      "GET /api/version/current": getCurrentVersion,
      "GET /api/version/latest": getLatestVersion,
      "POST /api/version/update": updateVersion,
      "GET /api/console/url": getConsoleUrl,
      "GET /api/logs": () =>
        getLogs(parseInt(url.searchParams.get("lines") || "100", 10)),
    };

    const routeKey = `${method} ${pathname}`;
    const handler = routes[routeKey];

    if (handler) {
      handler()
        .then((result) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        });
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    }
    return;
  }

  // 静态文件处理
  const UI_DIR = path.join(TRIM_APPDEST, "ui");
  let filePath;

  if (pathname === "/" || pathname === "") {
    // 默认访问 management.html
    filePath = path.join(UI_DIR, "management.html");
  } else {
    // 其他路径
    filePath = path.join(UI_DIR, pathname);
  }

  serveStaticFile(filePath, res);
}

// 读取请求体
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// 启动服务器
const server = http.createServer(handleRequest);

server.listen(PORT, BIND_ADDR, () => {
  console.log(`[management-api] Listening on ${BIND_ADDR}:${PORT}`);
  console.log(`[management-api] Config file: ${CONFIG_FILE}`);
  console.log(`[management-api] Token file: ${TOKEN_FILE}`);
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
