const fs = require("fs");

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
    readJSON,
    execCommand,
    isProcessRunning,
    getTokenFromConfig,
  } = options;

  async function startGateway() {
    try {
      await execCommand('pkill -9 -f "openclaw.*gateway"');
    } catch (e) {}
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await startGateway();
      return { success: true, method: "nohup-restart" };
    } catch (err) {
      throw new Error("重启流程失败: " + err.message);
    }
  }

  async function getStatus() {
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

  async function updateVersion() {
    try {
      console.log("[management-api] 开始更新 OpenClaw...");

      await execCommand("npm config set registry https://registry.npmmirror.com");

      await stopGateway();
      console.log("[management-api] Gateway 已停止");

      await execCommand(`cd ${TRIM_PKGVAR} && npm install openclaw@latest`, {
        timeout: 120000,
      });
      console.log("[management-api] OpenClaw 更新完成");

      await startGateway();
      console.log("[management-api] Gateway 已重启");

      return { success: true };
    } catch (err) {
      console.error("[management-api] 更新失败:", err);
      return {
        success: false,
        message: err.stderr || err.message || "更新失败",
      };
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

  async function getLogs(lines = 100) {
    try {
      const output = await execCommand(`tail -n ${lines} ${LOG_FILE}`);
      return { logs: output };
    } catch (err) {
      return { logs: "" };
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
