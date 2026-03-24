const fs = require("fs");
const path = require("path");
const {
  AppError,
  conflictError,
  badGatewayError,
  isAppError,
} = require("../core/http-errors");

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
      channelAliases: ["qqbot"],
      runtimeDirs: [
        ["plugins", "@tencent-connect", "openclaw-qqbot"],
        ["plugins", "openclaw-qqbot"],
        ["extensions", "@tencent-connect", "openclaw-qqbot"],
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
      channelAliases: ["wecom", "wecom-bot", "workwechat"],
      runtimeDirs: [
        ["plugins", "@wecom", "wecom-openclaw-plugin"],
        ["plugins", "wecom-openclaw-plugin"],
        ["extensions", "@wecom", "wecom-openclaw-plugin"],
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
    const MANIFEST_FILES = ["openclaw.plugin.json", "openclaw-plugin.json", "plugin.json"];
    const MANIFEST_DIRS = ["", "dist"];

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
      let firstInvalid = null;
      for (const relDir of MANIFEST_DIRS) {
        for (const fileName of MANIFEST_FILES) {
          const filePath = relDir
            ? path.join(pluginDir, relDir, fileName)
            : path.join(pluginDir, fileName);
          if (!fs.existsSync(filePath)) continue;
          const manifest = readJsonFile(filePath);
          if (manifest) {
            return {
              filePath,
              manifest,
              parsed: true,
            };
          }
          if (!firstInvalid) {
            firstInvalid = {
              filePath,
              manifest: null,
              parsed: false,
            };
          }
        }
      }
      return firstInvalid;
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

    function extractPackageChannelIds(pkg) {
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
        return [];
      }
      const ids = new Set();
      const openclawMeta = pkg.openclaw;
      const pluginMeta = pkg.openclawPlugin;

      function collectChannels(raw) {
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const id = String(item || "").trim();
            if (id) ids.add(id);
          }
        } else if (raw && typeof raw === "object") {
          for (const key of Object.keys(raw)) {
            const id = String(key || "").trim();
            if (id) ids.add(id);
          }
        } else if (typeof raw === "string") {
          const id = raw.trim();
          if (id) ids.add(id);
        }
      }

      if (openclawMeta && typeof openclawMeta === "object" && !Array.isArray(openclawMeta)) {
        collectChannels(openclawMeta.channels);
      }
      if (pluginMeta && typeof pluginMeta === "object" && !Array.isArray(pluginMeta)) {
        collectChannels(pluginMeta.channels);
      }
      return Array.from(ids);
    }

    function normalizeId(value) {
      return String(value || "").trim().toLowerCase();
    }

    function hasExpectedChannelId(channelIds) {
      const expected = new Set(
        [plugin.channelId, ...(plugin.channelAliases || [])]
          .map(normalizeId)
          .filter(Boolean),
      );
      if (expected.size === 0) {
        return false;
      }
      return channelIds.some((id) => expected.has(normalizeId(id)));
    }

    function resolvePreferredAllowEntry(manifestId) {
      const trimmedManifestId = String(manifestId || "").trim();
      if (
        trimmedManifestId &&
        trimmedManifestId !== plugin.pkg &&
        trimmedManifestId !== plugin.channelId
      ) {
        return trimmedManifestId;
      }
      return plugin.allowKey;
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
        const packageChannelIds = extractPackageChannelIds(pkg);
        const allChannelIds = Array.from(new Set([...manifestChannelIds, ...packageChannelIds]));
        const hasExpectedChannel = hasExpectedChannelId(allChannelIds);

        if (hasExpectedChannel) {
          const manifestId = String(manifest?.id || pkg?.name || "").trim();
          return {
            installed: true,
            verified: true,
            state: "installed",
            version: String(pkg?.version || manifest?.version || "unknown"),
            package: plugin.pkg,
            pluginDir,
            manifestId,
            manifestPath: manifestInfo?.filePath || "",
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
          manifestChannelIds: allChannelIds,
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
          message += " 缺少 openclaw.plugin.json/openclaw-plugin.json/plugin.json（含 dist 目录）。";
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
      const preferredEntry = resolvePreferredAllowEntry(manifestId);
      return Array.from(
        new Set(
          [preferredEntry, plugin.allowKey]
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        ),
      );
    }

    function getLegacyAllowEntries(manifestId) {
      const legacy = [plugin.pkg, plugin.channelId];
      const trimmedManifestId = String(manifestId || "").trim();
      const preferredEntry = resolvePreferredAllowEntry(manifestId);
      if (
        trimmedManifestId &&
        trimmedManifestId !== preferredEntry
      ) {
        legacy.push(trimmedManifestId);
      }
      return Array.from(new Set(legacy.filter((item) => String(item || "").trim())));
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
        throw new AppError("插件启用失败：配置读写能力不可用", {
          statusCode: 500,
          code: "internal_error",
        });
      }
      const config = readJSON(CONFIG_FILE) || {};
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw conflictError("插件启用失败：配置文件结构无效");
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
        throw conflictError("插件启用失败：写入配置文件失败");
      }
      return { changed: true };
    }

    function shQuote(value) {
      return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
    }

    function buildInstallCommands() {
      const commands = [];
      const homeDir = path.dirname(OC_HOME);
      const npmCliPath = NODE_BIN_DIR ? path.join(NODE_BIN_DIR, "npm") : "";
      const hasNodeBoundNpm = Boolean(NODE_BIN && npmCliPath && fs.existsSync(npmCliPath));
      const npmCmd = hasNodeBoundNpm
        ? `${shQuote(NODE_BIN)} ${shQuote(npmCliPath)}`
        : "npm";

      // 强制 HTTPS registry，并禁用全局 Git rewrite，避免 https 被 insteadOf 改写成 ssh。
      const commonInstallEnv =
        `env OPENCLAW_CONFIG_PATH=${shQuote(CONFIG_FILE)} ` +
        `HOME=${shQuote(homeDir)} ` +
        `PATH=${shQuote(`${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH || ""}`)} ` +
        "GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null " +
        "NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false";

      const registryInstallVariants = [
        {
          strategy: "openclaw-cli-mirror",
          registry: "https://registry.npmmirror.com",
        },
        {
          strategy: "openclaw-cli-npmjs",
          registry: "https://registry.npmjs.org",
        },
      ];

      if (OC_BIN_PATH) {
        for (const variant of registryInstallVariants) {
          commands.push({
            strategy: `oc-bin-path-${variant.strategy.split("openclaw-cli-")[1]}`,
            command:
              `cd ${shQuote(TRIM_PKGVAR)} && ${commonInstallEnv} ` +
              `NPM_CONFIG_REGISTRY=${shQuote(variant.registry)} ` +
              `${shQuote(OC_BIN_PATH)} plugins install ${shQuote(plugin.pkg)}`,
          });
        }
      }

      for (const variant of registryInstallVariants) {
        commands.push({
          strategy: variant.strategy,
          command:
            `cd ${shQuote(TRIM_PKGVAR)} && ${commonInstallEnv} ` +
            `NPM_CONFIG_REGISTRY=${shQuote(variant.registry)} ` +
            `openclaw plugins install ${shQuote(plugin.pkg)}`,
        });
      }

      // 最后兜底：直接 npm 安装到 app 运行目录，便于诊断环境问题。
      commands.push({
        strategy: "npm-fallback-mirror",
        command:
          `cd ${shQuote(TRIM_PKGVAR)} && ${commonInstallEnv} ` +
          "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com " +
          `${npmCmd} install ${shQuote(plugin.pkg)}`,
      });
      commands.push({
        strategy: "npm-fallback-npmjs",
        command:
          `cd ${shQuote(TRIM_PKGVAR)} && ${commonInstallEnv} ` +
          "NPM_CONFIG_REGISTRY=https://registry.npmjs.org " +
          `${npmCmd} install ${shQuote(plugin.pkg)}`,
      });

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

    async function waitForInstalledState(maxAttempts = 5, delayMs = 600) {
      let last = inspectInstalledPlugin();
      for (let i = 0; i < maxAttempts; i += 1) {
        if (last.state === "installed") {
          return last;
        }
        if (i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          last = inspectInstalledPlugin();
        }
      }
      return last;
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
        throw conflictError(`${plugin.name}插件安装中，请稍后重试`);
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
        const inspected = await waitForInstalledState(5, 600);
        if (inspected.state !== "installed") {
          const runtimeHint = inspected?.message ? ` 详情: ${inspected.message}` : "";
          throw badGatewayError(
            `${plugin.name}插件安装后仍未通过运行时校验。` +
              `请在 NAS 运行环境检查 openclaw 插件安装路径与日志。${runtimeHint}`,
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
      } catch (err) {
        if (isAppError(err)) {
          throw err;
        }
        const rawMessage = String(err?.stderr || err?.message || "未知错误");
        const lowerMessage = rawMessage.toLowerCase();
        const sshKeyError =
          lowerMessage.includes("permission denied (publickey)") ||
          lowerMessage.includes("git@github.com") ||
          lowerMessage.includes("could not read from remote repository") ||
          lowerMessage.includes("ssh") ||
          lowerMessage.includes("git+ssh");
        const registryHint = sshKeyError
          ? "检测到 Git SSH 拉取失败。已优先尝试 HTTPS registry 安装；若仍失败，请检查系统全局 git 的 url.insteadOf 配置，避免将 https://github.com 改写为 git@github.com。"
          : "";
        const details = {
          stderr: rawMessage,
          hint: registryHint,
        };
        throw badGatewayError(
          `${plugin.name}插件安装失败: ${rawMessage}${registryHint ? `；${registryHint}` : ""}`,
          details,
        );
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
