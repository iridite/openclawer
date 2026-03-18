const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { findPrimaryModelFallback, cleanupEmptyProvider } = require("../core/config-helpers");
const {
  OC_DEPLOY_SECRETS_FILENAME,
  inferApiKeyStorageMode,
  migrateLegacyManagedFileProvider,
  ensureEnvSecretProvider,
  buildEnvSecretRef,
  setManagedProviderApiKey,
  removeManagedProviderApiKey,
} = require("../core/secrets");
const {
  applyManagedConfigPatch,
  buildDefaultConfig,
} = require("../core/default-config");

function createConfigService(deps) {
  const {
    CONFIG_FILE,
    INITIAL_CONFIG_FILE,
    GATEWAY_PORT,
    OC_HOME,
    OC_PKG_JSON_PATH,
    DEFAULT_ALLOWED_PLUGINS,
    readJSON,
    writeJSON,
    getTokenFromConfig,
    restartGateway,
    isApiKeyProtectionEnabled,
  } = deps;
  const SECRET_FILE_PATH = path.join(
    path.dirname(CONFIG_FILE),
    OC_DEPLOY_SECRETS_FILENAME,
  );

  function normalizeBool(value) {
    return value === true || value === "true";
  }

  function normalizeStorageMode(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    return raw === "file-direct" ? "managed-file" : raw;
  }

  function isSecretRefStorageMode(mode) {
    return mode === "managed-file" || mode === "env";
  }

  function isValidEnvVarName(name) {
    return /^[A-Z_][A-Z0-9_]*$/.test(String(name || "").trim());
  }

  function cleanupManagedProviderSecretIfNeeded(providerName) {
    removeManagedProviderApiKey({
      providerName,
      secretFilePath: SECRET_FILE_PATH,
    });
  }

  function buildProviderApiKeyForSave(config, providerName, modelData, existingApiKey) {
    const requestedMode = normalizeStorageMode(modelData?.apiKeyStorageMode);
    const hasExistingApiKey = existingApiKey !== undefined && existingApiKey !== null;
    const existingMode = hasExistingApiKey
      ? normalizeStorageMode(inferApiKeyStorageMode(existingApiKey))
      : "";
    const apiKeyProtectionEnabled =
      typeof isApiKeyProtectionEnabled === "function" &&
      isApiKeyProtectionEnabled() === true;
    const policyDefaultMode =
      apiKeyProtectionEnabled
        ? "managed-file"
        : "plaintext";
    const fallbackMode = hasExistingApiKey
      ? existingMode
      : policyDefaultMode;
    const resolvedMode = requestedMode || fallbackMode;
    const mode = normalizeStorageMode(resolvedMode) || "plaintext";
    const rawApiKey = String(modelData?.apiKey || "").trim();
    const rawEnvVar = String(modelData?.apiKeyEnvVar || "").trim();
    const keepExisting = normalizeBool(modelData?.keepExistingApiKeyRef);

    if (mode !== "plaintext" && mode !== "managed-file" && mode !== "env") {
      throw new Error(`不支持的 API Key 存储方式: ${mode}`);
    }

    if (!apiKeyProtectionEnabled && isSecretRefStorageMode(mode)) {
      const existingEnvVar =
        existingMode === "env" &&
        existingApiKey &&
        typeof existingApiKey === "object" &&
        !Array.isArray(existingApiKey)
          ? (
              typeof existingApiKey.env === "string"
                ? existingApiKey.env
                : existingApiKey.id
            ) || ""
          : "";
      const envVarUnchanged = !rawEnvVar || rawEnvVar === String(existingEnvVar).trim();
      const canKeepLegacySecretRefUnchanged =
        keepExisting &&
        !rawApiKey &&
        envVarUnchanged &&
        isSecretRefStorageMode(existingMode) &&
        existingApiKey &&
        typeof existingApiKey === "object" &&
        !Array.isArray(existingApiKey);

      if (!canKeepLegacySecretRefUnchanged) {
        throw new Error(
          "当前未开启 API 防护，禁止将模型密钥配置为 SecretRef。请改用明文，或先到“系统”启用 API 防护。",
        );
      }

      return {
        value: existingApiKey,
        storageMode: existingMode === "env" ? "env" : "managed-file",
      };
    }

    if (mode === "env") {
      const envVar = rawEnvVar;
      if (!isValidEnvVarName(envVar)) {
        throw new Error("环境变量名不合法（示例：OPENAI_API_KEY）");
      }
      ensureEnvSecretProvider(config, "default");
      return {
        value: buildEnvSecretRef(envVar, "default"),
        storageMode: "env",
      };
    }

    if (mode === "managed-file") {
      if (
        keepExisting &&
        existingApiKey &&
        typeof existingApiKey === "object" &&
        !Array.isArray(existingApiKey)
      ) {
        return {
          value: existingApiKey,
          storageMode: "managed-file",
        };
      }
      if (!rawApiKey) {
        throw new Error("API Key 不能为空");
      }
      return {
        value: setManagedProviderApiKey({
          config,
          providerName,
          apiKey: rawApiKey,
          secretFilePath: SECRET_FILE_PATH,
        }),
        storageMode: "managed-file",
      };
    }

    if (!rawApiKey) {
      throw new Error("API Key 不能为空");
    }
    return {
      value: rawApiKey,
      storageMode: "plaintext",
    };
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

    return buildDefaultConfig({
      gatewayPort: GATEWAY_PORT,
      ocHome: OC_HOME,
      allowedPlugins: mergedAllow,
      preservedToken,
      lastTouchedVersion,
      timestamp: new Date().toISOString(),
    });
  }

  async function getConfig() {
    const config = readJSON(CONFIG_FILE);
    if (!config) {
      return applyManagedConfigPatch({
        models: {},
        channels: {},
      }, {
        gatewayPort: GATEWAY_PORT,
        ocHome: OC_HOME,
        allowedPlugins: DEFAULT_ALLOWED_PLUGINS,
        preservedToken: getTokenFromConfig(),
      });
    }

    const providerMigrationChanged = migrateLegacyManagedFileProvider(config);
    if (providerMigrationChanged) {
      const writeOk = writeJSON(CONFIG_FILE, config);
      if (!writeOk) {
        throw new Error("配置自动迁移失败：无法写入配置文件");
      }
    }

    return config;
  }

  async function saveConfig(newConfig) {
    if (!newConfig || typeof newConfig !== "object") {
      throw new Error("无效的配置格式");
    }

    migrateLegacyManagedFileProvider(newConfig);

    const validation = await validateConfig(newConfig);
    if (!validation.valid) {
      const errorList = validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
      throw new Error(`配置验证失败:\n${errorList}`);
    }

    if (fs.existsSync(CONFIG_FILE)) {
      const backupFile = CONFIG_FILE + ".backup." + Date.now();
      fs.copyFileSync(CONFIG_FILE, backupFile);
      if (!fs.existsSync(backupFile) || fs.statSync(backupFile).size === 0) {
        throw new Error("备份创建失败");
      }
    }

    const success = writeJSON(CONFIG_FILE, newConfig);
    if (!success) {
      throw new Error("写入配置文件失败");
    }

    return { success: true };
  }

  async function resetConfig() {
    const timestamp = Date.now();
    const backupFile = `${CONFIG_FILE}.backup.reset.${timestamp}`;
    const hasExistingConfig = fs.existsSync(CONFIG_FILE);
    const existingConfig = readJSON(CONFIG_FILE) || {};

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

  function validateModelData(modelData) {
    const { modelId, providerName } = modelData;

    if (!modelId) throw new Error("模型 ID 不能为空");
    if (!providerName) throw new Error("供应商名称不能为空");

    const modelIdPattern = /^[a-zA-Z0-9._/:-]+$/;
    if (!modelIdPattern.test(modelId)) {
      throw new Error("模型 ID 只能包含字母、数字、点号(.)、斜杠(/)、冒号(:)、连字符(-)和下划线(_)");
    }
    const providerPattern = /^[a-z-]+$/;
    if (!providerPattern.test(providerName)) {
      throw new Error("供应商名称只能包含小写英文字符(a-z)和连字符(-)");
    }
  }

  function removeOldModel(config, editModelKey, options = {}) {
    const { cleanupProviderSecret = true } = options;
    const [oldProvider, ...oldModelIdParts] = editModelKey.split("/");
    const oldModelId = oldModelIdParts.join("/");

    if (!config.models.providers[oldProvider]) {
      return { oldProvider, providerRemoved: false };
    }

    const oldModelIndex = config.models.providers[oldProvider].models?.findIndex((m) => {
      const mId = m.id || "";
      const mName = m.name || "";
      const mModel = m.model || "";
      return mId === oldModelId || mName === oldModelId || mModel === oldModelId;
    });

    if (oldModelIndex >= 0) {
      config.models.providers[oldProvider].models.splice(oldModelIndex, 1);
    }

    if (config.agents.defaults.models[editModelKey]) {
      delete config.agents.defaults.models[editModelKey];
    }

    const providerRemoved = cleanupEmptyProvider(config, oldProvider);
    if (providerRemoved && cleanupProviderSecret) {
      cleanupManagedProviderSecretIfNeeded(oldProvider);
    }

    return { oldProvider, providerRemoved };
  }

  function ensureProvider(
    config,
    providerName,
    baseUrl,
    providerApiKey,
    apiType,
    apiProtocol,
  ) {
    if (!config.models.providers[providerName]) {
      config.models.providers[providerName] = {
        baseUrl,
        apiKey: providerApiKey,
        api: apiType || apiProtocol,
        models: [],
      };
    } else {
      if (baseUrl) config.models.providers[providerName].baseUrl = baseUrl;
      if (providerApiKey !== undefined) {
        config.models.providers[providerName].apiKey = providerApiKey;
      }
      if (apiType || apiProtocol) {
        config.models.providers[providerName].api = apiType || apiProtocol;
      }
      if (!config.models.providers[providerName].models) {
        config.models.providers[providerName].models = [];
      }
    }
  }

  function buildModelConfig(modelId, advanced) {
    return {
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
  }

  function upsertModel(config, providerName, modelId, modelConfig) {
    const existingIndex = config.models.providers[providerName].models.findIndex((m) => {
      const mId = m.id || "";
      const mName = m.name || "";
      const mModel = m.model || "";
      return mId === modelId || mName === modelId || mModel === modelId;
    });

    if (existingIndex >= 0) {
      config.models.providers[providerName].models[existingIndex] = modelConfig;
    } else {
      config.models.providers[providerName].models.push(modelConfig);
    }
  }

  function updatePrimaryModel(config, agentModelKey, isEditMode, editModelKey) {
    const existingPrimary = config.agents.defaults.model?.primary || "";
    config.agents.defaults.model = config.agents.defaults.model || {};

    if (!existingPrimary) {
      config.agents.defaults.model.primary = agentModelKey;
    } else if (isEditMode && editModelKey && existingPrimary === editModelKey) {
      config.agents.defaults.model.primary = agentModelKey;
    } else {
      config.agents.defaults.model.primary = existingPrimary;
    }
  }

  async function addModel(modelData) {
    const isEditOperation = modelData?.isEditMode === true || modelData?.isEditMode === "true";

    try {
      const config = readJSON(CONFIG_FILE);
      if (!config) throw new Error("配置文件不存在");

      config.models = config.models || {};
      config.models.mode = config.models.mode || "merge";
      config.models.providers = config.models.providers || {};
      config.agents = config.agents || {};
      config.agents.defaults = config.agents.defaults || {};
      config.agents.defaults.models = config.agents.defaults.models || {};
      migrateLegacyManagedFileProvider(config);

      const {
        providerName,
        modelId,
        apiProtocol,
        apiType,
        advanced,
        isEditMode,
        editModelKey,
      } = modelData;
      const baseUrl = String(modelData?.baseUrl || "").trim();

      validateModelData(modelData);

      const existingApiKey = config.models.providers[providerName]?.apiKey;
      const providerApiKeyPayload = buildProviderApiKeyForSave(
        config,
        providerName,
        modelData,
        existingApiKey,
      );

      let oldModelCleanup = null;
      if (isEditMode && editModelKey) {
        oldModelCleanup = removeOldModel(config, editModelKey, {
          cleanupProviderSecret: false,
        });
      }

      ensureProvider(
        config,
        providerName,
        baseUrl,
        providerApiKeyPayload.value,
        apiType,
        apiProtocol,
      );
      const modelConfig = buildModelConfig(modelId, advanced);
      upsertModel(config, providerName, modelId, modelConfig);

      if (providerApiKeyPayload.storageMode !== "managed-file") {
        cleanupManagedProviderSecretIfNeeded(providerName);
      }
      if (
        oldModelCleanup?.providerRemoved &&
        oldModelCleanup.oldProvider &&
        oldModelCleanup.oldProvider !== providerName
      ) {
        cleanupManagedProviderSecretIfNeeded(oldModelCleanup.oldProvider);
      }

      const agentModelKey = `${providerName}/${modelId}`;
      config.agents.defaults.models[agentModelKey] = {};
      updatePrimaryModel(config, agentModelKey, isEditMode, editModelKey);

      const success = writeJSON(CONFIG_FILE, config);
      if (!success) throw new Error("保存配置失败");

      return {
        success: true,
        message: isEditMode ? "模型修改成功" : "模型添加成功",
        modelKey: agentModelKey,
        apiKeyStorage: providerApiKeyPayload.storageMode,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      console.error("[addModel] failed", { isEditOperation, rawError: err, errorMessage });
      throw new Error(`${isEditOperation ? "修改模型失败" : "添加模型失败"}: ${errorMessage || "未知错误"}`);
    }
  }

  async function deleteModel(modelKey) {
    try {
      console.log(`[deleteModel] 接收到的 modelKey: "${modelKey}"`);

      const config = readJSON(CONFIG_FILE);
      if (!config || !config.models) {
        throw new Error("配置文件不存在或格式错误");
      }
      migrateLegacyManagedFileProvider(config);

      const [providerName, ...modelIdParts] = modelKey.split("/");
      const modelId = modelIdParts.join("/");

      console.log(
        `[deleteModel] 解析后 - providerName: "${providerName}", modelId: "${modelId}"`,
      );

      if (!providerName || !modelId) {
        throw new Error(
          `模型标识格式错误，应为 providerName/modelId。收到: "${modelKey}"`,
        );
      }

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

      const modelIndex = provider.models.findIndex((m) => {
        const mId = m.id || "";
        const mName = m.name || "";
        const mModel = m.model || "";
        return mId === modelId || mName === modelId || mModel === modelId;
      });

      console.log(`[deleteModel] 查找结果 - modelIndex: ${modelIndex}`);

      if (modelIndex === -1) {
        const modelDetails = provider.models
          .map((m, idx) => {
            return `[${idx}] id="${m.id || "undefined"}" name="${m.name || "undefined"}"`;
          })
          .join(", ");
        throw new Error(
          `模型 "${modelId}" 在供应商 "${providerName}" 中不存在。该供应商下的所有模型: ${modelDetails || "无模型"}`,
        );
      }

      const backupFile = `${CONFIG_FILE}.backup.${Date.now()}`;
      writeJSON(backupFile, config);

      provider.models.splice(modelIndex, 1);

      if (provider.models.length === 0) {
        delete config.models.providers[providerName];
        cleanupManagedProviderSecretIfNeeded(providerName);
      }

      if (config.agents?.defaults?.models?.[modelKey]) {
        delete config.agents.defaults.models[modelKey];
      }

      if (config.agents?.defaults?.model?.primary === modelKey) {
        const fallbackPrimary = findPrimaryModelFallback(config.models?.providers || {}, null);
        if (fallbackPrimary) {
          config.agents.defaults.model.primary = fallbackPrimary;
        } else {
          delete config.agents.defaults.model.primary;
        }
      }

      const success = writeJSON(CONFIG_FILE, config);
      if (!success) {
        throw new Error("保存配置失败");
      }

      return { success: true, message: `模型 "${modelKey}" 已删除` };
    } catch (err) {
      throw new Error("删除模型失败: " + err.message);
    }
  }

  async function clearAllModelConfigs(options = {}) {
    const reason = String(options?.reason || "").trim() || "manual-reset";

    const config = readJSON(CONFIG_FILE);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("配置文件不存在或格式错误");
    }
    migrateLegacyManagedFileProvider(config);

    let backupFile = null;
    if (fs.existsSync(CONFIG_FILE)) {
      backupFile = `${CONFIG_FILE}.backup.models-reset.${Date.now()}`;
      fs.copyFileSync(CONFIG_FILE, backupFile);
      if (!fs.existsSync(backupFile) || fs.statSync(backupFile).size === 0) {
        throw new Error("清空模型前创建备份失败");
      }
    }
    let secretBackupFile = null;
    if (fs.existsSync(SECRET_FILE_PATH)) {
      secretBackupFile = `${SECRET_FILE_PATH}.backup.models-reset.${Date.now()}`;
      fs.copyFileSync(SECRET_FILE_PATH, secretBackupFile);
      if (
        !fs.existsSync(secretBackupFile) ||
        fs.statSync(secretBackupFile).size === 0
      ) {
        throw new Error("清空模型前创建密钥备份失败");
      }
    }

    const providers =
      config.models?.providers &&
      typeof config.models.providers === "object" &&
      !Array.isArray(config.models.providers)
        ? config.models.providers
        : {};
    const providerNames = Object.keys(providers);

    let modelsCleared = 0;
    providerNames.forEach((providerName) => {
      const provider = providers[providerName];
      if (Array.isArray(provider?.models)) {
        modelsCleared += provider.models.length;
      }
    });

    const existingMode =
      typeof config.models?.mode === "string" && config.models.mode.trim()
        ? config.models.mode
        : "merge";
    config.models = {
      mode: existingMode,
      providers: {},
    };

    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    const existingAgentModels =
      config.agents.defaults.models &&
      typeof config.agents.defaults.models === "object" &&
      !Array.isArray(config.agents.defaults.models)
        ? config.agents.defaults.models
        : {};
    const agentMappingsCleared = Object.keys(existingAgentModels).length;
    config.agents.defaults.models = {};
    if (
      config.agents.defaults.model &&
      typeof config.agents.defaults.model === "object" &&
      !Array.isArray(config.agents.defaults.model)
    ) {
      delete config.agents.defaults.model.primary;
    }

    const success = writeJSON(CONFIG_FILE, config);
    if (!success) {
      throw new Error("清空模型配置失败");
    }

    let secretCleanupErrors = 0;
    providerNames.forEach((providerName) => {
      try {
        cleanupManagedProviderSecretIfNeeded(providerName);
      } catch (err) {
        secretCleanupErrors += 1;
      }
    });

    return {
      success: true,
      reason,
      backupFile,
      secretFilePath: SECRET_FILE_PATH,
      secretBackupFile,
      providersCleared: providerNames.length,
      modelsCleared,
      agentMappingsCleared,
      secretCleanupErrors,
    };
  }

  function validateModels(config, errors) {
    if (config.models === undefined) return;

    if (!config.models || typeof config.models !== "object" || Array.isArray(config.models)) {
      errors.push("models 必须是对象");
      return;
    }

    if (config.models.providers !== undefined) {
      const providers = config.models.providers;
      if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
        errors.push("models.providers 必须是对象");
        return;
      }

      for (const [providerName, provider] of Object.entries(providers)) {
        if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
          errors.push(`供应商 ${providerName} 配置格式错误`);
          continue;
        }

        if (provider.models !== undefined && !Array.isArray(provider.models)) {
          errors.push(`供应商 ${providerName} 的 models 必须是数组`);
          continue;
        }

        if (Array.isArray(provider.models)) {
          provider.models.forEach((model, idx) => {
            if (!model || typeof model !== "object" || Array.isArray(model)) {
              errors.push(`供应商 ${providerName} 的第 ${idx + 1} 个模型格式错误`);
              return;
            }
            if (!model.id && !model.name) {
              errors.push(`供应商 ${providerName} 的第 ${idx + 1} 个模型缺少 id/name`);
            }
          });
        }
      }
    } else {
      for (const [name, model] of Object.entries(config.models)) {
        if (name === "mode" || name === "providers") continue;
        if (!model || typeof model !== "object" || Array.isArray(model)) continue;
        if (!model.provider) errors.push(`模型 ${name} 缺少 provider 字段`);
        if (!model.apiKey) errors.push(`模型 ${name} 缺少 apiKey 字段`);
      }
    }
  }

  function validateChannels(config, errors) {
    if (config.channels === undefined) return;

    if (!config.channels || typeof config.channels !== "object" || Array.isArray(config.channels)) {
      errors.push("channels 必须是对象");
      return;
    }

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

        if (!hasTelegramShape && !hasFeishuShape && !hasDiscordShape && !hasQqbotShape && !hasWecomShape) {
          errors.push(`渠道 ${name} 缺少 type 字段`);
        }
      }
    }
  }

  async function validateConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return { valid: false, errors: ["配置根节点必须是 JSON 对象"] };
    }

    const errors = [];
    validateModels(config, errors);
    validateChannels(config, errors);

    return { valid: errors.length === 0, errors };
  }

  return {
    getConfig,
    saveConfig,
    resetConfig,
    addModel,
    deleteModel,
    clearAllModelConfigs,
    validateConfig,
    analyzeConfigImpact: (newConfig) => {
      const oldConfig = readJSON(CONFIG_FILE) || {};
      const affectedAreas = [];
      let requiresRestart = false;

      const oldGw = oldConfig.gateway || {};
      const newGw = newConfig.gateway || {};
      if (oldGw.port !== newGw.port || oldGw.bind !== newGw.bind ||
          oldGw.mode !== newGw.mode || oldGw.auth?.mode !== newGw.auth?.mode) {
        affectedAreas.push("Gateway 配置");
        requiresRestart = true;
      }

      const oldAllow = oldConfig.plugins?.allow;
      const newAllow = newConfig.plugins?.allow;
      if (Array.isArray(oldAllow) !== Array.isArray(newAllow) ||
          (Array.isArray(oldAllow) && (oldAllow.length !== newAllow.length ||
           oldAllow.some((v, i) => v !== newAllow[i])))) {
        affectedAreas.push("插件列表");
        requiresRestart = true;
      }

      const oldPrimary = oldConfig.agents?.defaults?.model?.primary;
      const newPrimary = newConfig.agents?.defaults?.model?.primary;
      if (oldPrimary !== newPrimary) {
        affectedAreas.push("主模型");
        requiresRestart = true;
      }

      return { requiresRestart, affectedAreas };
    },
  };
}

module.exports = { createConfigService };
