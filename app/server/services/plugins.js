const fs = require("fs");
const path = require("path");

function createPluginService(options) {
  const {
    OC_HOME,
    TRIM_PKGVAR,
    CONFIG_FILE,
    OC_BIN_PATH,
    NODE_BIN,
    NODE_BIN_DIR,
    PKG_NODE_BIN_DIR,
    readJSON,
    execCommand,
  } = options;

  const PLUGINS = {
    qqbot: {
      pkg: "@tencent-connect/openclaw-qqbot",
      name: "QQ Bot",
      dirs: [
        ["node_modules", "@tencent-connect", "openclaw-qqbot"],
        ["plugins", "@tencent-connect", "openclaw-qqbot"],
        ["extensions", "openclaw-qqbot"],
      ],
    },
    wecom: {
      pkg: "@wecom/wecom-openclaw-plugin",
      name: "企业微信",
      dirs: [
        ["node_modules", "@wecom", "wecom-openclaw-plugin"],
        ["plugins", "@wecom", "wecom-openclaw-plugin"],
        ["extensions", "wecom-openclaw-plugin"],
      ],
    },
  };

  const installing = {};

  function createPluginHandler(pluginKey) {
    const plugin = PLUGINS[pluginKey];

    function getProofFilePath() {
      const proofFiles = ["package.json", "openclaw.plugin.json", "plugin.json"];
      for (const dirParts of plugin.dirs) {
        const baseDir = path.join(
          dirParts[0] === "node_modules" || dirParts[0] === "plugins"
            ? TRIM_PKGVAR
            : OC_HOME,
          ...dirParts
        );
        for (const proofFile of proofFiles) {
          const candidate = path.join(baseDir, proofFile);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
      return "";
    }

    function getUnverifiedInfo() {
      const extensionDir = path.join(OC_HOME, "extensions", plugin.dirs[2][0]);
      if (!fs.existsSync(extensionDir)) {
        return { exists: false, path: extensionDir };
      }
      const indexCandidates = [
        path.join(extensionDir, "index.js"),
        path.join(extensionDir, "index.ts"),
        path.join(extensionDir, "dist", "index.js"),
      ];
      const hasIndex = indexCandidates.some((c) => fs.existsSync(c));
      return { exists: true, path: extensionDir, hasIndex };
    }

    async function getStatus() {
      const proofFilePath = getProofFilePath();
      if (!proofFilePath) {
        const unverified = getUnverifiedInfo();
        if (unverified.exists) {
          return {
            success: true,
            installed: false,
            verified: false,
            state: "unverified",
            version: "",
            package: plugin.pkg,
            message: `检测到插件目录但缺少插件元数据，无法确认安装状态。若为手动插件，请在 openclaw.json 的 plugins.allow 中加入 ${plugin.dirs[2][0]}；否则请清理 ${unverified.path} 后重试`,
          };
        }
        return {
          success: true,
          installed: false,
          verified: false,
          state: "missing",
          version: "",
          package: plugin.pkg,
        };
      }
      const pkg = readJSON(proofFilePath);
      return {
        success: true,
        installed: true,
        verified: true,
        state: "installed",
        version: pkg?.version || "unknown",
        package: plugin.pkg,
      };
    }

    async function install() {
      if (installing[pluginKey]) {
        throw new Error(`${plugin.name}插件安装中，请稍后重试`);
      }
      const preStatus = await getStatus();
      if (preStatus.state === "installed") {
        return {
          success: true,
          message: `${plugin.name}插件已安装`,
          version: preStatus.version,
          package: preStatus.package,
        };
      }
      if (preStatus.state === "unverified") {
        throw new Error(preStatus.message || `${plugin.name}插件目录异常，请清理后重试`);
      }
      installing[pluginKey] = true;
      try {
        await execCommand(`cd ${TRIM_PKGVAR} && npm install ${plugin.pkg}`, {
          timeout: 120000,
        });
        const postStatus = await getStatus();
        return {
          success: true,
          message: `${plugin.name}插件安装成功`,
          version: postStatus.version,
          package: postStatus.package,
        };
      } finally {
        installing[pluginKey] = false;
      }
    }

    return { getStatus, install };
  }

  const qqbot = createPluginHandler("qqbot");
  const wecom = createPluginHandler("wecom");

  async function getQqbotPluginStatus() {
    return qqbot.getStatus();
  }

  async function installQqbotPlugin() {
    return qqbot.install();
  }

  async function getWecomPluginStatus() {
    return wecom.getStatus();
  }

  async function installWecomPlugin() {
    return wecom.install();
  }

  return {
    getQqbotPluginStatus,
    installQqbotPlugin,
    getWecomPluginStatus,
    installWecomPlugin,
  };
}

module.exports = {
  createPluginService,
};

    const baseDirs = [
      path.join(
        TRIM_PKGVAR,
        "node_modules",
        "@tencent-connect",
        "openclaw-qqbot",
      ),
      path.join(OC_HOME, "plugins", "@tencent-connect", "openclaw-qqbot"),
      path.join(TRIM_PKGVAR, "plugins", "@tencent-connect", "openclaw-qqbot"),
      path.join(OC_HOME, "extensions", "openclaw-qqbot"),
    ];
    const proofFiles = ["package.json", "openclaw.plugin.json", "plugin.json"];

    for (const baseDir of baseDirs) {
      for (const proofFile of proofFiles) {
        const candidate = path.join(baseDir, proofFile);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return "";
  }

  function getQqbotPluginUnverifiedInfo() {
    const extensionDir = path.join(OC_HOME, "extensions", "openclaw-qqbot");
    if (!fs.existsSync(extensionDir)) {
      return { exists: false, path: extensionDir };
    }

    const indexCandidates = [
      path.join(extensionDir, "index.js"),
      path.join(extensionDir, "index.ts"),
      path.join(extensionDir, "dist", "index.js"),
    ];

    const hasIndex = indexCandidates.some((candidate) =>
      fs.existsSync(candidate),
    );

    return { exists: true, path: extensionDir, hasIndex };
  }

  async function getQqbotPluginStatus() {
    const proofFilePath = getQqbotPluginProofFilePath();
    if (!proofFilePath) {
      const unverified = getQqbotPluginUnverifiedInfo();
      if (unverified.exists) {
        return {
          success: true,
          installed: false,
          verified: false,
          state: "unverified",
          version: "",
          package: QQBOT_PLUGIN_PKG,
          message: `检测到插件目录但缺少插件元数据，无法确认安装状态。若为手动插件，请在 openclaw.json 的 plugins.allow 中加入 openclaw-qqbot；否则请清理 ${unverified.path} 后重试`,
        };
      }

      return {
        success: true,
        installed: false,
        verified: false,
        state: "missing",
        version: "",
        package: QQBOT_PLUGIN_PKG,
      };
    }

    const pkg = readJSON(proofFilePath);
    return {
      success: true,
      installed: true,
      verified: true,
      state: "installed",
      version: pkg?.version || "unknown",
      package: QQBOT_PLUGIN_PKG,
    };
  }

  async function installQqbotPlugin() {
    if (qqbotPluginInstalling) {
      throw new Error("QQ 插件安装中，请稍后重试");
    }

    const preStatus = await getQqbotPluginStatus();
    if (preStatus.state === "installed") {
      return {
        success: true,
        message: "QQ 插件已安装",
        version: preStatus.version,
        package: preStatus.package,
      };
    }
    if (preStatus.state === "unverified") {
      throw new Error(preStatus.message || "QQ 插件目录异常，请清理后重试");
    }

    qqbotPluginInstalling = true;
    const installCmd = `${OC_BIN_PATH} plugins install ${QQBOT_PLUGIN_PKG}@latest`;

    try {
      await execCommand(installCmd, {
        timeout: 600000,
        env: {
          HOME: "/root",
          OPENCLAW_CONFIG_PATH: CONFIG_FILE,
          NODE_BIN,
          OC_BIN_PATH,
          PATH: `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`,
        },
      });

      const status = await getQqbotPluginStatus();
      if (!status.installed) {
        throw new Error("插件安装完成但未检测到安装结果");
      }

      return {
        success: true,
        message: "QQ 插件安装成功",
        version: status.version,
        package: status.package,
      };
    } catch (err) {
      const rawError = err?.stderr || err?.message || "QQ 插件安装失败";
      const isAllowError = rawError.includes("plugins.allow is empty");
      const status = await getQqbotPluginStatus();
      if (status.installed && !isAllowError) {
        return {
          success: true,
          message: "QQ 插件已安装",
          version: status.version,
          package: status.package,
        };
      }

      let errorMessage = rawError;
      if (isAllowError) {
        errorMessage =
          "QQ 插件安装被拒绝：请在 openclaw.json 的 plugins.allow 中加入 openclaw-qqbot";
      } else if (
        errorMessage.includes("plugin already exists") ||
        errorMessage.includes("already exists")
      ) {
        if (status.state === "unverified") {
          errorMessage = status.message || errorMessage;
        }
      }
      console.error("[qqbot-plugin] install failed:", errorMessage);
      throw new Error(errorMessage);
    } finally {
      qqbotPluginInstalling = false;
    }
  }

  function getWecomPluginProofFilePath() {
    const baseDirs = [
      path.join(TRIM_PKGVAR, "node_modules", "@wecom", "wecom-openclaw-plugin"),
      path.join(OC_HOME, "plugins", "@wecom", "wecom-openclaw-plugin"),
      path.join(TRIM_PKGVAR, "plugins", "@wecom", "wecom-openclaw-plugin"),
      path.join(OC_HOME, "extensions", "wecom-openclaw-plugin"),
    ];
    const proofFiles = ["package.json", "openclaw.plugin.json", "plugin.json"];

    for (const baseDir of baseDirs) {
      for (const proofFile of proofFiles) {
        const candidate = path.join(baseDir, proofFile);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return "";
  }

  function getWecomPluginUnverifiedInfo() {
    const extensionDir = path.join(
      OC_HOME,
      "extensions",
      "wecom-openclaw-plugin",
    );
    if (!fs.existsSync(extensionDir)) {
      return { exists: false, path: extensionDir };
    }

    const indexCandidates = [
      path.join(extensionDir, "index.js"),
      path.join(extensionDir, "index.ts"),
      path.join(extensionDir, "dist", "index.js"),
    ];

    const hasIndex = indexCandidates.some((candidate) =>
      fs.existsSync(candidate),
    );

    return { exists: true, path: extensionDir, hasIndex };
  }

  async function getWecomPluginStatus() {
    const proofFilePath = getWecomPluginProofFilePath();
    if (!proofFilePath) {
      const unverified = getWecomPluginUnverifiedInfo();
      if (unverified.exists) {
        return {
          success: true,
          installed: false,
          verified: false,
          state: "unverified",
          version: "",
          package: WECOM_PLUGIN_PKG,
          message: `检测到插件目录但缺少插件元数据，无法确认安装状态。若为手动插件，请在 openclaw.json 的 plugins.allow 中加入 wecom-openclaw-plugin；否则请清理 ${unverified.path} 后重试`,
        };
      }

      return {
        success: true,
        installed: false,
        verified: false,
        state: "missing",
        version: "",
        package: WECOM_PLUGIN_PKG,
      };
    }

    const pkg = readJSON(proofFilePath);
    return {
      success: true,
      installed: true,
      verified: true,
      state: "installed",
      version: pkg?.version || "unknown",
      package: WECOM_PLUGIN_PKG,
    };
  }

  async function installWecomPlugin() {
    if (wecomPluginInstalling) {
      throw new Error("企业微信插件安装中，请稍后重试");
    }

    const preStatus = await getWecomPluginStatus();
    if (preStatus.state === "installed") {
      return {
        success: true,
        message: "企业微信插件已安装",
        version: preStatus.version,
        package: preStatus.package,
      };
    }
    if (preStatus.state === "unverified") {
      throw new Error(preStatus.message || "企业微信插件目录异常，请清理后重试");
    }

    wecomPluginInstalling = true;
    const installCmd = `${OC_BIN_PATH} plugins install ${WECOM_PLUGIN_PKG}`;

    try {
      await execCommand(installCmd, {
        timeout: 600000,
        env: {
          HOME: "/root",
          OPENCLAW_CONFIG_PATH: CONFIG_FILE,
          NODE_BIN,
          OC_BIN_PATH,
          PATH: `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`,
        },
      });

      const status = await getWecomPluginStatus();
      if (!status.installed) {
        throw new Error("插件安装完成但未检测到安装结果");
      }

      return {
        success: true,
        message: "企业微信插件安装成功",
        version: status.version,
        package: status.package,
      };
    } catch (err) {
      const rawError = err?.stderr || err?.message || "企业微信插件安装失败";
      const isAllowError = rawError.includes("plugins.allow is empty");
      const status = await getWecomPluginStatus();
      if (status.installed && !isAllowError) {
        return {
          success: true,
          message: "企业微信插件已安装",
          version: status.version,
          package: status.package,
        };
      }

      let errorMessage = rawError;
      if (isAllowError) {
        errorMessage =
          "企业微信插件安装被拒绝：请在 openclaw.json 的 plugins.allow 中加入 wecom-openclaw-plugin";
      } else if (
        errorMessage.includes("plugin already exists") ||
        errorMessage.includes("already exists")
      ) {
        if (status.state === "unverified") {
          errorMessage = status.message || errorMessage;
        }
      }
      console.error("[wecom-plugin] install failed:", errorMessage);
      throw new Error(errorMessage);
    } finally {
      wecomPluginInstalling = false;
    }
  }

  return {
    getQqbotPluginStatus,
    installQqbotPlugin,
    getWecomPluginStatus,
    installWecomPlugin,
  };
}

module.exports = {
  createPluginService,
};
