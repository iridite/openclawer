#!/usr/bin/env node
// ===========================================================================
// OpenClaw Management API Server
// 提供 Web 管理界面的后端 API
// ===========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
// const pm2 = require("pm2");
const { spawn, exec } = require("child_process");

process.env.PM2_HOME = "/var/apps/oc-deploy/var/.pm2";
console.log(`[Manager] PM2_HOME 已固化为: ${process.env.PM2_HOME}`);

const PORT = parseInt(process.env.MANAGEMENT_PORT || "18790", 10);
const BIND_ADDR = process.env.BIND_ADDR || "0.0.0.0";

// 路径配置
const TRIM_PKGVAR = "/var/apps/oc-deploy/var";
const TRIM_APPDEST = "/var/apps/oc-deploy/target";
const CONFIG_FILE = "/root/.openclaw/openclaw.json"; // hard-coded

// oc
const OC_HOME = "/root/.openclaw";
const OC_PKG_JSON_PATH = path.join(
  TRIM_PKGVAR,
  "node_modules",
  "openclaw",
  "package.json",
);
const TOKEN_FILE = path.join(TRIM_PKGVAR, "gateway_token"); //TODO token 需要等 gateawy 成功启动之后才能够自动生成并获取
const DASHBOARD_PID_FILE = path.join(TRIM_PKGVAR, "app.pid"); // name's different
const GATEWAY_PID_FILE = path.join(TRIM_PKGVAR, "gateway.pid"); // name's different
const LOG_FILE = path.join(TRIM_PKGVAR, "openclaw.log"); // TODO 暂时不能确定 openclaw 的log 在哪里

const GATEWAY_PORT = 18789;

// 使用 fnOS 系统 Node.js (nodejs_v22 依赖包)
const NODE_BIN_DIR = "/var/apps/nodejs_v22/target/bin";
const NODE_BIN = path.join(NODE_BIN_DIR, "node");
const PKG_NODE_BIN_DIR = path.join(TRIM_PKGVAR, "node_modules", ".bin");
// const PM2_SCRIPT_PATH = path.join(TRIM_APPDEST, "server", "pm2.config.js"); //TODO

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

    const timeout = options.timeout || 15000;

    exec(command, { ...options, env, timeout }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`命令超时 (${timeout}ms)`));
        } else {
          reject({ error, stderr: stderr || error.message });
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// 工具函数
// 原生工具获取 gateway 状态
// 通过端口反查进程，获取 PID 后再查询 CPU、内存、启动时间等信息
// TODO 需要对执行的二进制名称进行检查，以确保找到的确实是 openclaw gateway 的进程，而不是其他占用同一端口的程序
async function checkGatewayStatus() {
  const GATEWAY_PORT = 18791; // OpenClaw 默认端口

  try {
    // 1. 通过端口号查找 PID
    // Linux 下推荐使用 netstat 或 lsof。这里使用 netstat 比较通用
    // 命令逻辑：找到监听端口的行 -> 提取 PID/ProgramName -> 切割出 PID
    const { stdout: netstatOut } = await execPromise(
      `netstat -tunlp | grep :${GATEWAY_PORT} | awk '{print $7}' | cut -d'/' -f1`
    );

    const pid = netstatOut.trim();

    // 2. 如果 PID 为空，说明服务没启动
    if (!pid || isNaN(pid)) {
      return {
        status: "NOT_FOUND",
        online: false
      };
    }

    // 3. 获取进程详情 (CPU, 内存, 启动时间)
    // ps 命令参数说明：
    // %cpu: CPU 占用率
    // rss: 物理内存占用 (单位 KB)
    // lstart: 具体的启动时间
    const { stdout: psOut } = await execPromise(
      `ps -p ${pid} -o %cpu,rss,lstart --no-headers`
    );

    const stats = psOut.trim().split(/\s+/);
    // 示例 ps 输出: "0.5  65432 Sun Mar  8 15:00:00 2026"
    // 注意：ps 的 lstart 格式通常由 5 个部分组成

    const cpu = parseFloat(stats[0]);
    const memory = parseInt(stats[1]) * 1024; // 转为字节 (Bytes)

    // 解析启动时间并计算 uptime (毫秒)
    const startTimeStr = stats.slice(2).join(' ');
    const startTimeMs = new Date(startTimeStr).getTime();
    const uptime = Date.now() - startTimeMs;

    return {
      status: "online",
      online: true,
      pid: parseInt(pid),
      cpu: cpu,          // CPU 占用 %
      memory: memory,    // 内存占用 (Bytes)
      uptime: uptime,    // 已运行毫秒数
      restarts: 0,       // 原生模式下较难统计重启次数，设为 0 或由后端逻辑自行累计
    };

  } catch (err) {
    // 如果命令执行报错（比如 grep 没搜到东西），通常意味着服务没开
    return {
      status: "OFFLINE",
      online: false,
      error: err.message
    };
  }
}

// API: 获取系统状态
async function getStatus() {
  const status = {
    gateway: "unknown",
    gatewayPid: null,
    cpu: 0,
    memory: 0,
    version: "unknown",
    configExists: fs.existsSync(CONFIG_FILE),
    token: readText(TOKEN_FILE),
    uptime: null,
  };

  // 调用我们刚刚重写的、基于原生命令的检测函数
  const result = await checkGatewayStatus();

  status.gateway = result.status;

  // ✅ 解决了你的 TODO: 现在可以直接获取真实的 PID 了
  status.gatewayPid = result.pid || null;

  // ✅ 解决了你的 TODO: 加上当前内存占用 (MB) 和 CPU 占用 (%)
  // 内存转换成 MB 看着更直观
  status.cpu = result.cpu || 0;
  status.memory = result.memory ? (result.memory / 1024 / 1024).toFixed(1) : 0;

  status.uptime = result.uptime;

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
      // 返回默认配置结构，前端可以根据这个结构来展示界面
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
    // 重启正常没问题
    await execCommand(`pm2 restart openclaw-gateway`);
    return { success: true };
  } catch (err) {
    throw new Error("重启失败: " + err.message);
  }
}

