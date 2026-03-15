const fs = require("fs");
const crypto = require("crypto");

function createConfigService(deps) {
  const {
    CONFIG_FILE,
    INITIAL_CONFIG_FILE,
    GATEWAY_PORT,
    OC_PKG_JSON_PATH,
    DEFAULT_ALLOWED_PLUGINS,
    readJSON,
    writeJSON,
    getTokenFromConfig,
    restartGateway,
  } = deps;

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

  async function getConfig() {
    const config = readJSON(CONFIG_FILE);
    if (!config) {
      return {
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

  async function saveConfig(newConfig) {
    if (!newConfig || typeof newConfig !== "object") {
      throw new Error("无效的配置格式");
    }

    const validation = validateConfig(newConfig);
    if (!validation.valid) {
      throw new Error(`配置验证失败: ${validation.errors.join(", ")}`);
    }

    if (fs.existsSync(CONFIG_FILE)) {
      const backupFile = CONFIG_FILE + ".backup." + Date.now();
      fs.copyFileSync(CONFIG_FILE, backupFile);
      if (!fs.existsSync(backupFile)) {
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

  async function addModel(modelData) {
    const isEditOperation =
      modelData?.isEditMode === true || modelData?.isEditMode === "true";

    try {
      const config = readJSON(CONFIG_FILE);
      if (!config) {
        throw new Error("配置文件不存在");
      }

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

      if (!modelId) {
        throw new Error("模型 ID 不能为空");
      }
      if (!providerName) {
        throw new Error("供应商名称不能为空");
      }

      const identifierPattern = /^[a-zA-Z0-9./:-]+$/;
      if (!identifierPattern.test(modelId)) {
        throw new Error(
          "模型 ID 只能包含字母、数字、连字符(-)、点号(.)、斜杠(/)和冒号(:)，不能包含空格或其他特殊字符",
        );
      }

      const providerPattern = /^[a-z]+$/;
      if (!providerPattern.test(providerName)) {
        throw new Error(
          "供应商名称只能包含小写英文字符（a-z），不能包含大写字母、数字、中文、空格或特殊字符",
        );
      }

      if (isEditMode && editModelKey) {
        const [oldProvider, ...oldModelIdParts] = editModelKey.split("/");
        const oldModelId = oldModelIdParts.join("/");
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
          if (config.agents.defaults.models[editModelKey]) {
            delete config.agents.defaults.models[editModelKey];
          }
          const oldModels = config.models.providers[oldProvider].models;
          if (!Array.isArray(oldModels) || oldModels.length === 0) {
            delete config.models.providers[oldProvider];
          }
        }
      }

      if (!config.models.providers[providerName]) {
        config.models.providers[providerName] = {
          baseUrl: baseUrl,
          apiKey: apiKey,
          api: apiType || apiProtocol,
          models: [],
        };
      } else {
        if (baseUrl) config.models.providers[providerName].baseUrl = baseUrl;
        if (apiKey) config.models.providers[providerName].apiKey = apiKey;
        if (apiType || apiProtocol) {
          config.models.providers[providerName].api = apiType || apiProtocol;
        }
        if (!config.models.providers[providerName].models) {
          config.models.providers[providerName].models = [];
        }
      }

      const existingModelIndex = config.models.providers[
        providerName
      ].models.findIndex((m) => {
        const mId = m.id || "";
        const mName = m.name || "";
        const mModel = m.model || "";
        return mId === modelId || mName === modelId || mModel === modelId;
      });

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

      if (existingModelIndex >= 0) {
        config.models.providers[providerName].models[existingModelIndex] =
          modelConfig;
      } else {
        config.models.providers[providerName].models.push(modelConfig);
      }

      const agentModelKey = `${providerName}/${modelId}`;
      config.agents.defaults.models[agentModelKey] = {};

      const existingPrimary = config.agents.defaults.model?.primary || "";
      config.agents.defaults.model = config.agents.defaults.model || {};

      if (!existingPrimary) {
        config.agents.defaults.model.primary = agentModelKey;
      } else if (isEditMode && editModelKey && existingPrimary === editModelKey) {
        config.agents.defaults.model.primary = agentModelKey;
      } else {
        config.agents.defaults.model.primary = existingPrimary;
      }

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

  async function deleteModel(modelKey) {
    try {
      console.log(`[deleteModel] 接收到的 modelKey: "${modelKey}"`);

      const config = readJSON(CONFIG_FILE);
      if (!config || !config.models) {
        throw new Error("配置文件不存在或格式错误");
      }

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
      }

      if (config.agents?.defaults?.models?.[modelKey]) {
        delete config.agents.defaults.models[modelKey];
      }

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

      const success = writeJSON(CONFIG_FILE, config);
      if (!success) {
        throw new Error("保存配置失败");
      }

      return { success: true, message: `模型 "${modelKey}" 已删除` };
    } catch (err) {
      throw new Error("删除模型失败: " + err.message);
    }
  }

  async function validateConfig(config) {
    const errors = [];

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return {
        valid: false,
        errors: ["配置根节点必须是 JSON 对象"],
      };
    }

    if (config.models !== undefined) {
      if (
        !config.models ||
        typeof config.models !== "object" ||
        Array.isArray(config.models)
      ) {
        errors.push("models 必须是对象");
      } else if (config.models.providers !== undefined) {
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

  return {
    getConfig,
    saveConfig,
    resetConfig,
    addModel,
    deleteModel,
    validateConfig,
    analyzeConfigImpact: (newConfig) => {
      const oldConfig = readJSON(CONFIG_FILE) || {};
      const affectedAreas = [];
      let requiresRestart = false;

      if (JSON.stringify(oldConfig.gateway) !== JSON.stringify(newConfig.gateway)) {
        affectedAreas.push("Gateway 配置");
        requiresRestart = true;
      }

      if (JSON.stringify(oldConfig.plugins?.allow) !== JSON.stringify(newConfig.plugins?.allow)) {
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
