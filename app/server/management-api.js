#!/usr/bin/env node
// ===========================================================================
// OpenClaw Management API Server
// 提供 Web 管理界面的后端 API
// ===========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, exec } = require("child_process");
const { createBackupService } = require("./services/backup");

console.log(`[Manager] PM2_HOME 已固化为: ${process.env.PM2_HOME}`);

const PORT = parseInt(process.env.MANAGEMENT_PORT || "18790", 10); // 管理 API 端口
const BIND_ADDR = process.env.BIND_ADDR || "0.0.0.0";

// 路径配置
const TRIM_PKGVAR = process.env.TRIM_PKGVAR || "/var/apps/oc-deploy/var";
const TRIM_APPDEST = process.env.TRIM_APPDEST || "/var/apps/oc-deploy/target";
const CONFIG_FILE =
  process.env.CONFIG_FILE ||
  process.env.OPENCLAW_CONFIG_PATH ||
  "/root/.openclaw/openclaw.json";
const INITIAL_CONFIG_FILE =
  process.env.INITIAL_CONFIG_FILE ||
  path.join(path.dirname(CONFIG_FILE), "openclaw.json.initial");

// oc
const OC_HOME = process.env.OC_HOME || path.dirname(CONFIG_FILE);
const OC_BIN_PATH =
  process.env.OC_BIN_PATH ||
  path.join(TRIM_PKGVAR, "node_modules", ".bin", "openclaw");
const OC_JS_PATH =
  process.env.OC_JS_PATH ||
  path.join(TRIM_PKGVAR, "node_modules", "openclaw", "dist", "index.js");
const OC_PKG_JSON_PATH = path.join(
  TRIM_PKGVAR,
  "node_modules",
  "openclaw",
  "package.json",
);
// @deprecated - Token 现在直接从 openclaw.json 读取，不再使用独立文件
const TOKEN_FILE = path.join(TRIM_PKGVAR, "gateway_token");
const DASHBOARD_PID_FILE = path.join(TRIM_PKGVAR, "app.pid"); // name's different
const GATEWAY_PID_FILE = path.join(TRIM_PKGVAR, "gateway.pid"); // name's different
const LOG_FILE = path.join(TRIM_PKGVAR, "openclaw.log"); // TODO 暂时不能确定 openclaw 的log 在哪里

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "18789", 10);

// 使用 fnOS 系统 Node.js (nodejs_v22 依赖包)
const NODE_BIN = process.env.NODE_BIN || "/var/apps/nodejs_v22/target/bin/node";
const NODE_BIN_DIR = path.dirname(NODE_BIN);
const PKG_NODE_BIN_DIR = path.join(TRIM_PKGVAR, "node_modules", ".bin");

// 插件相关
const QQBOT_PLUGIN_PKG = "@tencent-connect/openclaw-qqbot";
const WECOM_PLUGIN_PKG = "@wecom/wecom-openclaw-plugin";
const DEFAULT_ALLOWED_PLUGINS = [
  "openclaw-qqbot",
  "wecom-openclaw-plugin",
  "skillhub",
];
const BACKUP_MANIFEST_FILE = "oc-deploy-backup-manifest.json";
const USER_BACKUP_ROOT =
  process.env.USER_BACKUP_ROOT || "/root/oc-deploy/user-backups";
const MAX_BACKUP_UPLOAD_BYTES = parseInt(
  process.env.MAX_BACKUP_UPLOAD_BYTES || String(512 * 1024 * 1024),
  10,
);
let qqbotPluginInstalling = false;
let wecomPluginInstalling = false;

// env 变量设置，确保调用 openclaw 的命令行工具时能够正确找到 Node.js 和相关依赖
process.env.CONFIG_FILE = process.env.CONFIG_FILE || CONFIG_FILE;
process.env.OPENCLAW_CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH || CONFIG_FILE;
process.env.NODE_BIN = process.env.NODE_BIN || NODE_BIN;
process.env.OC_BIN_PATH = process.env.OC_BIN_PATH || OC_BIN_PATH;
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