// API: 重启 Gateway (原生模式)
async function restartGateway() {
  // 确保你已经定义了 OC_BIN_PATH 指向 /var/apps/oc-deploy/var/node_modules/.bin/openclaw
  // 并且 CONFIG_FILE 指向 /root/.openclaw/openclaw.json

  const restartCmd = `OPENCLAW_CONFIG_PATH="${CONFIG_FILE}" HOME="/root" ${NODE_BIN} ${OC_BIN_PATH} gateway restart`;

  try {
    // 1. 尝试执行原生重启命令
    // 'gateway restart' 通常会自动处理 stop 和 daemon 的逻辑
    await execCommand(restartCmd);
    return { success: true, method: "native-restart" };
  } catch (err) {
    // 2. 容错处理：如果 restart 报错（通常是因为当前没有正在运行的进程），
    // 那么我们直接调用 daemon 命令强制拉起
    console.log("Restart 失败，尝试直接使用 Daemon 模式启动...");
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
    console.log("[management-api] 检查最新版本...");
    await execCommand("npm config set registry https://registry.npmmirror.com");

    const output = await execCommand("npm view openclaw version", {
      timeout: 10000,
    });

    const latestVersion = output.trim();
    const currentVersion = (await getCurrentVersion()).version;

    console.log(
      "[management-api] 版本对比 - 当前:",
      currentVersion,
      "最新:",
      latestVersion,
    );

    return {
      version: latestVersion,
      current: currentVersion,
      available: latestVersion !== currentVersion,
    };
  } catch (err) {
    console.error("[management-api] 检查更新失败:", err);
    throw new Error(err.stderr || err.message || "无法连接到 npm registry");
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
  const host = "127.0.0.1"; // TODO： 或从请求头获取
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
  const UI_DIR = path.join(TRIM_APPDEST, "ui"); // 无法进行本地测试，因为路径不同
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
