const fs = require("fs");
const {
  badRequestError,
  notFoundError,
  normalizeError,
} = require("../core/http-errors");

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
    setPrimaryModel,
    upsertChannel,
    deleteChannel,
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
    updateToolProfile,
  } = deps;

  async function parseJsonBody(req) {
    const body = await readBody(req);
    try {
      return JSON.parse(body);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw badRequestError("无效的 JSON 格式");
      }
      throw e;
    }
  }

  function sendJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  function sendError(res, err) {
    const normalized = normalizeError(err);
    const payload = {
      error: normalized.message,
      code: normalized.code,
      status: normalized.statusCode,
    };

    if (normalized.details !== undefined) {
      payload.details = normalized.details;
    }

    sendJson(res, normalized.statusCode, payload);
  }

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
              sendError(res, err);
            } else {
              res.destroy(err);
            }
          });
          stream.on("close", cleanup);
          res.on("close", cleanup);
          stream.pipe(res);
        })
        .catch((err) => sendError(res, err));
      return true;
    }

    if (method === "POST" && pathname === "/api/backup/import") {
      importBackupArchiveFromRequest(req)
        .then((result) => {
          sendJson(res, 200, result);
        })
        .catch((err) => sendError(res, err));
      return true;
    }

    const routes = {
      "GET /api/status": getStatus,
      "GET /api/config": getConfig,
      "POST /api/config": async () => saveConfig(await parseJsonBody(req)),
      "POST /api/config/reset": resetConfig,
      "POST /api/config/validate": async () => validateConfig(await parseJsonBody(req)),
      "POST /api/config/analyze-impact": async () => analyzeConfigImpact(await parseJsonBody(req)),
      "POST /api/models/add": async () => addModel(await parseJsonBody(req)),
      "POST /api/models/primary": async () => {
        const data = await parseJsonBody(req);
        return setPrimaryModel(data.modelKey);
      },
      "POST /api/models/delete": async () => {
        const data = await parseJsonBody(req);
        return deleteModel(data.modelKey);
      },
      "POST /api/models/test": async () => testModel(await parseJsonBody(req)),
      "POST /api/channels/upsert": async () => upsertChannel(await parseJsonBody(req)),
      "POST /api/channels/delete": async () => {
        const data = await parseJsonBody(req);
        return deleteChannel(data.channelId);
      },
      "POST /api/tools/profile": async () => {
        const data = await parseJsonBody(req);
        return updateToolProfile(data.profile);
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
      "GET /api/logs": () => getLogs(parseInt(url.searchParams.get("lines") || "1000", 10)),
      "GET /api/skills/search": () => {
        const query = url.searchParams.get("q") || "";
        const limit = parseInt(url.searchParams.get("limit") || "20", 10);
        return searchSkills(query, limit);
      },
      "GET /api/skills/list": listSkills,
      "POST /api/skills/install": async () => {
        const data = await parseJsonBody(req);
        return installSkill(data.slug, data.force || false);
      },
      "POST /api/skills/uninstall": async () => {
        const data = await parseJsonBody(req);
        return uninstallSkill(data.slug);
      },
      "POST /api/skills/toggle": async () => {
        const data = await parseJsonBody(req);
        return toggleSkill(data.slug, data.enabled, {
          entryKey: data.entryKey,
          location: data.location,
        });
      },
      "POST /api/skills/update": async () => {
        const data = await parseJsonBody(req);
        if (data?.all === true) {
          return updateAllSkills();
        }
        if (!data?.slug) {
          throw badRequestError("缺少技能名称");
        }
        return updateSkill(data.slug);
      },
      "GET /api/management/access": getManagementAccess,
      "POST /api/management/access": async () =>
        setManagementAccess(await parseJsonBody(req)),
      "GET /api/security/api-key-protection": getApiKeyProtection,
      "POST /api/security/api-key-protection": async () =>
        setApiKeyProtection(await parseJsonBody(req)),
    };

    const routeKey = `${method} ${pathname}`;
    const handler = routes[routeKey];

    if (handler) {
      handler()
        .then((result) => {
          sendJson(res, 200, result);
        })
        .catch((err) => sendError(res, err));
      return true;
    }

    sendError(res, notFoundError("接口不存在"));
    return true;
  }

  return { handleApiRoutes };
}

module.exports = { createRouter };