// 工具函数：生成注入脚本（自动配置 gatewayUrl 和 token）
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

  // 每秒检查一次，确保配置不被覆盖
  setInterval(forceSetConfig, 1000);

  // 监听 localStorage 变化（其他标签页或代码修改时）
  window.addEventListener('storage', function(e) {
    if (e.key === SETTINGS_KEY) {
      forceSetConfig();
    }
  });

  // 监听 DOM 变化（SPA 路由跳转时）
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function() {
      forceSetConfig();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
</script>`;
}

// 工具函数：修改响应头（移除 iframe 限制）
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

// 工具函数：检查是否为 HTML 响应
function isHtmlResponse(headers) {
  const ct = headers["content-type"] || "";
  return ct.includes("text/html");
}

function getQqbotPluginProofFilePath() {
  const baseDirs = [
    path.join(
      TRIM_PKGVAR,
      "node_modules",
      "@tencent-connect",
      "openclaw-qqbot",
    ),
    path.join(OC_HOME, "plugins", "@tencent-connect", "openclaw-qqbot"),
    path.join(TRIM_PKGVAR, "plugins", "@tencent-connect", "openclaw-qqbot"),
    path.join(OC_HOME, "extensions", "openclaw-qqbot"),
  ];
  const proofFiles = ["package.json", "openclaw.plugin.json", "plugin.json"];

  for (const baseDir of baseDirs) {
    for (const proofFile of proofFiles) {
      const candidate = path.join(baseDir, proofFile);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function getQqbotPluginUnverifiedInfo() {
  const extensionDir = path.join(OC_HOME, "extensions", "openclaw-qqbot");
  if (!fs.existsSync(extensionDir)) {
    return { exists: false, path: extensionDir };
  }

  const indexCandidates = [
    path.join(extensionDir, "index.js"),
    path.join(extensionDir, "index.ts"),
    path.join(extensionDir, "dist", "index.js"),
  ];

  const hasIndex = indexCandidates.some((candidate) =>
    fs.existsSync(candidate),
  );

  return { exists: true, path: extensionDir, hasIndex };
}

async function getQqbotPluginStatus() {
  const proofFilePath = getQqbotPluginProofFilePath();
  if (!proofFilePath) {
    const unverified = getQqbotPluginUnverifiedInfo();
    if (unverified.exists) {
      return {
        success: true,
        installed: false,
        verified: false,
        state: "unverified",
        version: "",
        package: QQBOT_PLUGIN_PKG,
        message: `检测到插件目录但缺少插件元数据，无法确认安装状态。若为手动插件，请在 openclaw.json 的 plugins.allow 中加入 openclaw-qqbot；否则请清理 ${unverified.path} 后重试`,
      };
    }

    return {
      success: true,
      installed: false,
      verified: false,
      state: "missing",
      version: "",
      package: QQBOT_PLUGIN_PKG,
    };
  }

  const pkg = readJSON(proofFilePath);
  return {
    success: true,
    installed: true,
    verified: true,
    state: "installed",
    version: pkg?.version || "unknown",
    package: QQBOT_PLUGIN_PKG,
  };
}

async function installQqbotPlugin() {
  if (qqbotPluginInstalling) {
    throw new Error("QQ 插件安装中，请稍后重试");
  }

  const preStatus = await getQqbotPluginStatus();
  if (preStatus.state === "installed") {
    return {
      success: true,
      message: "QQ 插件已安装",
      version: preStatus.version,
      package: preStatus.package,
    };
  }
  if (preStatus.state === "unverified") {
    throw new Error(preStatus.message || "QQ 插件目录异常，请清理后重试");
  }

  qqbotPluginInstalling = true;
  const installCmd = `${OC_BIN_PATH} plugins install ${QQBOT_PLUGIN_PKG}@latest`;

  try {
    await execCommand(installCmd, {
      timeout: 600000,
      env: {
        HOME: "/root",
        OPENCLAW_CONFIG_PATH: CONFIG_FILE,
        NODE_BIN,
        OC_BIN_PATH,
        PATH: `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`,
      },
    });

    const status = await getQqbotPluginStatus();
    if (!status.installed) {
      throw new Error("插件安装完成但未检测到安装结果");
    }

    return {
      success: true,
      message: "QQ 插件安装成功",
      version: status.version,
      package: status.package,
    };
  } catch (err) {
    const rawError = err?.stderr || err?.message || "QQ 插件安装失败";
    const isAllowError = rawError.includes("plugins.allow is empty");
    const status = await getQqbotPluginStatus();
    if (status.installed && !isAllowError) {
      return {
        success: true,
        message: "QQ 插件已安装",
        version: status.version,
        package: status.package,
      };
    }

    let errorMessage = rawError;
    if (isAllowError) {
      errorMessage =
        "QQ 插件安装被拒绝：请在 openclaw.json 的 plugins.allow 中加入 openclaw-qqbot";
    } else if (
      errorMessage.includes("plugin already exists") ||
      errorMessage.includes("already exists")
    ) {
      if (status.state === "unverified") {
        errorMessage = status.message || errorMessage;
      }
    }
    console.error("[qqbot-plugin] install failed:", errorMessage);
    throw new Error(errorMessage);
  } finally {
    qqbotPluginInstalling = false;
  }
}

function getWecomPluginProofFilePath() {
  const baseDirs = [
    path.join(TRIM_PKGVAR, "node_modules", "@wecom", "wecom-openclaw-plugin"),
    path.join(OC_HOME, "plugins", "@wecom", "wecom-openclaw-plugin"),
    path.join(TRIM_PKGVAR, "plugins", "@wecom", "wecom-openclaw-plugin"),
    path.join(OC_HOME, "extensions", "wecom-openclaw-plugin"),
  ];
  const proofFiles = ["package.json", "openclaw.plugin.json", "plugin.json"];

  for (const baseDir of baseDirs) {
    for (const proofFile of proofFiles) {
      const candidate = path.join(baseDir, proofFile);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function getWecomPluginUnverifiedInfo() {
  const extensionDir = path.join(
    OC_HOME,
    "extensions",
    "wecom-openclaw-plugin",
  );
  if (!fs.existsSync(extensionDir)) {
    return { exists: false, path: extensionDir };
  }

  const indexCandidates = [
    path.join(extensionDir, "index.js"),
    path.join(extensionDir, "index.ts"),
    path.join(extensionDir, "dist", "index.js"),
  ];

  const hasIndex = indexCandidates.some((candidate) =>
    fs.existsSync(candidate),
  );

  return { exists: true, path: extensionDir, hasIndex };
}

async function getWecomPluginStatus() {
  const proofFilePath = getWecomPluginProofFilePath();
  if (!proofFilePath) {
    const unverified = getWecomPluginUnverifiedInfo();
    if (unverified.exists) {
      return {
        success: true,
        installed: false,
        verified: false,
        state: "unverified",
        version: "",
        package: WECOM_PLUGIN_PKG,
        message: `检测到插件目录但缺少插件元数据，无法确认安装状态。若为手动插件，请在 openclaw.json 的 plugins.allow 中加入 wecom-openclaw-plugin；否则请清理 ${unverified.path} 后重试`,
      };
    }

    return {
      success: true,
      installed: false,
      verified: false,
      state: "missing",
      version: "",
      package: WECOM_PLUGIN_PKG,
    };
  }

  const pkg = readJSON(proofFilePath);
  return {
    success: true,
    installed: true,
    verified: true,
    state: "installed",
    version: pkg?.version || "unknown",
    package: WECOM_PLUGIN_PKG,
  };
}

async function installWecomPlugin() {
  if (wecomPluginInstalling) {
    throw new Error("企业微信插件安装中，请稍后重试");
  }

  const preStatus = await getWecomPluginStatus();
  if (preStatus.state === "installed") {
    return {
      success: true,
      message: "企业微信插件已安装",
      version: preStatus.version,
      package: preStatus.package,
    };
  }
  if (preStatus.state === "unverified") {
    throw new Error(preStatus.message || "企业微信插件目录异常，请清理后重试");
  }

  wecomPluginInstalling = true;
  const installCmd = `${OC_BIN_PATH} plugins install ${WECOM_PLUGIN_PKG}`;

  try {
    await execCommand(installCmd, {
      timeout: 600000,
      env: {
        HOME: "/root",
        OPENCLAW_CONFIG_PATH: CONFIG_FILE,
        NODE_BIN,
        OC_BIN_PATH,
        PATH: `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`,
      },
    });

    const status = await getWecomPluginStatus();
    if (!status.installed) {
      throw new Error("插件安装完成但未检测到安装结果");
    }

    return {
      success: true,
      message: "企业微信插件安装成功",
      version: status.version,
      package: status.package,
    };
  } catch (err) {
    const rawError = err?.stderr || err?.message || "企业微信插件安装失败";
    const isAllowError = rawError.includes("plugins.allow is empty");
    const status = await getWecomPluginStatus();
    if (status.installed && !isAllowError) {
      return {
        success: true,
        message: "企业微信插件已安装",
        version: status.version,
        package: status.package,
      };
    }

    let errorMessage = rawError;
    if (isAllowError) {
      errorMessage =
        "企业微信插件安装被拒绝：请在 openclaw.json 的 plugins.allow 中加入 wecom-openclaw-plugin";
    } else if (
      errorMessage.includes("plugin already exists") ||
      errorMessage.includes("already exists")
    ) {
      if (status.state === "unverified") {
        errorMessage = status.message || errorMessage;
      }
    }
    console.error("[wecom-plugin] install failed:", errorMessage);
    throw new Error(errorMessage);
  } finally {
    wecomPluginInstalling = false;
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

// API: 获取系统状态 (包含进程探测与状态打包)
async function getStatus() {
  // 1. 初始化基础状态对象 (保持原有输出结构完全一致)
  const status = {
    gateway: "unknown",
    gatewayPid: null,
    proxy: "running",
    proxyPid: process.pid,
    system: {
      cpuUsage: 0,
      memoryMB: 0,
      memoryPercent: 0,
      totalMemoryMB: 0,
    },
    version: "unknown",
    configExists: fs.existsSync(CONFIG_FILE),
    token: getTokenFromConfig(),
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
      status.system.cpuUsage = parseFloat(stats[0]) || 0;

      // 计算并写入内存数据 (stats[1] 是 RSS，单位 KB，转换为 MB)
      const memoryKB = parseInt(stats[1]) || 0;
      status.system.memoryMB = memoryKB / 1024;

      // 获取系统总内存 (从 /proc/meminfo 读取 MemTotal)
      try {
        const meminfoOut = await execCommand(
          `grep MemTotal /proc/meminfo | awk '{print $2}'`,
        );
        const totalMemoryKB = parseInt(meminfoOut.trim()) || 0;
        status.system.totalMemoryMB = totalMemoryKB / 1024;

        // 计算内存使用百分比
        if (status.system.totalMemoryMB > 0) {
          status.system.memoryPercent =
            (status.system.memoryMB / status.system.totalMemoryMB) * 100;
        }
      } catch (err) {
        // 如果获取总内存失败，保持默认值 0
      }

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
          token: getTokenFromConfig(),
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

function buildFallbackResetConfig(existingConfig = {}) {
  const packageJson = readJSON(OC_PKG_JSON_PATH);
  const lastTouchedVersion = packageJson?.version || "unknown";
  const preservedToken =
    existingConfig?.gateway?.auth?.token ||
    getTokenFromConfig() ||
    crypto.randomBytes(24).toString("hex");
  const existingAllow = Array.isArray(existingConfig?.plugins?.allow)
    ? existingConfig.plugins.allow
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0)
    : [];
  const mergedAllow = Array.from(
    new Set([...DEFAULT_ALLOWED_PLUGINS, ...existingAllow]),
  );

  return {
    meta: {
      lastTouchedVersion,
      lastTouchedAt: new Date().toISOString(),
    },
    agents: {
      defaults: {
        workspace: "/root/.openclaw/workspace",
        compaction: {
          mode: "safeguard",
        },
      },
    },
    commands: {
      native: "auto",
      nativeSkills: "auto",
      restart: true,
      ownerDisplay: "raw",
    },
    plugins: {
      enabled: true,
      allow: mergedAllow,
    },
    gateway: {
      port: GATEWAY_PORT,
      mode: "local",
      bind: "lan",
      controlUi: {
        allowedOrigins: ["*"],
        dangerouslyAllowHostHeaderOriginFallback: true,
        allowInsecureAuth: true,
        dangerouslyDisableDeviceAuth: true,
      },
      auth: {
        mode: "token",
        token: preservedToken,
      },
      trustedProxies: ["10.0.0.1", "127.0.0.1", "::1"],
      reload: {
        mode: "hybrid",
        debounceMs: 300,
      },
    },
  };
}

async function resetConfig() {
  const timestamp = Date.now();
  const backupFile = `${CONFIG_FILE}.backup.reset.${timestamp}`;
  const hasExistingConfig = fs.existsSync(CONFIG_FILE);
  const existingConfig = readJSON(CONFIG_FILE) || {};

  // 恢复前，先备份当前配置
  if (hasExistingConfig) {
    fs.copyFileSync(CONFIG_FILE, backupFile);
  }

  let source = "initial-snapshot";
  let configToRestore = null;

  if (fs.existsSync(INITIAL_CONFIG_FILE)) {
    configToRestore = readJSON(INITIAL_CONFIG_FILE);
    if (!configToRestore || typeof configToRestore !== "object") {
      throw new Error("初始配置快照损坏，无法恢复");
    }
  } else {
    source = "fallback-default";
    configToRestore = buildFallbackResetConfig(existingConfig);
  }

  const success = writeJSON(CONFIG_FILE, configToRestore);
  if (!success) {
    throw new Error("恢复配置失败：写入配置文件失败");
  }

  let restarted = false;
  let restartError = "";

  try {
    const restartResult = await restartGateway();
    restarted = !!restartResult?.success;
  } catch (err) {
    restartError =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "未知错误";
  }

  return {
    success: true,
    source,
    backupFile: hasExistingConfig ? backupFile : null,
    restarted,
    restartError: restartError || undefined,
  };
}

// API: 快速添加模型
async function addModel(modelData) {
  // 先固定操作模式，避免 catch 阶段再次读取不稳定变量
  const isEditOperation =
    modelData?.isEditMode === true || modelData?.isEditMode === "true";

  try {
    // 读取现有配置
    const config = readJSON(CONFIG_FILE);
    if (!config) {
      throw new Error("配置文件不存在");
    }

    // 确保基础结构存在
    config.models = config.models || {};
    config.models.mode = config.models.mode || "merge";
    config.models.providers = config.models.providers || {};
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.models = config.agents.defaults.models || {};

    const {
      providerName,
      modelId,
      baseUrl,
      apiKey,
      apiProtocol,
      apiType,
      advanced,
      isEditMode,
      editModelKey,
    } = modelData;

    // 验证必需字段
    if (!modelId) {
      throw new Error("模型 ID 不能为空");
    }
    if (!providerName) {
      throw new Error("供应商名称不能为空");
    }

    // 验证标识格式：只允许字母、数字、连字符和点号
    const identifierPattern = /^[a-zA-Z0-9./:-]+$/;
    if (!identifierPattern.test(modelId)) {
      throw new Error(
        "模型 ID 只能包含字母、数字、连字符(-)、点号(.)、斜杠(/)和冒号(:)，不能包含空格或其他特殊字符",
      );
    }

    // 验证 providerName 格式：仅允许小写英文字符（a-z）
    const providerPattern = /^[a-z]+$/;
    if (!providerPattern.test(providerName)) {
      throw new Error(
        "供应商名称只能包含小写英文字符（a-z），不能包含大写字母、数字、中文、空格或特殊字符",
      );
    }

    // 如果是编辑模式，需要先删除旧模型
    if (isEditMode && editModelKey) {
      const [oldProvider, ...oldModelIdParts] = editModelKey.split("/");
      const oldModelId = oldModelIdParts.join("/"); // 处理模型 ID 中可能包含 / 的情况
      if (config.models.providers[oldProvider]) {
        const oldModelIndex = config.models.providers[
          oldProvider
        ].models?.findIndex((m) => {
          const mId = m.id || "";
          const mName = m.name || "";
          const mModel = m.model || "";
          return (
            mId === oldModelId || mName === oldModelId || mModel === oldModelId
          );
        });
        if (oldModelIndex >= 0) {
          config.models.providers[oldProvider].models.splice(oldModelIndex, 1);
        }
        // 从 agents.defaults.models 中删除
        if (config.agents.defaults.models[editModelKey]) {
          delete config.agents.defaults.models[editModelKey];
        }
        const oldModels = config.models.providers[oldProvider].models;
        if (!Array.isArray(oldModels) || oldModels.length === 0) {
          delete config.models.providers[oldProvider];
        }
      }
    }

    // 创建或更新供应商配置
    if (!config.models.providers[providerName]) {
      config.models.providers[providerName] = {
        baseUrl: baseUrl,
        apiKey: apiKey,
        api: apiType || apiProtocol, // 优先使用 apiType，回退到 apiProtocol
        models: [],
      };
    } else {
      // 更新现有供应商的配置
      if (baseUrl) config.models.providers[providerName].baseUrl = baseUrl;
      if (apiKey) config.models.providers[providerName].apiKey = apiKey;
      if (apiType || apiProtocol) {
        config.models.providers[providerName].api = apiType || apiProtocol;
      }
      // 确保 models 数组存在
      if (!config.models.providers[providerName].models) {
        config.models.providers[providerName].models = [];
      }
    }

    // 检查模型是否已存在
    const existingModelIndex = config.models.providers[
      providerName
    ].models.findIndex((m) => {
      const mId = m.id || "";
      const mName = m.name || "";
      const mModel = m.model || "";
      return mId === modelId || mName === modelId || mModel === modelId;
    });

    // 构建模型配置
    const modelConfig = {
      id: modelId,
      name: modelId,
      reasoning: advanced?.reasoning || false,
      input: advanced?.input || ["text"],
      cost: advanced?.cost || {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: advanced?.contextWindow || 200000,
      maxTokens: advanced?.maxTokens || 8192,
    };

    // 添加或更新模型
    if (existingModelIndex >= 0) {
      config.models.providers[providerName].models[existingModelIndex] =
        modelConfig;
    } else {
      config.models.providers[providerName].models.push(modelConfig);
    }

    // 添加到 agents.defaults.models
    const agentModelKey = `${providerName}/${modelId}`;
    config.agents.defaults.models[agentModelKey] = {};

    // 处理 primary：新增不抢占，编辑保持或更新
    const existingPrimary = config.agents.defaults.model?.primary || "";
    config.agents.defaults.model = config.agents.defaults.model || {};

    if (!existingPrimary) {
      // 没有 primary 时，首次设置为当前模型
      config.agents.defaults.model.primary = agentModelKey;
    } else if (isEditMode && editModelKey && existingPrimary === editModelKey) {
      // 编辑了 primary 所在模型，更新为新 key（例如更换 provider）
      config.agents.defaults.model.primary = agentModelKey;
    } else {
      // 其他情况保持不变
      config.agents.defaults.model.primary = existingPrimary;
    }

    // 保存配置
    const success = writeJSON(CONFIG_FILE, config);
    if (!success) {
      throw new Error("保存配置失败");
    }

    return {
      success: true,
      message: isEditMode ? "模型修改成功" : "模型添加成功",
      modelKey: agentModelKey,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);

    // 保留上下文，便于排查用户反馈的“偶发奇怪报错”
    console.error("[addModel] failed", {
      isEditOperation,
      rawError: err,
      errorMessage,
    });

    throw new Error(
      `${isEditOperation ? "修改模型失败" : "添加模型失败"}: ${errorMessage || "未知错误"}`,
    );
  }
}

// API: 删除模型
async function deleteModel(modelKey) {
  try {
    console.log(`[deleteModel] 接收到的 modelKey: "${modelKey}"`);

    // 读取配置
    const config = readJSON(CONFIG_FILE);
    if (!config || !config.models) {
      throw new Error("配置文件不存在或格式错误");
    }

    // 解析 modelKey (格式: providerName/modelId)
    const [providerName, ...modelIdParts] = modelKey.split("/");
    const modelId = modelIdParts.join("/"); // 处理模型 ID 中可能包含 / 的情况

    console.log(
      `[deleteModel] 解析后 - providerName: "${providerName}", modelId: "${modelId}"`,
    );

    if (!providerName || !modelId) {
      throw new Error(
        `模型标识格式错误，应为 providerName/modelId。收到: "${modelKey}"`,
      );
    }

    // 检查供应商是否存在
    if (!config.models.providers || !config.models.providers[providerName]) {
      const availableProviders = Object.keys(
        config.models.providers || {},
      ).join(", ");
      throw new Error(
        `供应商 "${providerName}" 不存在。可用供应商: ${availableProviders || "无"}`,
      );
    }

    const provider = config.models.providers[providerName];
    if (!provider.models || !Array.isArray(provider.models)) {
      throw new Error(`供应商 "${providerName}" 没有模型列表`);
    }

    console.log(
      `[deleteModel] 供应商 "${providerName}" 下的模型:`,
      JSON.stringify(
        provider.models.map((m) => ({ id: m.id, name: m.name })),
        null,
        2,
      ),
    );

    // 查找模型索引 - 同时检查 id 和 name 字段，并处理 undefined/null 情况
    const modelIndex = provider.models.findIndex((m) => {
      const mId = m.id || "";
      const mName = m.name || "";
      const mModel = m.model || "";
      return mId === modelId || mName === modelId || mModel === modelId;
    });

    console.log(`[deleteModel] 查找结果 - modelIndex: ${modelIndex}`);

    if (modelIndex === -1) {
      // 提供更详细的错误信息
      const modelDetails = provider.models
        .map((m, idx) => {
          return `[${idx}] id="${m.id || "undefined"}" name="${m.name || "undefined"}"`;
        })
        .join(", ");
      throw new Error(
        `模型 "${modelId}" 在供应商 "${providerName}" 中不存在。该供应商下的所有模型: ${modelDetails || "无模型"}`,
      );
    }

    // 备份配置
    const backupFile = `${CONFIG_FILE}.backup.${Date.now()}`;
    writeJSON(backupFile, config);

    // 删除模型
    provider.models.splice(modelIndex, 1);

    // 如果供应商下没有模型了，删除整个供应商
    if (provider.models.length === 0) {
      delete config.models.providers[providerName];
    }

    // 从 agents.defaults.models 中删除（如果存在）
    if (config.agents?.defaults?.models?.[modelKey]) {
      delete config.agents.defaults.models[modelKey];
    }

    // 如果删除的是 primary 模型，自动回退到第一个可用模型（或清空 primary）
    if (config.agents?.defaults?.model?.primary === modelKey) {
      let fallbackPrimary = null;
      const providers = config.models?.providers || {};

      for (const [pName, pConfig] of Object.entries(providers)) {
        const models = pConfig?.models;
        if (!Array.isArray(models) || models.length === 0) {
          continue;
        }

        const firstModel = models[0];
        const firstModelId = firstModel?.id || firstModel?.name;
        if (firstModelId) {
          fallbackPrimary = `${pName}/${firstModelId}`;
          break;
        }
      }

      if (fallbackPrimary) {
        config.agents.defaults.model.primary = fallbackPrimary;
      } else {
        delete config.agents.defaults.model.primary;
      }
    }

    // 保存配置
    const success = writeJSON(CONFIG_FILE, config);
    if (!success) {
      throw new Error("保存配置失败");
    }

    return { success: true, message: `模型 "${modelKey}" 已删除` };
  } catch (err) {
    throw new Error("删除模型失败: " + err.message);
  }
}

// API: 验证配置
async function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      valid: false,
      errors: ["配置根节点必须是 JSON 对象"],
    };
  }

  // 验证 models（兼容新旧两种结构）
  if (config.models !== undefined) {
    if (
      !config.models ||
      typeof config.models !== "object" ||
      Array.isArray(config.models)
    ) {
      errors.push("models 必须是对象");
    } else if (config.models.providers !== undefined) {
      // 新结构：models.providers.<provider>.models[]
      const providers = config.models.providers;
      if (
        !providers ||
        typeof providers !== "object" ||
        Array.isArray(providers)
      ) {
        errors.push("models.providers 必须是对象");
      } else {
        for (const [providerName, provider] of Object.entries(providers)) {
          if (
            !provider ||
            typeof provider !== "object" ||
            Array.isArray(provider)
          ) {
            errors.push(`供应商 ${providerName} 配置格式错误`);
            continue;
          }

          if (
            provider.models !== undefined &&
            !Array.isArray(provider.models)
          ) {
            errors.push(`供应商 ${providerName} 的 models 必须是数组`);
            continue;
          }

          if (Array.isArray(provider.models)) {
            provider.models.forEach((model, idx) => {
              if (!model || typeof model !== "object" || Array.isArray(model)) {
                errors.push(
                  `供应商 ${providerName} 的第 ${idx + 1} 个模型格式错误`,
                );
                return;
              }
              if (!model.id && !model.name) {
                errors.push(
                  `供应商 ${providerName} 的第 ${idx + 1} 个模型缺少 id/name`,
                );
              }
            });
          }
        }
      }
    } else {
      // 旧结构：models.<modelName>.provider/apiKey
      for (const [name, model] of Object.entries(config.models)) {
        if (name === "mode" || name === "providers") {
          continue;
        }
        if (!model || typeof model !== "object" || Array.isArray(model)) {
          continue;
        }
        if (!model.provider) {
          errors.push(`模型 ${name} 缺少 provider 字段`);
        }
        if (!model.apiKey) {
          errors.push(`模型 ${name} 缺少 apiKey 字段`);
        }
      }
    }
  }

  // 验证 channels
  if (config.channels !== undefined) {
    if (
      !config.channels ||
      typeof config.channels !== "object" ||
      Array.isArray(config.channels)
    ) {
      errors.push("channels 必须是对象");
    } else {
      for (const [name, channel] of Object.entries(config.channels)) {
        if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
          errors.push(`渠道 ${name} 配置格式错误`);
          continue;
        }
        if (!channel.type) {
          const hasTelegramShape = !!(channel.botToken || channel.groups);
          const hasFeishuShape = !!(channel.accounts && channel.accounts.main);
          const hasDiscordShape = !!channel.token;
          const hasQqbotShape =
            Object.prototype.hasOwnProperty.call(channel, "appId") ||
            Object.prototype.hasOwnProperty.call(channel, "clientSecret");
          const hasWecomShape =
            Object.prototype.hasOwnProperty.call(channel, "botId") ||
            Object.prototype.hasOwnProperty.call(channel, "secret");

          if (
            !hasTelegramShape &&
            !hasFeishuShape &&
            !hasDiscordShape &&
            !hasQqbotShape &&
            !hasWecomShape
          ) {
            errors.push(`渠道 ${name} 缺少 type 字段`);
          }
        }
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

// API: 获取控制台 URL (走管理端代理，自动携带 token)
async function getConsoleUrl(req) {
  const token = getTokenFromConfig();

  // 优先使用当前访问的 host/协议，确保走管理端代理 (/dashboard)
  const host = req.headers.host || "127.0.0.1:18790";
  const proto =
    req.headers["x-forwarded-proto"] ||
    (req.socket && req.socket.encrypted ? "https" : "http");

  let url = `${proto}://${host}/dashboard/`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }

  return { url, token };
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

  // Dashboard 代理处理 - 直接转发到 Gateway (18789)
  if (pathname.startsWith("/dashboard")) {
    const proxyPath = pathname.replace(/^\/dashboard/, "") || "/";

    // 读取 token
    let gatewayToken = "";
    try {
      const config = readJSON(CONFIG_FILE);
      gatewayToken = config?.gateway?.auth?.token || "";
    } catch (e) {}

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

        // 如果是 HTML 响应，注入脚本
        if (isHtmlResponse(proxyRes.headers)) {
          const chunks = [];
          proxyRes.on("data", (chunk) => chunks.push(chunk));
          proxyRes.on("end", () => {
            let body = Buffer.concat(chunks).toString("utf8");

            // 注入脚本：自动配置 gatewayUrl 和 token
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
          // 非 HTML 响应，直接转发
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
    return;
  }

  // API 路由处理
  if (pathname.startsWith("/api/")) {
    if (method === "GET" && pathname === "/api/backup/export") {
      createBackupArchive("manual-export")
        .then((backup) => {
          let cleaned = false;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            cleanupPathQuietly(backup.workDir);
          };

          const stat = fs.statSync(backup.archivePath);
          res.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Length": String(stat.size),
            "Content-Disposition": `attachment; filename="${backup.fileName}"`,
            "Cache-Control": "no-store",
          });

          const stream = fs.createReadStream(backup.archivePath);
          stream.on("error", (err) => {
            cleanup();
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ error: "导出备份失败: " + err.message }),
              );
            } else {
              res.destroy(err);
            }
          });
          stream.on("close", cleanup);
          res.on("close", cleanup);
          stream.pipe(res);
        })
        .catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "导出完整备份失败: " + (err?.message || "未知错误"),
            }),
          );
        });
      return;
    }

    if (method === "POST" && pathname === "/api/backup/import") {
      importBackupArchiveFromRequest(req)
        .then((result) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "导入完整备份失败: " + (err?.message || "未知错误"),
            }),
          );
        });
      return;
    }

    const routes = {
      "GET /api/status": getStatus,
      "GET /api/config": getConfig,
      "POST /api/config": async () => {
        const body = await readBody(req);
        return saveConfig(JSON.parse(body));
      },
      "POST /api/config/reset": resetConfig,
      "POST /api/config/validate": async () => {
        const body = await readBody(req);
        return validateConfig(JSON.parse(body));
      },
      "POST /api/models/add": async () => {
        const body = await readBody(req);
        return addModel(JSON.parse(body));
      },
      "POST /api/models/delete": async () => {
        const body = await readBody(req);
        const data = JSON.parse(body);
        return deleteModel(data.modelKey);
      },
      "POST /api/gateway/start": startGateway,
      "POST /api/gateway/stop": stopGateway,
      "POST /api/gateway/restart": restartGateway,
      "GET /api/version/current": getCurrentVersion,
      "GET /api/version/latest": getLatestVersion,
      "POST /api/version/update": updateVersion,
      "GET /api/plugins/qqbot/status": getQqbotPluginStatus,
      "POST /api/plugins/qqbot/install": installQqbotPlugin,
      "GET /api/plugins/wecom/status": getWecomPluginStatus,
      "POST /api/plugins/wecom/install": installWecomPlugin,
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

// WebSocket 升级处理 - 转发到 Gateway
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 只处理 /dashboard 路径下的 WebSocket 连接
  if (!pathname.startsWith("/dashboard")) {
    socket.destroy();
    return;
  }

  // 读取 token 并注入到 URL
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

  // 构建代理请求头（伪装为 localhost）
  const proxyHeaders = Object.assign({}, req.headers);
  proxyHeaders.host = `127.0.0.1:${GATEWAY_PORT}`;
  proxyHeaders.origin = `http://127.0.0.1:${GATEWAY_PORT}`;
  proxyHeaders.referer = `http://127.0.0.1:${GATEWAY_PORT}/`;

  console.log(
    `[WebSocket] Upgrading: ${pathname} -> Gateway:${GATEWAY_PORT}${proxyPath}`,
  );

  // 向 Gateway 发起 WebSocket 升级请求
  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port: GATEWAY_PORT,
    path: proxyPath,
    method: "GET",
    headers: proxyHeaders,
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    // 转发升级响应给客户端
    let response = "HTTP/1.1 101 Switching Protocols\r\n";
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      response += `${key}: ${value}\r\n`;
    }
    response += "\r\n";

    socket.write(response);
    if (proxyHead && proxyHead.length) {
      socket.write(proxyHead);
    }

    // 双向管道连接
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    // 错误处理
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
