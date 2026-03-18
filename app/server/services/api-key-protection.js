const { badRequestError } = require("../core/http-errors");

function createApiKeyProtectionService(options) {
  const {
    API_KEY_PROTECTION_FILE,
    readJSON,
    writeJSON,
  } = options;

  function resolveState() {
    const persisted = readJSON(API_KEY_PROTECTION_FILE);
    if (persisted && typeof persisted.enabled === "boolean") {
      return {
        enabled: persisted.enabled,
        source: "file",
        updatedAt: persisted.updatedAt || "",
        file: API_KEY_PROTECTION_FILE,
      };
    }

    return {
      enabled: false,
      source: "default",
      file: API_KEY_PROTECTION_FILE,
    };
  }

  function isApiKeyProtectionEnabled() {
    return resolveState().enabled === true;
  }

  async function getApiKeyProtection() {
    return {
      success: true,
      ...resolveState(),
    };
  }

  async function setApiKeyProtection(payload) {
    if (!payload || typeof payload !== "object") {
      throw badRequestError("请求体必须是 JSON 对象");
    }
    if (typeof payload.enabled !== "boolean") {
      throw badRequestError("enabled 必须是布尔值");
    }

    const persisted = {
      enabled: payload.enabled,
      updatedAt: new Date().toISOString(),
    };
    const success = writeJSON(API_KEY_PROTECTION_FILE, persisted);
    if (!success) {
      throw new Error("保存 API 防护设置失败");
    }

    return {
      success: true,
      persistedEnabled: payload.enabled,
      ...resolveState(),
    };
  }

  return {
    isApiKeyProtectionEnabled,
    getApiKeyProtection,
    setApiKeyProtection,
  };
}

module.exports = {
  createApiKeyProtectionService,
};
