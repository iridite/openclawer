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
