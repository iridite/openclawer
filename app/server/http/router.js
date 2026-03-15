const fs = require("fs");

function createRouter(deps) {
  const {
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
  } = deps;

  function handleApiRoutes(req, res, pathname, method, url) {
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
      return true;
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
      return true;
    }

    const routes = {
      "GET /api/status": getStatus,
      "GET /api/config": getConfig,
      "POST /api/config": async () => {
        const body = await readBody(req);
        try {
          return saveConfig(JSON.parse(body));
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error("无效的 JSON 格式");
          }
          throw e;
        }
      },
      "POST /api/config/reset": resetConfig,
      "POST /api/config/validate": async () => {
        const body = await readBody(req);
        try {
          return validateConfig(JSON.parse(body));
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error("无效的 JSON 格式");
          }
          throw e;
        }
      },
      "POST /api/config/analyze-impact": async () => {
        const body = await readBody(req);
        try {
          return analyzeConfigImpact(JSON.parse(body));
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error("无效的 JSON 格式");
          }
          throw e;
        }
      },
      "POST /api/models/add": async () => {
        const body = await readBody(req);
        try {
          return addModel(JSON.parse(body));
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error("无效的 JSON 格式");
          }
          throw e;
        }
      },
      "POST /api/models/delete": async () => {
        const body = await readBody(req);
        try {
          const data = JSON.parse(body);
          return deleteModel(data.modelKey);
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error("无效的 JSON 格式");
          }
          throw e;
        }
      },
      "POST /api/models/test": async () => {
        const body = await readBody(req);
        try {
          return testModel(JSON.parse(body));
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error("无效的 JSON 格式");
          }
          throw e;
        }
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
      return true;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
    return true;
  }

  return { handleApiRoutes };
}

module.exports = { createRouter };
