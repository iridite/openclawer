// Shared API client implementation for Management UI

(function attachManagementApiClient(global) {
  function isLikelyPolicyBlock(text) {
    const raw = String(text || "").trim().toLowerCase();
    if (!raw) return false;
    return (
      raw.includes("policy") ||
      raw.includes("blocked") ||
      raw.includes("block") ||
      raw.includes("forbidden") ||
      raw.includes("access denied") ||
      raw.includes("denied by") ||
      raw.includes("security rule") ||
      raw.includes("waf") ||
      raw.includes("拦截") ||
      raw.includes("策略") ||
      raw.includes("阻断") ||
      raw.includes("禁止") ||
      raw.includes("拒绝")
    );
  }

  function build502ErrorMessage(endpoint, detail = "") {
    const apiPath = API_BASE + endpoint;
    const normalizedDetail = String(detail || "").trim();
    const shortDetail = normalizedDetail
      ? normalizedDetail.replace(/\s+/g, " ").slice(0, 240)
      : "";

    if (isLikelyPolicyBlock(shortDetail)) {
      return [
        `接口请求被策略拦截（HTTP 502）：${apiPath}`,
        "这通常不是参数格式问题，而是回源链路中的安全策略/WAF 拒绝了请求。",
        "排查建议：",
        "1. 检查 fnOS/反向代理安全策略，确认未拦截 /api 路径",
        "2. 在 WebUI「系统 -> 管理访问」确认当前访问来源被允许",
        "3. 检查反向代理是否正确回源到 18790（含 Host/Origin 转发）",
        shortDetail ? `上游返回：${shortDetail}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      `管理接口返回 502（Bad Gateway）：${apiPath}`,
      "这通常表示管理 API 未就绪，或反向代理到 18790 的回源异常。",
      "排查建议：",
      "1. 确认 oc-deploy 服务正在运行，且 18790 端口可达",
      "2. 检查反向代理 upstream 配置与健康检查",
      "3. 查看日志 /var/apps/oc-deploy/var/info.log",
      shortDetail ? `上游返回：${shortDetail}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function buildApiErrorMessage(endpoint, response, data = {}, fallbackText = "") {
    if (response.status === 502) {
      const detail = data?.error || data?.message || fallbackText || "";
      return build502ErrorMessage(endpoint, detail);
    }

    const baseMessage = String(
      data?.error || data?.message || fallbackText || "请求失败",
    ).trim() || "请求失败";
    const apiCode = String(data?.code || "").trim();
    const hint = apiCode ? `\n错误码: ${apiCode}` : "";

    if (response.status === 400) {
      return `${baseMessage}${hint}`;
    }

    if (response.status === 403) {
      return [
        baseMessage,
        "当前访问被管理访问策略拒绝。",
        "请检查 WebUI 的「系统 -> 管理访问」是否允许远程访问，或改用 fnOS 默认中继/已配置的反向代理入口。",
        apiCode ? `错误码: ${apiCode}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (response.status === 404) {
      return [
        baseMessage,
        "请求目标不存在，可能已被删除，或当前版本未提供该接口。",
        `接口路径: ${API_BASE + endpoint}`,
        apiCode ? `错误码: ${apiCode}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (response.status === 409) {
      return [
        baseMessage,
        "当前状态与执行条件冲突。通常是配置文件缺失、目标已变化，或需要先完成前置步骤。",
        apiCode ? `错误码: ${apiCode}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      `请求失败（HTTP ${response.status}）`,
      baseMessage,
      apiCode ? `错误码: ${apiCode}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function parseApiResponse(endpoint, response) {
    const responseText = await response.text();
    let data = {};

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (parseErr) {
        const trimmed = responseText.trim();
        if (!response.ok) {
          const briefBody = trimmed ? trimmed.slice(0, 240) : "空响应体";
          throw new Error(buildApiErrorMessage(endpoint, response, {}, briefBody));
        }
        throw new Error(
          `接口返回格式错误：预期 JSON，实际收到非 JSON 内容（${API_BASE + endpoint}）`,
        );
      }
    }

    if (!response.ok) {
      throw new Error(buildApiErrorMessage(endpoint, response, data));
    }

    return data;
  }

  function isNetworkRequestError(error) {
    const errorMessage = String(error?.message || "");
    const lowerMsg = errorMessage.toLowerCase();
    return (
      error?.name === "TypeError" ||
      lowerMsg.includes("fetch") ||
      lowerMsg.includes("load failed") ||
      lowerMsg.includes("failed to fetch") ||
      lowerMsg.includes("networkerror")
    );
  }

  function buildNetworkErrorMessage(endpoint, error) {
    const detail = String(error?.message || "网络请求异常");
    return `无法连接管理接口（${API_BASE + endpoint}）。请检查管理服务是否在线、浏览器网络/证书与反向代理配置。原始错误: ${detail}`;
  }

  async function performApiFetch(endpoint, fetchOptions, logLabel) {
    try {
      return await fetch(API_BASE + endpoint, fetchOptions);
    } catch (error) {
      console.error(`${logLabel}失败:`, error);
      if (isNetworkRequestError(error)) {
        throw new Error(buildNetworkErrorMessage(endpoint, error));
      }
      throw error;
    }
  }

  async function apiRequest(endpoint, options = {}) {
    const maxRetries = options.retries || 2;
    const retryDelay = options.retryDelay || 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await performApiFetch(endpoint, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
        }, "API 请求");
        return await parseApiResponse(endpoint, response);
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const isNetworkError = isNetworkRequestError(error);

        if (!isLastAttempt && isNetworkError) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
          continue;
        }

        throw error;
      }
    }
  }

  async function apiFormRequest(endpoint, options = {}) {
    const { formData, headers = {}, ...rest } = options;
    if (!(formData instanceof FormData)) {
      throw new Error("formData 必须是 FormData 实例");
    }

    const response = await performApiFetch(endpoint, {
      ...rest,
      headers,
      body: formData,
    }, "API 表单请求");
    return parseApiResponse(endpoint, response);
  }

  async function apiDownloadRequest(endpoint, options = {}) {
    const response = await performApiFetch(endpoint, {
      method: "GET",
      cache: "no-store",
      ...options,
    }, "API 下载请求");

    if (!response.ok) {
      await parseApiResponse(endpoint, response);
    }

    return response;
  }

  global.managementApiClient = {
    apiRequest,
    apiFormRequest,
    apiDownloadRequest,
  };
})(window);
