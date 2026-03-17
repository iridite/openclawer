const http = require("http");
const https = require("https");
const { URL } = require("url");

function createModelTestService() {
  function normalizeBaseUrl(baseUrl, protocol) {
    const raw = String(baseUrl || "").trim();
    if (!raw) return "";

    // Remove trailing slashes
    let normalized = raw.replace(/\/+$/, "");

    // Remove common path suffixes to prevent duplication
    if (protocol === "anthropic") {
      // Remove /v1 if present
      normalized = normalized.replace(/\/v1$/, "");
    } else {
      // For OpenAI-compatible APIs, remove /v1 or /chat/completions
      normalized = normalized.replace(/\/chat\/completions$/, "");
      normalized = normalized.replace(/\/v1$/, "");
    }

    return normalized;
  }

  function buildRequest(config) {
    const { providerName, modelId, baseUrl, apiKey, apiProtocol } = config;
    const protocol = String(apiProtocol || providerName || "openai").toLowerCase();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl, protocol);

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
          "x-api-key": String(apiKey || ""),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      };
    }

    const endpoint = `${normalizedBaseUrl}/chat/completions`;
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
        Authorization: `Bearer ${String(apiKey || "")}`,
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

  function requestJson(endpoint, method, headers, payload, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
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
            });
          });
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("请求超时"));
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  async function testModel(config) {
    const request = buildRequest(config);
    const maskedCommand = buildMaskedCurlPreview(request);
    const { endpoint, protocol, headers, payload } = request;

    try {
      const result = await requestJson(endpoint, "POST", headers, payload, 5000);

      let success = false;
      try {
        const json = JSON.parse(result.body);
        if (protocol === "anthropic") {
          success = !!(result.statusCode >= 200 && result.statusCode < 300 && json.content && Array.isArray(json.content));
        } else {
          success = !!(result.statusCode >= 200 && result.statusCode < 300 && json.choices && Array.isArray(json.choices));
        }
      } catch (e) {
        success = false;
      }

      return {
        success,
        endpoint,
        curlCommand: maskedCommand,
        response: result.body,
      };
    } catch (err) {
      return {
        success: false,
        endpoint,
        curlCommand: maskedCommand,
        response: err?.message || String(err),
      };
    }
  }

  return { testModel };
}

module.exports = { createModelTestService };
