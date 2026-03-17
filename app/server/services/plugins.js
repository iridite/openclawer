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
    restartGateway,
  } = options;

  const PLUGINS = {
    qqbot: {
      pkg: "@tencent-connect/openclaw-qqbot",
      name: "QQ Bot",
      channelId: "qqbot",
      allowKey: "openclaw-qqbot",
      runtimeDirs: [
        ["plugins", "@tencent-connect", "openclaw-qqbot"],
        ["plugins", "openclaw-qqbot"],
        ["extensions", "openclaw-qqbot"],
      ],
      nodeModuleDirs: [
        ["node_modules", "@tencent-connect", "openclaw-qqbot"],
      ],
    },
    wecom: {
      pkg: "@wecom/wecom-openclaw-plugin",
      name: "企业微信",
      channelId: "wecom",
      allowKey: "wecom-openclaw-plugin",
      runtimeDirs: [
        ["plugins", "@wecom", "wecom-openclaw-plugin"],
        ["plugins", "wecom-openclaw-plugin"],
        ["extensions", "wecom-openclaw-plugin"],
      ],
      nodeModuleDirs: [
        ["node_modules", "@wecom", "wecom-openclaw-plugin"],
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
      if (scopeDirName === "plugins" || scopeDirName === "extensions") {
        return [OC_HOME, TRIM_PKGVAR];
      }
      if (scopeDirName === "node_modules") {
        return [TRIM_PKGVAR, OC_HOME];
      }
      return [OC_HOME, TRIM_PKGVAR];
    }

    function getCandidateDirs(dirGroups) {
      const dirs = [];
      const seen = new Set();
      for (const dirParts of dirGroups) {
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
      const runtimeCandidates = getCandidateDirs(plugin.runtimeDirs || []);
      const nodeModuleCandidates = getCandidateDirs(plugin.nodeModuleDirs || []);
      const weakHits = [];

      function inspectCandidate(pluginDir) {
        if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
          return null;
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

        return {
          installed: false,
          verified: false,
          weak: true,
          pluginDir,
          hasManifestFile,
          manifestParsed,
          hasExpectedChannel,
          manifestPath: manifestInfo?.filePath || "",
          manifestChannelIds,
        };
      }

      for (const pluginDir of runtimeCandidates) {
        const inspected = inspectCandidate(pluginDir);
        if (!inspected) {
          continue;
        }
        if (inspected.installed) {
          return inspected;
        }
        weakHits.push(inspected);
      }

      // 仅存在于 node_modules 的插件不能视为运行时“已安装可用”。
      for (const pluginDir of nodeModuleCandidates) {
        const inspected = inspectCandidate(pluginDir);
        if (!inspected) {
          continue;
        }
        if (inspected.installed) {
          return {
            installed: false,
            verified: false,
            state: "unverified",
            version: inspected.version || "",
            package: plugin.pkg,
            message:
              `${plugin.name} 仅检测到 node_modules 安装（${pluginDir}），` +
              "运行时可能无法加载。请点击安装按钮执行插件安装流程。",
          };
        }
        weakHits.push(inspected);
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
      const allowance = inspectPluginAllowance(config, manifestId);
      return allowance.enabled;
    }

    function getCanonicalAllowEntries(manifestId) {
      const entries = [plugin.pkg];
      const trimmedManifestId = String(manifestId || "").trim();
      if (trimmedManifestId && trimmedManifestId !== plugin.pkg) {
        entries.push(trimmedManifestId);
      }
      return entries;
    }

    function getLegacyAllowEntries(manifestId) {
      const legacy = [plugin.allowKey, plugin.channelId];
      const trimmedManifestId = String(manifestId || "").trim();
      if (trimmedManifestId && trimmedManifestId !== plugin.pkg) {
        return legacy.filter((item) => item && item !== trimmedManifestId);
      }
      return legacy;
    }

    function inspectPluginAllowance(config, manifestId) {
      const pluginsConfig =
        config && typeof config === "object" && !Array.isArray(config)
          ? config.plugins
          : null;
      if (pluginsConfig && pluginsConfig.enabled === false) {
        return {
          enabled: false,
          requiresMigration: false,
        };
      }

      if (!pluginsConfig || pluginsConfig.allow === undefined) {
        return {
          enabled: true,
          requiresMigration: false,
        };
      }

      const allowList = normalizeStringList(pluginsConfig.allow);
      if (allowList.includes("*")) {
        return {
          enabled: true,
          requiresMigration: false,
        };
      }

      const canonicalEntries = new Set(getCanonicalAllowEntries(manifestId));
      const legacyEntries = new Set(getLegacyAllowEntries(manifestId));
      const hasCanonicalEntry = allowList.some((item) => canonicalEntries.has(item));
      const hasLegacyEntry = allowList.some((item) => legacyEntries.has(item));

      return {
        enabled: hasCanonicalEntry,
        requiresMigration: !hasCanonicalEntry && hasLegacyEntry,
      };
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
      const entries = getCanonicalAllowEntries(manifestId);
      const legacyEntries = new Set(getLegacyAllowEntries(manifestId));

      let changed = false;
      for (const legacyEntry of legacyEntries) {
        if (allowSet.delete(legacyEntry)) {
          changed = true;
        }
      }

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

    function shQuote(value) {
      return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
    }

    function buildInstallCommands() {
      const commands = [];
      const envPrefix =
        `env OPENCLAW_CONFIG_PATH=${shQuote(CONFIG_FILE)} ` +
        `HOME=${shQuote(path.dirname(OC_HOME))}`;
      if (OC_BIN_PATH) {
        commands.push(
          {
            strategy: "oc-bin-path",
            command:
              `cd ${shQuote(TRIM_PKGVAR)} && ${envPrefix} ${shQuote(OC_BIN_PATH)} plugins install ${shQuote(plugin.pkg)}`,
          },
        );
      }
      commands.push(
        {
          strategy: "openclaw-cli",
          command:
            `cd ${shQuote(TRIM_PKGVAR)} && ${envPrefix} openclaw plugins install ${shQuote(plugin.pkg)}`,
        },
      );
      commands.push(
        {
          strategy: "npm-fallback",
          command: `cd ${shQuote(TRIM_PKGVAR)} && npm install ${shQuote(plugin.pkg)}`,
        },
      );
      return commands;
    }

    async function installPluginPackage() {
      const installCommands = buildInstallCommands();
      let lastError = null;
      for (const candidate of installCommands) {
        try {
          await execCommand(candidate.command, { timeout: 180000 });
          return {
            strategy: candidate.strategy,
          };
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error(`${plugin.name} 插件安装命令执行失败`);
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
      const allowance = inspectPluginAllowance(config, inspected.manifestId);
      const enabled = allowance.enabled;
      if (!enabled) {
        return {
          success: true,
          installed: true,
          verified: true,
          enabled: false,
          state: "disabled",
          version: inspected.version,
          package: plugin.pkg,
          message: allowance.requiresMigration
            ? `${plugin.name} 插件已安装，但当前配置仍使用旧插件键。点击安装按钮将自动修复并重启 Gateway。`
            : `${plugin.name} 插件已安装但未启用，点击安装按钮将自动启用并重启 Gateway。`,
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
      if (preStatus.state === "disabled") {
        const inspected = inspectInstalledPlugin();
        const enabledResult = ensurePluginEnabled(inspected.manifestId || "");
        let restarted = false;
        if (typeof restartGateway === "function") {
          const restartResult = await restartGateway();
          restarted = restartResult?.success === true;
        }
        const refreshed = await getStatus();
        return {
          success: true,
          message: enabledResult.changed
            ? `${plugin.name}插件已启用${restarted ? "，并已重启 Gateway" : ""}`
            : `${plugin.name}插件已处于启用状态${restarted ? "，并已重启 Gateway" : ""}`,
          version: refreshed.version || preStatus.version || "unknown",
          package: preStatus.package || plugin.pkg,
          restarted,
        };
      }
      installing[pluginKey] = true;
      try {
        const installMeta = await installPluginPackage();
        const inspected = inspectInstalledPlugin();
        if (inspected.state !== "installed") {
          throw new Error(
            `${plugin.name}插件安装后仍未通过运行时校验。` +
              "请检查 openclaw 插件安装路径与日志。",
          );
        }
        ensurePluginEnabled(inspected.manifestId || "");
        let restarted = false;
        if (typeof restartGateway === "function") {
          const restartResult = await restartGateway();
          restarted = restartResult?.success === true;
        }
        const postStatus = await getStatus();
        return {
          success: true,
          message: `${plugin.name}插件安装成功${restarted ? "，并已重启 Gateway" : ""}`,
          version: postStatus.version,
          package: postStatus.package,
          restarted,
          installStrategy: installMeta?.strategy || "",
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
