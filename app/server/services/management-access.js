const { badRequestError } = require("../core/http-errors");

function createManagementAccessService(options) {
  const {
    MANAGEMENT_ACCESS_FILE,
    readJSON,
    writeJSON,
  } = options;

  function resolveAccessState() {
    const persisted = readJSON(MANAGEMENT_ACCESS_FILE);
    if (persisted && typeof persisted.allowRemote === "boolean") {
      return {
        allowRemote: persisted.allowRemote,
        source: "file",
        updatedAt: persisted.updatedAt || "",
        file: MANAGEMENT_ACCESS_FILE,
      };
    }

    return {
      allowRemote: false,
      source: "default",
      file: MANAGEMENT_ACCESS_FILE,
    };
  }

  function isRemoteAccessEnabled() {
    return resolveAccessState().allowRemote === true;
  }

  async function getManagementAccess() {
    return {
      success: true,
      ...resolveAccessState(),
    };
  }

  async function setManagementAccess(payload) {
    if (!payload || typeof payload !== "object") {
      throw badRequestError("请求体必须是 JSON 对象");
    }
    if (typeof payload.allowRemote !== "boolean") {
      throw badRequestError("allowRemote 必须是布尔值");
    }

    const persisted = {
      allowRemote: payload.allowRemote,
      updatedAt: new Date().toISOString(),
    };
    const success = writeJSON(MANAGEMENT_ACCESS_FILE, persisted);
    if (!success) {
      throw new Error("保存管理访问设置失败");
    }

    const effective = resolveAccessState();
    return {
      success: true,
      persistedAllowRemote: payload.allowRemote,
      ...effective,
    };
  }

  return {
    isRemoteAccessEnabled,
    getManagementAccess,
    setManagementAccess,
  };
}

module.exports = {
  createManagementAccessService,
};
