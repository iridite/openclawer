const fs = require("fs");
const {
  badRequestError,
  notFoundError,
  normalizeError,
} = require("../core/http-errors");

function createRouter(deps) {
  const { readBody, services } = deps;
  const {
    gateway,
    config,
    modelTest,
    plugins,
    backup,
    skills,
    managementAccess,
    apiKeyProtection,
    system,
  } = services;

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

  function parseExpectedConfigVersion(req) {
    const ifMatchRaw = req.headers["if-match"];
    if (typeof ifMatchRaw === "string" && ifMatchRaw.trim()) {
      const normalized = ifMatchRaw
        .trim()
        .replace(/^W\//i, "")
        .replace(/^"|"$/g, "");
      if (normalized && normalized !== "*") {
        return normalized;
      }
    }

    const headerVersion = req.headers["x-config-version"];
    if (typeof headerVersion === "string" && headerVersion.trim()) {
      return headerVersion.trim();
    }

    return "";
  }

  function handleApiRoutes(req, res, pathname, method, url) {
    if (method === "GET" && pathname === "/api/backup/export") {
      backup.createBackupArchive("manual-export")
        .then((backup) => {
          let cleaned = false;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            services.backup.cleanupPathQuietly(backup.workDir);
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
      backup.importBackupArchiveFromRequest(req)
        .then((result) => {
          sendJson(res, 200, result);
        })
        .catch((err) => sendError(res, err));
      return true;
    }

    if (method === "GET" && pathname === "/api/config") {
      config.getConfigWithVersion()
        .then((result) => {
          const version = String(result?.version || "");
          const headers = {
            "Content-Type": "application/json",
          };
          if (version) {
            headers.ETag = `"${version}"`;
            headers["X-Config-Version"] = version;
          }
          res.writeHead(200, headers);
          res.end(JSON.stringify(result?.config || {}));
        })
        .catch((err) => sendError(res, err));
      return true;
    }

    if (method === "POST" && pathname === "/api/config") {
      parseJsonBody(req)
        .then((payload) => config.saveConfig(payload, {
          expectedVersion: parseExpectedConfigVersion(req),
        }))
        .then((result) => {
          sendJson(res, 200, result);
        })
        .catch((err) => sendError(res, err));
      return true;
    }

    const routes = {
      "GET /api/status": gateway.getStatus,
      "POST /api/config/reset": config.resetConfig,
      "POST /api/config/validate": async () => config.validateConfig(await parseJsonBody(req)),
      "POST /api/config/analyze-impact": async () =>
        config.analyzeConfigImpact(await parseJsonBody(req)),
      "POST /api/models/add": async () => config.addModel(await parseJsonBody(req)),
      "POST /api/models/primary": async () => {
        const data = await parseJsonBody(req);
        return config.setPrimaryModel(data.modelKey);
      },
      "POST /api/models/delete": async () => {
        const data = await parseJsonBody(req);
        return config.deleteModel(data.modelKey);
      },
      "POST /api/models/test/prepare": async () =>
        modelTest.prepareModelTest(await parseJsonBody(req)),
      "POST /api/models/test": async () => modelTest.testModel(await parseJsonBody(req)),
      "POST /api/channels/upsert": async () => config.upsertChannel(await parseJsonBody(req)),
      "POST /api/channels/delete": async () => {
        const data = await parseJsonBody(req);
        return config.deleteChannel(data.channelId);
      },
      "POST /api/tools/profile": async () => {
        const data = await parseJsonBody(req);
        return config.updateToolProfile(data.profile);
      },
      "POST /api/gateway/start": gateway.startGateway,
      "POST /api/gateway/stop": gateway.stopGateway,
      "POST /api/gateway/restart": gateway.restartGateway,
      "GET /api/version/current": gateway.getCurrentVersion,
      "GET /api/version/latest": gateway.getLatestVersion,
      "POST /api/version/update": gateway.updateVersion,
      "GET /api/plugins/qqbot/status": plugins.getQqbotPluginStatus,
      "POST /api/plugins/qqbot/install": plugins.installQqbotPlugin,
      "GET /api/plugins/wecom/status": plugins.getWecomPluginStatus,
      "POST /api/plugins/wecom/install": plugins.installWecomPlugin,
      "GET /api/console/url": () => gateway.getConsoleUrl(req),
      "GET /api/system/paths": system.getSystemPaths,
      "GET /api/logs": () => gateway.getLogs(parseInt(url.searchParams.get("lines") || "1000", 10)),
      "GET /api/skills/search": () => {
        const query = url.searchParams.get("q") || "";
        const limit = parseInt(url.searchParams.get("limit") || "20", 10);
        return skills.search(query, limit);
      },
      "GET /api/skills/list": skills.list,
      "POST /api/skills/install": async () => {
        const data = await parseJsonBody(req);
        return skills.install(data.slug, data.force || false);
      },
      "POST /api/skills/uninstall": async () => {
        const data = await parseJsonBody(req);
        return skills.uninstall(data.slug);
      },
      "POST /api/skills/toggle": async () => {
        const data = await parseJsonBody(req);
        return skills.toggle(data.slug, data.enabled, {
          entryKey: data.entryKey,
          location: data.location,
        });
      },
      "POST /api/skills/update": async () => {
        const data = await parseJsonBody(req);
        if (data?.all === true) {
          return skills.updateAll();
        }
        if (!data?.slug) {
          throw badRequestError("缺少技能名称");
        }
        return skills.update(data.slug);
      },
      "GET /api/management/access": managementAccess.getManagementAccess,
      "POST /api/management/access": async () =>
        managementAccess.setManagementAccess(await parseJsonBody(req)),
      "GET /api/security/api-key-protection": apiKeyProtection.getApiKeyProtection,
      "POST /api/security/api-key-protection": async () =>
        apiKeyProtection.setApiKeyProtection(await parseJsonBody(req)),
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
