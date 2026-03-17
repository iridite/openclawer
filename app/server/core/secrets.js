const fs = require("fs");
const path = require("path");

const OC_DEPLOY_SECRET_PROVIDER = "ocDeployFile";
const OC_DEPLOY_SECRETS_FILENAME = "oc-deploy-secrets.json";

function isObjectLike(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function escapeJsonPointerToken(token) {
  return String(token || "")
    .replace(/~/g, "~0")
    .replace(/\//g, "~1");
}

function unescapeJsonPointerToken(token) {
  return String(token || "")
    .replace(/~1/g, "/")
    .replace(/~0/g, "~");
}

function getJsonPointerValue(data, pointer) {
  if (!isObjectLike(data) || typeof pointer !== "string" || !pointer.startsWith("/")) {
    return undefined;
  }
  const segments = pointer
    .slice(1)
    .split("/")
    .map(unescapeJsonPointerToken);

  let current = data;
  for (const segment of segments) {
    if (!isObjectLike(current) && !Array.isArray(current)) {
      return undefined;
    }
    if (!(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    // Ignore permission errors on systems that do not support chmod
  }
}

function isSecretRef(value) {
  return isObjectLike(value) && typeof value.source === "string" && typeof value.id === "string";
}

function isEnvSecretRef(value) {
  return isSecretRef(value) && String(value.source).toLowerCase() === "env";
}

function isFileSecretRef(value) {
  return isSecretRef(value) && String(value.source).toLowerCase() === "file";
}

function inferApiKeyStorageMode(value) {
  if (typeof value === "string") {
    return "plaintext";
  }
  if (isObjectLike(value) && typeof value.env === "string") {
    return "env";
  }
  if (isObjectLike(value) && typeof value.file === "string") {
    return "file-direct";
  }
  if (isEnvSecretRef(value)) {
    return "env";
  }
  if (isFileSecretRef(value)) {
    return "managed-file";
  }
  return "managed-file";
}

function ensureSecretsObject(config) {
  config.secrets = isObjectLike(config.secrets) ? config.secrets : {};
  config.secrets.providers = isObjectLike(config.secrets.providers)
    ? config.secrets.providers
    : {};
  config.secrets.defaults = isObjectLike(config.secrets.defaults)
    ? config.secrets.defaults
    : {};
}

function ensureEnvSecretProvider(config, providerName = "default") {
  ensureSecretsObject(config);
  if (!isObjectLike(config.secrets.providers[providerName])) {
    config.secrets.providers[providerName] = { source: "env" };
  } else if (!config.secrets.providers[providerName].source) {
    config.secrets.providers[providerName].source = "env";
  }
  if (!config.secrets.defaults.env) {
    config.secrets.defaults.env = providerName;
  }
}

function ensureManagedFileSecretProvider(
  config,
  secretFilePath,
  providerName = OC_DEPLOY_SECRET_PROVIDER,
) {
  ensureSecretsObject(config);
  config.secrets.providers[providerName] = {
    source: "file",
    path: secretFilePath,
    mode: "json",
    timeoutMs: 5000,
  };
  if (!config.secrets.defaults.file) {
    config.secrets.defaults.file = providerName;
  }
}

function buildEnvSecretRef(envVar, providerName = "default") {
  return {
    source: "env",
    provider: providerName,
    id: String(envVar || "").trim(),
  };
}

function buildManagedFileSecretRef(
  providerName,
  fileProvider = OC_DEPLOY_SECRET_PROVIDER,
) {
  const escapedProvider = escapeJsonPointerToken(providerName);
  return {
    source: "file",
    provider: fileProvider,
    id: `/providers/${escapedProvider}/apiKey`,
  };
}

function setManagedProviderApiKey(options) {
  const {
    config,
    providerName,
    apiKey,
    secretFilePath,
    fileProvider = OC_DEPLOY_SECRET_PROVIDER,
  } = options;

  const payload = readJsonFile(secretFilePath) || {};
  if (!isObjectLike(payload.providers)) {
    payload.providers = {};
  }
  if (!isObjectLike(payload.providers[providerName])) {
    payload.providers[providerName] = {};
  }
  payload.providers[providerName].apiKey = String(apiKey || "");
  payload.updatedAt = new Date().toISOString();

  writeJsonFile(secretFilePath, payload);
  ensureManagedFileSecretProvider(config, secretFilePath, fileProvider);

  return buildManagedFileSecretRef(providerName, fileProvider);
}

function removeManagedProviderApiKey(options) {
  const { providerName, secretFilePath } = options;
  const payload = readJsonFile(secretFilePath);
  if (!payload || !isObjectLike(payload.providers) || !payload.providers[providerName]) {
    return false;
  }
  delete payload.providers[providerName];
  payload.updatedAt = new Date().toISOString();
  writeJsonFile(secretFilePath, payload);
  return true;
}

function resolveFileProviderConfig(config, providerName) {
  const providers = config?.secrets?.providers;
  if (!isObjectLike(providers)) {
    return null;
  }
  const resolvedName = providerName || config?.secrets?.defaults?.file || "";
  const provider = providers[resolvedName];
  if (!isObjectLike(provider)) {
    return null;
  }
  if (String(provider.source || "").toLowerCase() !== "file") {
    return null;
  }
  return provider;
}

function resolveSecretRefValue(secretRef, config, envVars = process.env) {
  if (!isObjectLike(secretRef)) {
    return "";
  }

  // Compatibility format: { env: "OPENAI_API_KEY" }
  if (typeof secretRef.env === "string") {
    const envName = secretRef.env.trim();
    return envName ? String(envVars[envName] || "") : "";
  }

  // Compatibility format: { file: "/path/to/secret.txt" }
  if (typeof secretRef.file === "string") {
    const filePath = secretRef.file.trim();
    if (!filePath) return "";
    try {
      return fs.readFileSync(filePath, "utf8").trim();
    } catch (err) {
      return "";
    }
  }

  if (!isSecretRef(secretRef)) {
    return "";
  }

  const source = String(secretRef.source || "").toLowerCase();
  if (source === "env") {
    const envName = String(secretRef.id || "").trim();
    return envName ? String(envVars[envName] || "") : "";
  }

  if (source === "file") {
    const providerConfig = resolveFileProviderConfig(config, secretRef.provider);
    if (!providerConfig || typeof providerConfig.path !== "string") {
      return "";
    }
    const filePath = providerConfig.path.trim();
    if (!filePath) return "";

    const mode = String(providerConfig.mode || "json").toLowerCase();
    if (mode === "json") {
      const payload = readJsonFile(filePath);
      const value = getJsonPointerValue(payload, String(secretRef.id || ""));
      return value === undefined || value === null ? "" : String(value);
    }

    try {
      return fs.readFileSync(filePath, "utf8").trim();
    } catch (err) {
      return "";
    }
  }

  return "";
}

function resolveProviderApiKeyValue(providerConfig, fullConfig, envVars = process.env) {
  const apiKey = providerConfig?.apiKey;
  if (typeof apiKey === "string") {
    return apiKey.trim();
  }
  if (isObjectLike(apiKey)) {
    return resolveSecretRefValue(apiKey, fullConfig, envVars);
  }
  return "";
}

module.exports = {
  OC_DEPLOY_SECRET_PROVIDER,
  OC_DEPLOY_SECRETS_FILENAME,
  isSecretRef,
  isEnvSecretRef,
  isFileSecretRef,
  inferApiKeyStorageMode,
  ensureEnvSecretProvider,
  ensureManagedFileSecretProvider,
  buildEnvSecretRef,
  buildManagedFileSecretRef,
  setManagedProviderApiKey,
  removeManagedProviderApiKey,
  resolveSecretRefValue,
  resolveProviderApiKeyValue,
};
