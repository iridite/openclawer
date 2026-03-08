#!/usr/bin/env node
// ===========================================================================
// OpenClaw Management API Server
// 提供 Web 管理界面的后端 API
// ===========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");

console.log(`[Manager] PM2_HOME 已固化为: ${process.env.PM2_HOME}`);

const PORT = parseInt(process.env.MANAGEMENT_PORT || "18790", 10); // 管理 API 端口
const BIND_ADDR = process.env.BIND_ADDR || "0.0.0.0";

// 路径配置
const TRIM_PKGVAR = "/var/apps/oc-deploy/var";
const TRIM_APPDEST = "/var/apps/oc-deploy/target";
const CONFIG_FILE = "/root/.openclaw/openclaw.json"; // hard-coded

// oc
const OC_HOME = "/root/.openclaw";
const OC_BIN_PATH = "/var/apps/oc-deploy/var/node_modules/.bin/openclaw";
const OC_JS_PATH =
  "/var/apps/oc-deploy/var/node_modules/openclaw/dist/index.js";
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

// env 变量设置，确保调用 openclaw 的命令行工具时能够正确找到 Node.js 和相关依赖
process.env.CONFIG_FILE = "/root/.openclaw/openclaw.json"; // hard-coded
process.env.NODE_BIN = "/var/apps/nodejs_v22/target/bin/node";
process.env.OC_BIN_PATH = "/var/apps/oc-deploy/var/node_modules/.bin/openclaw";
process.env.PATH = `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`;
// 不确定有没有用

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

// API: 启动 Gateway
async function startGateway() {
  // 核心：启动前先尝试杀掉所有可能存在的旧进程，防止多开
  try {
    await execCommand('pkill -9 -f "openclaw.*gateway"');
  } catch (e) {}
  // 组装纯净的 nohup 后台启动命令
  const startCmd = `nohup env HOME="/root" OPENCLAW_CONFIG_PATH="${CONFIG_FILE}" ${NODE_BIN} ${OC_JS_PATH} gateway --port ${GATEWAY_PORT} > ${LOG_FILE} 2>&1 &`;

  try {
    await execCommand(startCmd);
    return { success: true, method: "nohup-start" };
  } catch (err) {
    throw new Error("启动失败: " + (err.stderr || err.message));
  }
}

// API: 停止 Gateway
async function stopGateway() {
  // 匹配所有 openclaw gateway 相关的进程并强杀
  const stopCmd = `pkill -9 -f "openclaw.*gateway"`;
  try {
    await execCommand(stopCmd);
    return { success: true, method: "pkill-stop" };
  } catch (err) {
    // pkill 返回 1 说明没找到进程，结果等同于已经停止
    return { success: true, note: "Process was already stopped" };
  }
}

// API: 重启 Gateway
async function restartGateway() {
  try {
    // 1. 先尝试停止
    await stopGateway();

    // 2. 等待一小会儿，确保端口被操作系统释放 (非常重要！)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 3. 再次启动
    await startGateway();

    return { success: true, method: "nohup-restart" };
  } catch (err) {
    throw new Error("重启流程失败: " + err.message);
  }
}

// API: 获取系统状态 (包含进程探测与状态打包)
async function getStatus() {
  // 1. 初始化基础状态对象 (保持原有输出结构完全一致)
  const status = {
    gateway: "unknown",
    gatewayPid: null,
    cpu: 0,
    memory: 0,
    version: "unknown",
    configExists: fs.existsSync(CONFIG_FILE),
    token: readText(TOKEN_FILE), // TODO: token 需要等 gateway 成功启动之后才能够自动生成并获取
    uptime: null,
  };

  // 2. 获取 OpenClaw 版本信息
  try {
    const packageJson = readJSON(OC_PKG_JSON_PATH);
    if (packageJson && packageJson.version) {
      status.version = packageJson.version;
    }
  } catch (err) {
    // 忽略文件读取错误，保留 "unknown"
  }

  // 3. 检测进程状态并填充系统资源信息
  try {
    // 通过进程特征查找 PID (与 pkill 的逻辑保持完全一致)
    // pgrep -f 会匹配整个命令行，head -n 1 确保即使有多个相关进程也只取主进程
    const pgrepOut = await execCommand(
      `pgrep -f "openclaw.*gateway" | head -n 1`,
    );

    const pid = pgrepOut.trim();

    // 判断进程是否存在
    if (!pid || isNaN(pid)) {
      status.gateway = "offline";
    } else {
      // 确认运行中，更新核心状态
      status.gateway = "running";
      status.gatewayPid = parseInt(pid);

      // 获取进程详情 (CPU, 内存, 启动时间)
      // %cpu: CPU 占用率 | rss: 物理内存占用 (KB) | lstart: 启动时间
      const psOut = await execCommand(
        `ps -p ${pid} -o %cpu,rss,lstart --no-headers`,
      );

      const stats = psOut.trim().split(/\s+/);

      // 写入 CPU 数据
      status.cpu = parseFloat(stats[0]) || 0;

      // 计算并写入内存数据 (直接转换为 MB 并保留一位小数，保持输出格式不变)
      const memoryBytes = parseInt(stats[1]) * 1024;
      status.memory = memoryBytes ? (memoryBytes / 1024 / 1024).toFixed(1) : 0;

      // 解析启动时间并计算 uptime (毫秒)
      const startTimeStr = stats.slice(2).join(" ");
      const startTimeMs = new Date(startTimeStr).getTime();
      status.uptime = Date.now() - startTimeMs;
    }
  } catch (err) {
    // 发生错误（例如 pgrep 没搜到进程抛出 exit code 1）
    // 直接判定为离线状态，其余数据保留默认的 0/null
    status.gateway = "offline";
  }

  // 4. 返回组装好的状态对象给前端
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

// API: 获取控制台 URL (动态识别 NAS IP)
async function getConsoleUrl(req) {
  const token = readText(TOKEN_FILE);

  // 核心逻辑：从请求头中提取用户当前访问的 NAS IP
  // 假设用户浏览器访问的是 http://192.168.1.100:18790
  // 那么 req.headers.host 就是 "192.168.1.100:18790"
  // .split(':')[0] 切割后拿到的就是纯 IP "192.168.1.100"
  const host = req.headers.host ? req.headers.host.split(":")[0] : "127.0.0.1";

  return {
    url: `http://${host}:${GATEWAY_PORT}`, // 自动拼接为 http://192.168.1.100:18789
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
      "GET /api/console/url": () => getConsoleUrl(req),
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
