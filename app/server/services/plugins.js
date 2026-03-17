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
    writeJSON,
    execCommand,
  } = options;

  const PLUGINS = {
    qqbot: {
      pkg: "@tencent-connect/openclaw-qqbot",
      name: "QQ Bot",
      channelId: "qqbot",
      allowKey: "openclaw-qqbot",
      dirs: [
        ["node_modules", "@tencent-connect", "openclaw-qqbot"],
        ["plugins", "@tencent-connect", "openclaw-qqbot"],
        ["extensions", "openclaw-qqbot"],
      ],
    },
    wecom: {
      pkg: "@wecom/wecom-openclaw-plugin",
      name: "企业微信",
      channelId: "wecom",
      allowKey: "wecom-openclaw-plugin",
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
    const MANIFEST_FILES = ["openclaw.plugin.json", "plugin.json"];

    function normalizeStringList(value) {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0);
    }

    function collectSearchRoots(scopeDirName) {
      if (scopeDirName === "node_modules") {
        return [TRIM_PKGVAR, OC_HOME];
      }
      if (scopeDirName === "plugins" || scopeDirName === "extensions") {
        return [OC_HOME, TRIM_PKGVAR];
      }
      return [OC_HOME, TRIM_PKGVAR];
    }

    function getCandidateDirs() {
      const dirs = [];
      const seen = new Set();
      for (const dirParts of plugin.dirs) {
        const scopeDirName = String(dirParts[0] || "");
        const roots = collectSearchRoots(scopeDirName);
        for (const root of roots) {
          const candidate = path.join(root, ...dirParts);
          if (!seen.has(candidate)) {
            dirs.push(candidate);
            seen.add(candidate);
          }
        }
      }
      return dirs;
    }

    function readJsonFile(filePath) {
      if (!filePath || !fs.existsSync(filePath)) {
        return null;
      }
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (err) {
        return null;
      }
    }

    function findManifestInfo(pluginDir) {
      for (const fileName of MANIFEST_FILES) {
        const filePath = path.join(pluginDir, fileName);
        if (!fs.existsSync(filePath)) continue;
        const manifest = readJsonFile(filePath);
        return {
          filePath,
          manifest,
          parsed: !!manifest,
        };
      }
      return null;
    }

    function extractManifestChannelIds(manifest) {
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return [];
      }
      const ids = new Set();
      const channels = manifest.channels;
      if (Array.isArray(channels)) {
        for (const item of channels) {
          if (typeof item === "string" && item.trim()) {
            ids.add(item.trim());
            continue;
          }
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
          }
          const directId = String(item.id || item.channelId || "").trim();
          if (directId) {
            ids.add(directId);
          }
        }
      } else if (channels && typeof channels === "object") {
        for (const [key, value] of Object.entries(channels)) {
          const trimmedKey = String(key || "").trim();
          if (trimmedKey) {
            ids.add(trimmedKey);
          }
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
          }
          const directId = String(value.id || value.channelId || "").trim();
          if (directId) {
            ids.add(directId);
          }
        }
      }
      return Array.from(ids);
    }

    function inspectInstalledPlugin() {
      const candidates = getCandidateDirs();
      const weakHits = [];

      for (const pluginDir of candidates) {
        if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
          continue;
        }

        const pkgPath = path.join(pluginDir, "package.json");
        const pkg = readJsonFile(pkgPath);
        const manifestInfo = findManifestInfo(pluginDir);
        const hasManifestFile = !!manifestInfo;
        const manifest = manifestInfo?.manifest || null;
        const manifestParsed = manifestInfo?.parsed === true;
        const manifestChannelIds = extractManifestChannelIds(manifest);
        const hasExpectedChannel = manifestChannelIds.includes(plugin.channelId);

        if (hasManifestFile && manifestParsed && hasExpectedChannel) {
          const manifestId = String(manifest?.id || "").trim();
          return {
            installed: true,
            verified: true,
            state: "installed",
            version: String(pkg?.version || manifest?.version || "unknown"),
            package: plugin.pkg,
            pluginDir,
            manifestId,
            manifestPath: manifestInfo.filePath,
          };
        }

        weakHits.push({
          pluginDir,
          hasManifestFile,
          manifestParsed,
          hasExpectedChannel,
          manifestPath: manifestInfo?.filePath || "",
          manifestChannelIds,
        });
      }

      if (weakHits.length > 0) {
        const first = weakHits[0];
        let message = `检测到 ${plugin.name} 插件目录，但未发现可用的渠道声明（期望 channel: ${plugin.channelId}）。`;
        if (!first.hasManifestFile) {
          message += " 缺少 openclaw.plugin.json/plugin.json。";
        } else if (!first.manifestParsed) {
          message += " 插件 manifest 解析失败。";
        } else if (!first.hasExpectedChannel) {
          const declared = first.manifestChannelIds.length > 0
            ? first.manifestChannelIds.join(", ")
            : "无";
          message += ` manifest 未声明该渠道（当前声明: ${declared}）。`;
        }
        message += ` 请重新安装插件后重试（目录: ${first.pluginDir}）。`;
        return {
          installed: false,
          verified: false,
          state: "unverified",
          version: "",
          package: plugin.pkg,
          message,
        };
      }

      return {
        installed: false,
        verified: false,
        state: "missing",
        version: "",
        package: plugin.pkg,
      };
    }

    function isPluginEnabled(config, manifestId) {
      const pluginsConfig =
        config && typeof config === "object" && !Array.isArray(config)
          ? config.plugins
          : null;
      if (pluginsConfig && pluginsConfig.enabled === false) {
        return false;
      }

      if (!pluginsConfig || pluginsConfig.allow === undefined) {
        return true;
      }

      const allowList = normalizeStringList(pluginsConfig.allow);
      if (allowList.includes("*")) {
        return true;
      }

      const acceptedKeys = new Set([plugin.allowKey, plugin.pkg, plugin.channelId]);
      const trimmedManifestId = String(manifestId || "").trim();
      if (trimmedManifestId) {
        acceptedKeys.add(trimmedManifestId);
      }

      return allowList.some((item) => acceptedKeys.has(item));
    }

    function ensurePluginEnabled(manifestId) {
      if (typeof readJSON !== "function" || typeof writeJSON !== "function") {
        throw new Error("插件启用失败：配置读写能力不可用");
      }
      const config = readJSON(CONFIG_FILE) || {};
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("插件启用失败：配置文件结构无效");
      }

      if (!config.plugins || typeof config.plugins !== "object" || Array.isArray(config.plugins)) {
        config.plugins = {};
      }
      const enabledChanged = config.plugins.enabled === false;
      config.plugins.enabled = true;

      if (!Array.isArray(config.plugins.allow)) {
        config.plugins.allow = [];
      }
      const allowList = normalizeStringList(config.plugins.allow);
      const allowSet = new Set(allowList);

      const entries = [plugin.allowKey];
      const trimmedManifestId = String(manifestId || "").trim();
      if (trimmedManifestId) {
        entries.push(trimmedManifestId);
      }

      let changed = false;
      for (const entry of entries) {
        if (!entry || allowSet.has(entry)) continue;
        allowSet.add(entry);
        changed = true;
      }

      if (!changed && !enabledChanged) {
        return { changed: false };
      }

      config.plugins.allow = Array.from(allowSet);
      const ok = writeJSON(CONFIG_FILE, config);
      if (!ok) {
        throw new Error("插件启用失败：写入配置文件失败");
      }
      return { changed: true };
    }

    async function getStatus() {
      const inspected = inspectInstalledPlugin();
      if (inspected.state !== "installed") {
        return {
          success: true,
          ...inspected,
        };
      }

      const config = typeof readJSON === "function" ? (readJSON(CONFIG_FILE) || {}) : {};
      const enabled = isPluginEnabled(config, inspected.manifestId);
      if (!enabled) {
        return {
          success: true,
          installed: true,
          verified: true,
          enabled: false,
          state: "disabled",
          version: inspected.version,
          package: plugin.pkg,
          message: `${plugin.name} 插件已安装但未启用，点击安装按钮将自动启用。`,
        };
      }

      return {
        success: true,
        installed: true,
        verified: true,
        enabled: true,
        state: "installed",
        version: inspected.version,
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
      if (preStatus.state === "disabled") {
        const inspected = inspectInstalledPlugin();
        const enabledResult = ensurePluginEnabled(inspected.manifestId || "");
        const refreshed = await getStatus();
        return {
          success: true,
          message: enabledResult.changed
            ? `${plugin.name}插件已启用`
            : `${plugin.name}插件已处于启用状态`,
          version: refreshed.version || preStatus.version || "unknown",
          package: preStatus.package || plugin.pkg,
        };
      }
      installing[pluginKey] = true;
      try {
        await execCommand(`cd ${TRIM_PKGVAR} && npm install ${plugin.pkg}`, {
          timeout: 120000,
        });
        const inspected = inspectInstalledPlugin();
        if (inspected.state !== "installed") {
          throw new Error(`${plugin.name}插件安装后校验失败，请重试或检查安装日志`);
        }
        ensurePluginEnabled(inspected.manifestId || "");
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
