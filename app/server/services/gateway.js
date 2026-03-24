const fs = require("fs");
const path = require("path");
const { migrateLegacyManagedFileProvider } = require("../core/secrets");
const {
  badGatewayError,
  conflictError,
  isAppError,
} = require("../core/http-errors");

function createGatewayService(options) {
  const {
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
  } = options;

  let statusCache = null;
  let statusCacheTime = 0;

  function migrateConfigBeforeGatewayStart() {
    if (typeof readJSON !== "function") {
      return;
    }

    const config = readJSON(CONFIG_FILE);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return;
    }

    if (!migrateLegacyManagedFileProvider(config)) {
      return;
    }

    let writeOk = false;
    if (typeof writeJSON === "function") {
      writeOk = writeJSON(CONFIG_FILE, config);
    } else {
      try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
        writeOk = true;
      } catch (err) {
        writeOk = false;
      }
    }

    if (!writeOk) {
      throw new Error("启动前配置迁移失败：无法写入配置文件");
    }
  }

  async function startGateway() {
    migrateConfigBeforeGatewayStart();

    try {
      await execCommand('pkill -9 -f "openclaw.*gateway"');
    } catch (e) {
      console.log("[gateway] No existing gateway process to kill");
    }
    const startCmd = `nohup env HOME="/root" OPENCLAW_CONFIG_PATH="${CONFIG_FILE}" ${NODE_BIN} ${OC_JS_PATH} gateway --port ${GATEWAY_PORT} > ${LOG_FILE} 2>&1 &`;

    try {
      await execCommand(startCmd);
      return { success: true, method: "nohup-start" };
    } catch (err) {
      throw new Error("启动失败: " + (err.stderr || err.message));
    }
  }

  async function stopGateway() {
    const stopCmd = `pkill -9 -f "openclaw.*gateway"`;
    try {
      await execCommand(stopCmd);
      return { success: true, method: "pkill-stop" };
    } catch (err) {
      return { success: true, note: "Process was already stopped" };
    }
  }

  async function restartGateway() {
    try {
      await stopGateway();
      await new Promise((resolve) => setTimeout(resolve, GATEWAY_RESTART_DELAY));
      await startGateway();
      return { success: true, method: "nohup-restart" };
    } catch (err) {
      throw new Error("重启流程失败: " + err.message);
    }
  }

  async function getStatus() {
    const now = Date.now();
    if (statusCache && (now - statusCacheTime) < STATUS_CACHE_TTL) {
      return statusCache;
    }

    const token = String(getTokenFromConfig() || "").trim();
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
      tokenConfigured: token.length > 0,
      uptime: null,
    };

    try {
      const packageJson = readJSON(OC_PKG_JSON_PATH);
      if (packageJson && packageJson.version) {
        status.version = packageJson.version;
      }
    } catch (err) {}

    try {
      const pgrepOut = await execCommand(
        `pgrep -f "openclaw.*gateway" | head -n 1`,
      );
      const pid = pgrepOut.trim();

      if (!pid || isNaN(pid)) {
        status.gateway = "offline";
      } else {
        status.gateway = "running";
        status.gatewayPid = parseInt(pid);

        const psOut = await execCommand(
          `ps -p ${pid} -o %cpu,rss,lstart --no-headers`,
        );
        const stats = psOut.trim().split(/\s+/);

        status.system.cpuUsage = parseFloat(stats[0]) || 0;
        const memoryKB = parseInt(stats[1]) || 0;
        status.system.memoryMB = memoryKB / 1024;

        try {
          const memInfo = await execCommand("cat /proc/meminfo");
          const totalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
          if (totalMatch) {
            const totalMemoryKB = parseInt(totalMatch[1]);
            status.system.totalMemoryMB = totalMemoryKB / 1024;
            status.system.memoryPercent =
              (memoryKB / totalMemoryKB) * 100;
          }
        } catch (e) {}

        if (stats.length > 2) {
          const startTimeStr = stats.slice(2).join(" ");
          try {
            const startTime = new Date(startTimeStr);
            const now = new Date();
            status.uptime = Math.floor((now - startTime) / 1000);
          } catch (e) {}
        }
      }
    } catch (err) {
      status.gateway = "offline";
    }

    statusCache = status;
    statusCacheTime = now;
    return status;
  }

  async function getCurrentVersion() {
    const packageJson = readJSON(OC_PKG_JSON_PATH);
    return {
      version: packageJson ? packageJson.version : "unknown",
    };
  }

  async function getLatestVersion() {
    try {
      console.log("[management-api] 检查最新版本...");

      const npmCmd = `${NODE_BIN} ${path.join(path.dirname(NODE_BIN), "npm")}`;

      await execCommand(`${npmCmd} config set registry https://registry.npmmirror.com`, {
        env: { ...process.env, HOME: "/root" },
      });

      const output = await execCommand(`${npmCmd} view openclaw version`, {
        timeout: NPM_VIEW_TIMEOUT,
        env: { ...process.env, HOME: "/root" },
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

  async function updateVersion() {
    try {
      console.log("[management-api] 开始更新 OpenClaw...");

      await stopGateway();
      console.log("[management-api] Gateway 已停止");

      const npmCmd = `${NODE_BIN} ${path.join(path.dirname(NODE_BIN), "npm")}`;

      await execCommand(`${npmCmd} config set registry https://registry.npmmirror.com`, {
        cwd: TRIM_PKGVAR,
        env: { ...process.env, HOME: "/root" },
      });

      await execCommand(`${npmCmd} install openclaw@latest`, {
        cwd: TRIM_PKGVAR,
        timeout: NPM_INSTALL_TIMEOUT,
        env: { ...process.env, HOME: "/root" },
      });
      console.log("[management-api] OpenClaw 更新完成");

      await startGateway();
      console.log("[management-api] Gateway 已重启");

      return { success: true };
    } catch (err) {
      console.error("[management-api] 更新失败:", err);
      if (isAppError(err)) {
        throw err;
      }
      const message = String(err?.stderr || err?.message || "更新失败");
      const details = err?.stderr ? { stderr: String(err.stderr) } : undefined;
      const normalized = message.toLowerCase();
      const isNpmOrRegistryError =
        normalized.includes("npm") ||
        normalized.includes("registry") ||
        normalized.includes("eai_") ||
        normalized.includes("etimedout") ||
        normalized.includes("econn");

      if (isNpmOrRegistryError) {
        throw badGatewayError(`更新失败: ${message}`, details);
      }
      throw conflictError(`更新失败: ${message}`, details);
    }
  }

  async function getConsoleUrl(req) {
    const token = getTokenFromConfig();
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

  async function getLogs(lines = 1000) {
    try {
      if (!fs.existsSync(LOG_FILE)) {
        return { logs: "(日志文件尚不存在，请先启动 Gateway)" };
      }
      const output = await execCommand(`tail -n ${lines} ${LOG_FILE}`);
      return { logs: output || "(日志文件为空)" };
    } catch (err) {
      return { logs: `(读取日志失败: ${err.message})` };
    }
  }

  return {
    startGateway,
    stopGateway,
    restartGateway,
    getStatus,
    getCurrentVersion,
    getLatestVersion,
    updateVersion,
    getConsoleUrl,
    getLogs,
  };
}

module.exports = {
  createGatewayService,
};
