function createModelTestService(deps) {
  const { execCommand } = deps;

  function normalizeBaseUrl(baseUrl, protocol) {
    // Remove trailing slashes
    let normalized = baseUrl.replace(/\/+$/, '');

    // Remove common path suffixes to prevent duplication
    if (protocol === 'anthropic') {
      // Remove /v1 if present
      normalized = normalized.replace(/\/v1$/, '');
    } else {
      // For OpenAI-compatible APIs, remove /v1 or /chat/completions
      normalized = normalized.replace(/\/chat\/completions$/, '');
      normalized = normalized.replace(/\/v1$/, '');
    }

    return normalized;
  }

  function buildCurlCommand(config) {
    const { providerName, modelId, baseUrl, apiKey, apiProtocol } = config;
    const protocol = (apiProtocol || providerName).toLowerCase();
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl, protocol);

    if (protocol === "anthropic") {
      const url = `${normalizedBaseUrl}/v1/messages`;
      const data = JSON.stringify({
        model: modelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      });
      return `curl -X POST '${url}' -H 'x-api-key: ${apiKey}' -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' -d '${data}' --max-time 5`;
    } else {
      const url = `${normalizedBaseUrl}/chat/completions`;
      const data = JSON.stringify({
        model: modelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      });
      return `curl -X POST '${url}' -H 'Authorization: Bearer ${apiKey}' -H 'Content-Type: application/json' -d '${data}' --max-time 5`;
    }
  }

  function maskApiKey(curlCommand) {
    return curlCommand.replace(
      /(Bearer |x-api-key: )([a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]*/g,
      "$1$2..."
    );
  }

  async function testModel(config) {
    const curlCommand = buildCurlCommand(config);
    const maskedCommand = maskApiKey(curlCommand);

    // Extract actual endpoint URL from config
    const protocol = (config.apiProtocol || config.providerName).toLowerCase();
    const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl, protocol);
    const endpoint = protocol === "anthropic"
      ? `${normalizedBaseUrl}/v1/messages`
      : `${normalizedBaseUrl}/chat/completions`;

    try {
      const response = await execCommand(curlCommand, { timeout: 5000 });

      let success = false;
      try {
        const json = JSON.parse(response);
        if (protocol === "anthropic") {
          success = json.content && Array.isArray(json.content);
        } else {
          success = json.choices && Array.isArray(json.choices);
        }
      } catch (e) {
        success = false;
      }

      return {
        success,
        endpoint,
        curlCommand: maskedCommand,
        response,
      };
    } catch (err) {
      return {
        success: false,
        endpoint,
        curlCommand: maskedCommand,
        response: err.stderr || err.message || String(err),
      };
    }
  }

  return { testModel };
}

module.exports = { createModelTestService };
