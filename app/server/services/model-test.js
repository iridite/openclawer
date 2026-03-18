const http = require("http");
const https = require("https");
const { URL } = require("url");
const { badRequestError, conflictError } = require("../core/http-errors");
const {
  resolveProviderApiKeyValue,
  resolveSecretRefValue,
} = require("../core/secrets");

function isObjectLike(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStorageMode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw === "file-direct" ? "managed-file" : raw;
}

function isSecretRefStorageMode(mode) {
  return mode === "managed-file" || mode === "env";
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!isObjectLike(value)) {
    return value;
  }
  const sorted = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sorted[key] = sortJsonValue(value[key]);
    });
  return sorted;
}

function isJsonEqual(left, right) {
  try {
    return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
  } catch (err) {
    return false;
  }
}

function createModelTestService(options = {}) {
  const { CONFIG_FILE, readJSON, isApiKeyProtectionEnabled } = options;

  function loadCurrentConfig() {
    if (!CONFIG_FILE || typeof readJSON !== "function") {
      return null;
    }
    const config = readJSON(CONFIG_FILE);
    return config && typeof config === "object" ? config : null;
  }

  function isApiProtectionOn() {
    return (
      typeof isApiKeyProtectionEnabled === "function" &&
      isApiKeyProtectionEnabled() === true
    );
  }

  function resolveApiKey(config, currentConfig) {
    const directApiKey = String(config?.apiKey || "").trim();
    if (directApiKey) {
      return directApiKey;
    }

    const activeConfig = currentConfig || loadCurrentConfig();
    if (!activeConfig) {
      return "";
    }

    if (isObjectLike(config?.apiKeyRef)) {
      const value = resolveSecretRefValue(config.apiKeyRef, activeConfig, process.env);
      if (value) {
        return value;
      }
    }

    const providerName = String(config?.providerName || "").trim();
    if (!providerName) {
      return "";
    }

    const provider = activeConfig?.models?.providers?.[providerName];
    return resolveProviderApiKeyValue(provider, activeConfig, process.env);
  }

  function resolveIncomingApiKeyRef(config, storageMode) {
    if (isObjectLike(config?.apiKeyRef)) {
      return config.apiKeyRef;
    }

    if (storageMode === "env") {
      const envVar = String(config?.apiKeyEnvVar || "").trim();
      if (envVar) {
        return {
          source: "env",
          provider: "default",
          id: envVar,
        };
      }
    }

    return null;
  }

  function canReuseLegacySecretRef(config, storageMode, currentConfig) {
    if (!currentConfig || !isSecretRefStorageMode(storageMode)) {
      return false;
    }

    const providerName = String(config?.providerName || "").trim();
    if (!providerName) {
      return false;
    }

    const existingProviderRef = currentConfig?.models?.providers?.[providerName]?.apiKey;
    if (!isObjectLike(existingProviderRef)) {
      return false;
    }

    const incomingRef = resolveIncomingApiKeyRef(config, storageMode);
    if (!isObjectLike(incomingRef)) {
      return false;
    }

    return isJsonEqual(existingProviderRef, incomingRef);
  }

  function validateTestConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw badRequestError("请求体必须是 JSON 对象");
    }

    const modelId = String(config.modelId || "").trim();
    const providerName = String(config.providerName || "").trim();
    const baseUrl = String(config.baseUrl || "").trim();
    if (!modelId || !providerName || !baseUrl) {
      throw badRequestError("请先填写所有必填字段（模型ID、供应商、Base URL）");
    }

    const modelIdPattern = /^[a-zA-Z0-9._/:-]+$/;
    if (!modelIdPattern.test(modelId)) {
      throw badRequestError(
        "模型 ID 只能包含字母、数字、点号(.)、斜杠(/)、冒号(:)、连字符(-)和下划线(_)",
      );
    }
    const providerPattern = /^[a-z-]+$/;
    if (!providerPattern.test(providerName)) {
      throw badRequestError("供应商名称只能包含小写英文字符(a-z)和连字符(-)");
    }

    const requestedMode = normalizeStorageMode(config.apiKeyStorageMode);
    const mode =
      requestedMode ||
      (isObjectLike(config.apiKeyRef)
        ? "managed-file"
        : "");
    if (
      mode &&
      mode !== "plaintext" &&
      mode !== "managed-file" &&
      mode !== "env"
    ) {
      throw badRequestError(`不支持的 API Key 存储方式: ${mode}`);
    }

    if (mode === "env") {
      const envVarName = String(config.apiKeyEnvVar || "").trim();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(envVarName)) {
        throw badRequestError("环境变量名不合法（示例：OPENAI_API_KEY）");
      }
    }

    const currentConfig = loadCurrentConfig();
    if (!isApiProtectionOn() && isSecretRefStorageMode(mode)) {
      const canKeepLegacyRef = canReuseLegacySecretRef(
        config,
        mode,
        currentConfig,
      );
      if (!canKeepLegacyRef) {
        throw conflictError(
          "当前未开启 API 防护，不能使用 SecretRef 方式测试。请改用明文，或先到“系统”启用 API 防护。",
        );
      }
    }

    return {
      currentConfig,
    };
  }

  function normalizeBaseUrl(baseUrl, protocol) {
    const raw = String(baseUrl || "").trim();
    if (!raw) return "";

    // Remove trailing slashes
    let normalized = raw.replace(/\/+$/, "");

    // Remove common path suffixes to prevent duplication
    if (protocol === "anthropic") {
      normalized = normalized.replace(/\/v1\/messages$/i, "");
      normalized = normalized.replace(/\/v1$/i, "");
    } else {
      // OpenAI-compatible APIs usually keep /v1 in base URL.
      normalized = normalized.replace(/\/chat\/completions$/i, "");
      normalized = normalized.replace(/\/responses$/i, "");
    }

    return normalized;
  }

  function resolveOpenAiEndpointSuffix(apiType) {
    const type = String(apiType || "").trim().toLowerCase();
    if (type === "openai-responses" || type === "openai-codex-responses") {
      return "/responses";
    }
    return "/chat/completions";
  }

  function buildRequest(config, currentConfig) {
    const {
      providerName,
      modelId,
      baseUrl,
      apiProtocol,
      apiType,
    } = config;
    const protocol = String(apiProtocol || providerName || "openai").toLowerCase();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl, protocol);
    const resolvedApiKey = resolveApiKey(config, currentConfig);

    if (protocol === "anthropic") {
      const endpoint = `${normalizedBaseUrl}/v1/messages`;
      const payload = {
        model: modelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      };
      return {
        endpoint,
        protocol,
        payload,
        headers: {
          "x-api-key": String(resolvedApiKey || ""),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      };
    }

    const endpointSuffix = resolveOpenAiEndpointSuffix(apiType);
    const endpoint = `${normalizedBaseUrl}${endpointSuffix}`;
    const payload =
      endpointSuffix === "/responses"
        ? {
            model: modelId,
            input: "test",
            max_output_tokens: 10,
          }
        : {
            model: modelId,
            max_tokens: 10,
            messages: [{ role: "user", content: "test" }],
          };
    return {
      endpoint,
      protocol,
      endpointSuffix,
      payload,
      headers: {
        Authorization: `Bearer ${String(resolvedApiKey || "")}`,
        "Content-Type": "application/json",
      },
    };
  }

  function maskApiKey(value) {
    const raw = String(value || "");
    if (!raw) return "";
    if (raw.length <= 8) return "****";
    return `${raw.slice(0, 8)}...`;
  }

  function buildMaskedCurlPreview(request) {
    const { endpoint, protocol, headers, payload } = request;
    const payloadText = JSON.stringify(payload);

    if (protocol === "anthropic") {
      return (
        `curl -X POST '${endpoint}' ` +
        `-H 'x-api-key: ${maskApiKey(headers["x-api-key"])}' ` +
        `-H 'anthropic-version: 2023-06-01' ` +
        `-H 'Content-Type: application/json' ` +
        `-d '${payloadText}' --max-time 5`
      );
    }

    return (
      `curl -X POST '${endpoint}' ` +
      `-H 'Authorization: Bearer ${maskApiKey(String(headers.Authorization || "").replace(/^Bearer\s+/i, ""))}' ` +
      `-H 'Content-Type: application/json' ` +
      `-d '${payloadText}' --max-time 5`
    );
  }

  function buildMaskedRuntimeHeaders(headers = {}) {
    const masked = { ...headers };
    if (typeof masked.Authorization === "string") {
      const token = masked.Authorization.replace(/^Bearer\s+/i, "");
      masked.Authorization = `Bearer ${maskApiKey(token)}`;
    }
    if (typeof masked["x-api-key"] === "string") {
      masked["x-api-key"] = maskApiKey(masked["x-api-key"]);
    }
    return masked;
  }

  function buildRuntimeRequestDebug(request, timeoutMs = 5000) {
    const endpoint = String(request?.endpoint || "").trim();
    if (!endpoint) {
      return {};
    }

    let target;
    try {
      target = new URL(endpoint);
    } catch (err) {
      return {
        endpoint,
        note: "endpoint parse failed",
      };
    }

    const method = "POST";
    const payloadText = JSON.stringify(request.payload || {});
    const defaultPort = target.protocol === "https:" ? 443 : 80;
    const port = target.port ? parseInt(target.port, 10) : defaultPort;
    const requestHeaders = {
      ...request.headers,
      "Content-Length": Buffer.byteLength(payloadText),
    };

    return {
      transport: target.protocol === "https:" ? "https.request" : "http.request",
      endpoint,
      requestOptions: {
        protocol: target.protocol,
        hostname: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method,
        timeoutMs,
      },
      headers: buildMaskedRuntimeHeaders(requestHeaders),
      bodyBytes: Buffer.byteLength(payloadText),
      bodyPreview: payloadText,
    };
  }

  function requestJson(endpoint, method, headers, payload, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let target;
      try {
        target = new URL(endpoint);
      } catch (err) {
        reject(new Error(`无效的 URL: ${endpoint}`));
        return;
      }

      const client = target.protocol === "https:" ? https : http;
      const body = JSON.stringify(payload);
      const req = client.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          method,
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              statusCode: res.statusCode || 0,
              body: text,
              headers: res.headers || {},
              durationMs: Date.now() - startedAt,
            });
          });
        },
      );

      req.setTimeout(timeoutMs, () => {
        const timeoutErr = new Error("请求超时");
        timeoutErr.code = "ETIMEDOUT";
        timeoutErr.durationMs = Date.now() - startedAt;
        req.destroy(timeoutErr);
      });

      req.on("error", (err) => {
        if (typeof err.durationMs !== "number") {
          err.durationMs = Date.now() - startedAt;
        }
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  function buildPreparedTestContext(config, timeoutMs = 5000) {
    const validation = validateTestConfig(config);
    const request = buildRequest(config, validation.currentConfig);
    const maskedCommand = buildMaskedCurlPreview(request);
    const runtimeDebug = buildRuntimeRequestDebug(request, timeoutMs);

    return {
      request,
      preview: {
        success: true,
        endpoint: request.endpoint,
        curlCommand: maskedCommand,
        runtime: runtimeDebug,
      },
    };
  }

  async function prepareModelTest(config) {
    const { preview } = buildPreparedTestContext(config, 5000);
    return preview;
  }

  async function testModel(config) {
    const { request, preview } = buildPreparedTestContext(config, 5000);
    const { endpoint, protocol, endpointSuffix, headers, payload } = request;

    try {
      const result = await requestJson(endpoint, "POST", headers, payload, 5000);

      let success = false;
      try {
        const json = JSON.parse(result.body);
        const statusOk = result.statusCode >= 200 && result.statusCode < 300;
        if (protocol === "anthropic") {
          success = !!(statusOk && json.content && Array.isArray(json.content));
        } else if (endpointSuffix === "/responses") {
          success = !!(
            statusOk &&
            (
              Array.isArray(json.output) ||
              typeof json.output_text === "string" ||
              typeof json.id === "string"
            )
          );
        } else {
          success = !!(statusOk && json.choices && Array.isArray(json.choices));
        }
      } catch (e) {
        success = false;
      }

      return {
        success,
        endpoint,
        curlCommand: preview.curlCommand,
        response: result.body,
        runtime: {
          ...preview.runtime,
          statusCode: result.statusCode,
          durationMs: result.durationMs,
          responseBytes: Buffer.byteLength(String(result.body || ""), "utf8"),
        },
      };
    } catch (err) {
      return {
        success: false,
        endpoint,
        curlCommand: preview.curlCommand,
        response: err?.message || String(err),
        runtime: {
          ...preview.runtime,
          statusCode: 0,
          durationMs: typeof err?.durationMs === "number" ? err.durationMs : null,
          responseBytes: 0,
          errorCode: String(err?.code || "").trim(),
        },
      };
    }
  }

  return { prepareModelTest, testModel };
}

module.exports = { createModelTestService };
