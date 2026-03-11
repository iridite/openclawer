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
  if (handleDashboardHttp(req, res, url, pathname)) {
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
