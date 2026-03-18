const path = require("path");

const DEFAULT_TRUSTED_PROXIES = Object.freeze(["10.0.0.1", "127.0.0.1", "::1"]);
const DEFAULT_ALLOWED_ORIGINS = Object.freeze(["*"]);

function isObjectLike(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function resolveGatewayPort(value) {
  const parsed = parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 18789;
}

function resolveOcHome(ocHome) {
  const resolved = String(ocHome || "").trim();
  return resolved || "/root/.openclaw";
}

function buildManagedConfigPatch(options = {}) {
  const gatewayPort = resolveGatewayPort(options.gatewayPort);
  const allowedPlugins = normalizeStringList(options.allowedPlugins);
  const preservedToken = String(options.preservedToken || "").trim();
  const ocHome = resolveOcHome(options.ocHome);

  const patch = {
    agents: {
      defaults: {
        workspace: path.join(ocHome, "workspace"),
        compaction: {
          mode: "safeguard",
        },
      },
    },
    plugins: {
      enabled: true,
      allow: allowedPlugins,
    },
    gateway: {
      port: gatewayPort,
      mode: "local",
      bind: "lan",
      controlUi: {
        allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
        dangerouslyAllowHostHeaderOriginFallback: true,
        allowInsecureAuth: true,
        dangerouslyDisableDeviceAuth: true,
      },
      auth: {
        mode: "token",
      },
      trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
      reload: {
        mode: "hybrid",
        debounceMs: 300,
      },
    },
  };

  if (preservedToken) {
    patch.gateway.auth.token = preservedToken;
  }

  return patch;
}

function applyManagedConfigPatch(config, options = {}) {
  const nextConfig = isObjectLike(config) ? config : {};
  const patch = buildManagedConfigPatch(options);

  nextConfig.agents = isObjectLike(nextConfig.agents) ? nextConfig.agents : {};
  nextConfig.agents.defaults = isObjectLike(nextConfig.agents.defaults)
    ? nextConfig.agents.defaults
    : {};
  nextConfig.agents.defaults.workspace = patch.agents.defaults.workspace;
  nextConfig.agents.defaults.compaction = patch.agents.defaults.compaction;

  nextConfig.plugins = isObjectLike(nextConfig.plugins) ? nextConfig.plugins : {};
  nextConfig.plugins.enabled = patch.plugins.enabled;
  nextConfig.plugins.allow = patch.plugins.allow;

  nextConfig.gateway = isObjectLike(nextConfig.gateway) ? nextConfig.gateway : {};
  nextConfig.gateway.port = patch.gateway.port;
  nextConfig.gateway.mode = patch.gateway.mode;
  nextConfig.gateway.bind = patch.gateway.bind;
  nextConfig.gateway.trustedProxies = patch.gateway.trustedProxies;

  nextConfig.gateway.auth = isObjectLike(nextConfig.gateway.auth)
    ? nextConfig.gateway.auth
    : {};
  nextConfig.gateway.auth.mode = patch.gateway.auth.mode;
  if (patch.gateway.auth.token) {
    nextConfig.gateway.auth.token = patch.gateway.auth.token;
  }

  nextConfig.gateway.controlUi = isObjectLike(nextConfig.gateway.controlUi)
    ? nextConfig.gateway.controlUi
    : {};
  Object.assign(nextConfig.gateway.controlUi, patch.gateway.controlUi);

  nextConfig.gateway.reload = isObjectLike(nextConfig.gateway.reload)
    ? nextConfig.gateway.reload
    : {};
  Object.assign(nextConfig.gateway.reload, patch.gateway.reload);

  return nextConfig;
}

function buildDefaultConfig(options = {}) {
  const timestamp = String(options.timestamp || new Date().toISOString());
  const lastTouchedVersion = String(options.lastTouchedVersion || "").trim() || "unknown";
  const config = {
    meta: {
      lastTouchedVersion,
      lastTouchedAt: timestamp,
    },
    tools: {
      profile: "full",
      allow: [],
    },
    commands: {
      native: "auto",
      nativeSkills: "auto",
      restart: true,
      ownerDisplay: "raw",
    },
  };

  return applyManagedConfigPatch(config, options);
}

module.exports = {
  buildManagedConfigPatch,
  applyManagedConfigPatch,
  buildDefaultConfig,
};
