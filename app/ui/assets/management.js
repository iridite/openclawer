// OpenClaw Management Console JavaScript

// ============================================================================
// Ace Editor 动态加载
// ============================================================================

const ACE_SCRIPT_TIMEOUT_MS = 4000;

// 动态加载 Ace Editor
async function loadAceEditor() {
  if (aceEditorLoaded) {
    return true;
  }

  if (aceEditorLoading) {
    // 等待加载完成
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (aceEditorLoaded || !aceEditorLoading) {
          clearInterval(checkInterval);
          resolve(aceEditorLoaded);
        }
      }, 100);
    });
  }

  aceEditorLoading = true;

  try {
    // 优先尝试本地资源；本地不存在时再退回 CDN。
    await loadScriptCandidates([
      "assets/vendor/ace/ace.js",
      "https://cdn.bootcdn.net/ajax/libs/ace/1.32.2/ace.js",
    ]);

    // 加载 JSON 模式和主题
    await Promise.all([
      loadScriptCandidates([
        "assets/vendor/ace/mode-json.js",
        "https://cdn.bootcdn.net/ajax/libs/ace/1.32.2/mode-json.js",
      ]),
      loadScriptCandidates([
        "assets/vendor/ace/theme-monokai.js",
        "https://cdn.bootcdn.net/ajax/libs/ace/1.32.2/theme-monokai.js",
      ]),
    ]);

    aceEditorLoaded = true;
    console.log("Ace Editor 加载成功");
    return true;
  } catch (error) {
    console.error("Ace Editor 加载失败:", error);
    aceEditorLoaded = false;
    return false;
  } finally {
    aceEditorLoading = false;
  }
}

async function loadScriptCandidates(candidates) {
  let lastError = null;
  for (const src of candidates) {
    try {
      await loadScript(src);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("脚本加载失败");
}

// 加载单个脚本
function loadScript(src, timeoutMs = ACE_SCRIPT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && existing.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      script.onload = null;
      script.onerror = null;
    };

    script.onload = () => {
      script.dataset.loaded = "true";
      cleanup();
      resolve();
    };
    script.onerror = () => {
      cleanup();
      script.remove();
      reject(new Error(`脚本加载失败: ${src}`));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      script.remove();
      reject(new Error(`脚本加载超时: ${src}`));
    }, timeoutMs);

    document.head.appendChild(script);
  });
}

// 初始化 Ace Editor 实例
function initAceEditorInstance() {
  const editorElement = document.getElementById("config-editor-ace");
  if (!editorElement || typeof ace === "undefined") {
    return false;
  }

  aceEditor = ace.edit("config-editor-ace");
  aceEditor.setTheme("ace/theme/monokai");
  aceEditor.session.setMode("ace/mode/json");
  aceEditor.setOptions({
    fontSize: "14px",
    showPrintMargin: false,
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    tabSize: 2,
    useSoftTabs: true,
  });

  // 监听编辑器变化，实时验证
  aceEditor.session.on("change", () => {
    validateConfigInput();
  });

  console.log("Ace Editor 实例初始化成功");
  return true;
}

// ============================================================================
// 工具函数
// ============================================================================

// 显示 Toast 通知
function showToast(message, type = "info") {
  const toast = window.domRefs?.toast || document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

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

// API 请求封装
async function apiRequest(endpoint, options = {}) {
  const maxRetries = options.retries || 2;
  const retryDelay = options.retryDelay || 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(API_BASE + endpoint, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      const responseText = await response.text();
      let data = {};
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          const trimmed = responseText.trim();
          if (!response.ok) {
            if (response.status === 502) {
              throw new Error(build502ErrorMessage(endpoint, trimmed));
            }
            const briefBody = trimmed
              ? trimmed.slice(0, 240)
              : "空响应体";
            throw new Error(
              `请求失败（HTTP ${response.status}），接口返回了非 JSON 内容: ${briefBody}`,
            );
          }
          throw new Error(
            `接口返回格式错误：预期 JSON，实际收到非 JSON 内容（${API_BASE + endpoint}）`,
          );
        }
      }

      if (!response.ok) {
        if (response.status === 502) {
          const detail = data?.error || data?.message || "";
          throw new Error(build502ErrorMessage(endpoint, detail));
        }
        throw new Error(data.error || "请求失败");
      }

      return data;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const errorMessage = String(error?.message || "");
      const lowerMsg = errorMessage.toLowerCase();
      const isNetworkError =
        error?.name === "TypeError" ||
        lowerMsg.includes("fetch") ||
        lowerMsg.includes("load failed") ||
        lowerMsg.includes("failed to fetch") ||
        lowerMsg.includes("networkerror");

      if (!isLastAttempt && isNetworkError) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
        continue;
      }

      console.error("API 请求失败:", error);
      if (isNetworkError) {
        const detail = errorMessage || "网络请求异常";
        throw new Error(
          `无法连接管理接口（${API_BASE + endpoint}）。请检查管理服务是否在线、浏览器网络/证书与反向代理配置。原始错误: ${detail}`,
        );
      }
      throw error;
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getOrCreateTooltipPopup() {
  let popup = document.getElementById("tooltip-popup");
  if (popup) {
    return popup;
  }

  popup = document.createElement("div");
  popup.id = "tooltip-popup";
  popup.className = "tooltip-popup";
  popup.setAttribute("role", "tooltip");
  popup.dataset.placement = "top";
  document.body.appendChild(popup);
  return popup;
}

function positionTooltipPopup(target, popup) {
  if (!target || !popup) return;

  const margin = 8;
  const gap = 10;
  const rect = target.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 以触发图标左侧作为锚点，避免以中点定位导致两侧溢出
  let left = rect.left;
  left = clamp(
    left,
    margin,
    Math.max(margin, viewportWidth - popupRect.width - margin),
  );

  let top = rect.top - popupRect.height - gap;
  let placement = "top";

  if (top < margin) {
    top = rect.bottom + gap;
    placement = "bottom";
  }

  if (top + popupRect.height > viewportHeight - margin) {
    top = Math.max(margin, viewportHeight - popupRect.height - margin);
  }

  const anchorX = clamp(
    rect.left + rect.width / 2,
    left + 12,
    left + popupRect.width - 12,
  );

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
  popup.dataset.placement = placement;
  popup.style.setProperty(
    "--tooltip-arrow-left",
    `${Math.round(anchorX - left)}px`,
  );
}

function showTooltip(target) {
  const text = target?.getAttribute("data-tooltip")?.trim();
  if (!text) return;

  const popup = getOrCreateTooltipPopup();
  popup.textContent = text;
  popup.style.left = "0px";
  popup.style.top = "-9999px";
  popup.classList.add("visible");
  activeTooltipTarget = target;

  requestAnimationFrame(() => {
    positionTooltipPopup(target, popup);
  });
}

function hideTooltip(target = null) {
  if (target && activeTooltipTarget && target !== activeTooltipTarget) {
    return;
  }

  const popup = document.getElementById("tooltip-popup");
  if (popup) {
    popup.classList.remove("visible");
  }
  activeTooltipTarget = null;
}

function refreshTooltipPosition() {
  if (!activeTooltipTarget) return;
  const popup = document.getElementById("tooltip-popup");
  if (!popup || !popup.classList.contains("visible")) return;
  positionTooltipPopup(activeTooltipTarget, popup);
}

function initTooltips() {
  const icons = document.querySelectorAll(".tooltip-icon[data-tooltip]");

  icons.forEach((icon) => {
    if (!icon.hasAttribute("tabindex")) {
      icon.setAttribute("tabindex", "0");
    }
    if (!icon.hasAttribute("aria-label")) {
      icon.setAttribute("aria-label", "查看说明");
    }

    icon.addEventListener("mouseenter", () => showTooltip(icon));
    icon.addEventListener("mouseleave", () => hideTooltip(icon));
    icon.addEventListener("focus", () => showTooltip(icon));
    icon.addEventListener("blur", () => hideTooltip(icon));
    icon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeTooltipTarget === icon) {
        hideTooltip(icon);
      } else {
        showTooltip(icon);
      }
    });
    icon.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (activeTooltipTarget === icon) {
        hideTooltip(icon);
      } else {
        showTooltip(icon);
      }
    });
  });

  window.addEventListener("resize", refreshTooltipPosition);
  document.addEventListener("scroll", refreshTooltipPosition, true);
  document.addEventListener("pointerdown", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) {
      hideTooltip();
      return;
    }

    if (target.closest(".tooltip-icon")) {
      return;
    }

    const popup = document.getElementById("tooltip-popup");
    if (popup && popup.contains(target)) {
      return;
    }

    hideTooltip();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideTooltip();
    }
  });
}

// ============================================================================
// 标签页切换
// ============================================================================

function initTabs() {
  const tabsNav = document.querySelector(".tabs");
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const tabSectionMap = {
    overview: ["tab-dashboard"],
    models: ["tab-config"],
    channels: ["tab-config"],
    config: ["tab-config"],
    skills: ["tab-skills"],
    system: ["tab-version", "tab-console"],
  };

  if (tabsNav) {
    tabsNav.setAttribute("role", "tablist");
    tabsNav.setAttribute("aria-label", "主导航标签");
  }

  tabContents.forEach((content) => {
    content.setAttribute("role", "tabpanel");
    content.setAttribute("hidden", "hidden");
  });

  const switchTab = (tabName, activeBtn) => {
    currentTabName = tabName;

    tabBtns.forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
      b.setAttribute("tabindex", "-1");
    });
    if (activeBtn) {
      activeBtn.classList.add("active");
      activeBtn.setAttribute("aria-selected", "true");
      activeBtn.setAttribute("tabindex", "0");
    }

    tabContents.forEach((content) => {
      content.classList.remove("active");
      content.setAttribute("hidden", "hidden");
    });

    const targetSectionIds = tabSectionMap[tabName] || [];
    targetSectionIds.forEach((sectionId) => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.classList.add("active");
        section.removeAttribute("hidden");
        if (activeBtn?.id) {
          section.setAttribute("aria-labelledby", activeBtn.id);
        }
      }
    });

    loadTabData(tabName);
  };

  tabBtns.forEach((btn, index) => {
    const tabName = btn.dataset.tab || `tab-${index}`;
    const controls = tabSectionMap[tabName]?.[0] || "tab-dashboard";

    btn.setAttribute("role", "tab");
    btn.setAttribute("id", `main-tab-${tabName}`);
    btn.setAttribute("aria-controls", controls);
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("tabindex", "-1");

    btn.addEventListener("click", () => {
      const clickedTabName = btn.dataset.tab;
      switchTab(clickedTabName, btn);
    });

    btn.addEventListener("keydown", (e) => {
      const key = e.key;
      const isPrev = key === "ArrowLeft" || key === "ArrowUp";
      const isNext = key === "ArrowRight" || key === "ArrowDown";

      if (!isPrev && !isNext && key !== "Home" && key !== "End") {
        return;
      }

      e.preventDefault();

      const list = Array.from(tabBtns);
      const currentIndex = list.indexOf(btn);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (key === "Home") {
        nextIndex = 0;
      } else if (key === "End") {
        nextIndex = list.length - 1;
      } else if (isPrev) {
        nextIndex = (currentIndex - 1 + list.length) % list.length;
      } else if (isNext) {
        nextIndex = (currentIndex + 1) % list.length;
      }

      const targetBtn = list[nextIndex];
      if (!targetBtn) return;
      const targetTabName = targetBtn.dataset.tab;
      switchTab(targetTabName, targetBtn);
      targetBtn.focus();
    });
  });

  const initialActiveBtn = document.querySelector(".tab-btn.active");
  const initialTabName = initialActiveBtn?.dataset.tab || "overview";
  switchTab(initialTabName, initialActiveBtn);
}

function setConfigViewMode(mode) {
  const splitView = document.getElementById("config-split-view");
  const modelPanel = document.getElementById("config-model-panel");
  const channelPanel = document.getElementById("config-channel-panel");
  const editorCard = document.getElementById("config-editor-card");
  const templateCard = document.getElementById("config-template-card");

  if (
    !splitView ||
    !modelPanel ||
    !channelPanel ||
    !editorCard ||
    !templateCard
  ) {
    return;
  }

  if (mode === "models") {
    splitView.style.display = "block";
    modelPanel.style.display = "flex";
    channelPanel.style.display = "none";
    editorCard.style.display = "none";
    templateCard.style.display = "none";
    return;
  }

  if (mode === "channels") {
    splitView.style.display = "block";
    modelPanel.style.display = "none";
    channelPanel.style.display = "flex";
    editorCard.style.display = "none";
    templateCard.style.display = "none";
    return;
  }

  // 默认配置视图
  splitView.style.display = "none";
  modelPanel.style.display = "flex";
  channelPanel.style.display = "flex";
  editorCard.style.display = "block";
  templateCard.style.display = "block";
}

function loadTabData(tabName) {
  switch (tabName) {
    case "overview":
      refreshDashboard();
      refreshLogs();
      break;
    case "models":
      setConfigViewMode("models");
      renderQuickAddButtons();
      loadModelsList();
      break;
    case "channels":
      setConfigViewMode("channels");
      loadChannelsList();
      break;
    case "config":
      setConfigViewMode("config");
      loadConfig();
      break;
    case "skills":
      loadInstalledSkills();
      break;
    case "system":
      loadToolProfiles();
      loadManagementAccessSettings();
      loadApiKeyProtectionSettings();
      loadVersionInfo();
      loadConsoleInfo();
      break;
  }
}

// ============================================================================
// 仪表板
// ============================================================================

async function refreshDashboard() {
  try {
    // 并行请求状态和配置数据，日志延迟到控制台标签页加载
    const [status, config] = await Promise.all([
      apiRequest("/status"),
      apiRequest("/config"),
    ]);

    currentStatus = status;

    // 更新状态显示
    updateStatusBadge(status.gateway);

    // 更新仪表板信息
    // Gateway 状态：显示状态 + PID
    const gatewayStatusText =
      status.gateway === "running" ? "运行中" : "已停止";
    const gatewayPidText =
      status.gatewayPid && status.gateway === "running"
        ? ` (PID: ${status.gatewayPid})`
        : "";
    const refs = window.domRefs;
    if (refs?.dash.gatewayStatus) refs.dash.gatewayStatus.textContent =
      gatewayStatusText + gatewayPidText;

    // Proxy 状态：显示状态 + PID
    const proxyStatusText = status.proxy === "running" ? "运行中" : "已停止";
    const proxyPidText = status.proxyPid ? ` (PID: ${status.proxyPid})` : "";
    if (refs?.dash.proxyStatus) refs.dash.proxyStatus.textContent =
      proxyStatusText + proxyPidText;

    if (refs?.dash.version) refs.dash.version.textContent =
      status.version || "unknown";
    if (refs?.dash.configStatus) refs.dash.configStatus.textContent =
      status.configExists ? "已配置" : "未配置";

    // 更新系统资源信息
    if (status.system) {
      if (refs?.dash.cpuUsage) refs.dash.cpuUsage.textContent =
        status.system.cpuUsage !== undefined
          ? `${status.system.cpuUsage.toFixed(1)}%`
          : "N/A";

      // 显示内存使用：百分比 + MB 数值（小字）
      const memoryEl = refs?.dash.memoryUsage || document.getElementById("dash-memory-usage");
      if (
        status.system.memoryPercent !== undefined &&
        status.system.memoryMB !== undefined
      ) {
        memoryEl.innerHTML = `${status.system.memoryPercent.toFixed(1)}% <span style="font-size: 0.8em; color: #888;">(${status.system.memoryMB.toFixed(1)} MB)</span>`;
      } else {
        memoryEl.textContent = "N/A";
      }
    }

    // 更新配置摘要（使用已获取的 config 数据）
    updateConfigSummary(config);
  } catch (error) {
    showToast("加载状态失败: " + error.message, "error");
  }
}

// 更新配置摘要（使用已有的 config 数据，避免重复请求）
function updateConfigSummary(config) {
  try {
    const summaryEl = document.getElementById("config-summary");

    // 正确解析模型：检查 config.models.providers
    const providers = config.models?.providers || {};
    const primaryModel = config.agents?.defaults?.model?.primary || "";
    const modelEntries = [];

    for (const [providerName, provider] of Object.entries(providers)) {
      const models = Array.isArray(provider?.models) ? provider.models : [];
      const baseUrl = provider.baseUrl || provider.baseURL || "";
      const urlHint = baseUrl ? ` - ${baseUrl.split("/")[2] || baseUrl}` : "";

      for (const model of models) {
        const modelId = model?.id || model?.name || model?.model;
        if (!modelId) continue;
        const modelKey = `${providerName}/${modelId}`;
        const isPrimary = modelKey === primaryModel;
        modelEntries.push({ modelKey, urlHint, isPrimary });
      }
    }

    const modelCount = modelEntries.length;
    const channelCount = config.channels
      ? Object.keys(config.channels).length
      : 0;

    let html = `
      <div class="info-grid">
        <div class="info-item">
          <span class="label">AI 模型</span>
          <span class="value">${modelCount} 个</span>
        </div>
        <div class="info-item">
          <span class="label">消息渠道</span>
          <span class="value">${channelCount} 个</span>
        </div>
      </div>
    `;

    // 显示模型详情
    if (modelCount > 0) {
      html +=
        '<div style="margin-top: 15px;"><strong>已配置模型：</strong><ul style="margin: 5px 0; padding-left: 20px;">';
      for (const entry of modelEntries) {
        const activeTag = entry.isPrimary ? ' <span class="primary-badge" style="margin-left: 8px;">主模型</span>' : "";
        html += `<li><code>${entry.modelKey}</code>${entry.urlHint}${activeTag}</li>`;
      }
      html += "</ul></div>";
    } else {
      html += '<div style="margin-top: 15px;"><em>尚未配置 AI 模型</em></div>';
    }

    // 显示渠道详情
    if (channelCount > 0) {
      html +=
        '<div style="margin-top: 10px;"><strong>已配置渠道：</strong><ul style="margin: 5px 0; padding-left: 20px;">';
      for (const [name, channel] of Object.entries(config.channels)) {
        const type = inferChannelType(name, channel);
        const label = getChannelDisplayLabel(type, name);
        const identity = getChannelIdentityValue(type, channel);
        const masked = identity ? maskApiKey(identity) : "未绑定";
        const enabled = channel.enabled !== false ? "已启用" : "已禁用";
        html += `<li><code>${label}</code> (${masked}) ${enabled}</li>`;
      }
      html += "</ul></div>";
    } else {
      html += '<div style="margin-top: 10px;"><em>尚未配置消息渠道</em></div>';
    }

    summaryEl.innerHTML = html;
  } catch (error) {
    document.getElementById("config-summary").innerHTML =
      '<p class="loading">加载失败</p>';
  }
}

async function loadConfigSummary() {
  try {
    const config = await apiRequest("/config");
    updateConfigSummary(config);
  } catch (error) {
    document.getElementById("config-summary").innerHTML =
      '<p class="loading">加载失败</p>';
  }
}

function updateStatusBadge(status) {
  const refs = window.domRefs;
  const badge = refs?.gateway.statusBadge || document.getElementById("gatewayStatus");
  const statusText = badge.querySelector(".status-text");

  badge.className = "status-badge";

  // 获取按钮元素
  const startBtn = refs?.gateway.startBtn || document.getElementById("start-gateway-btn");
  const stopBtn = refs?.gateway.stopBtn || document.getElementById("stop-gateway-btn");

  if (status === "running") {
    badge.classList.add("running");
    statusText.textContent = "运行中";

    // Gateway 运行中：禁用启动按钮，启用停止按钮
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
  } else {
    badge.classList.add("stopped");
    statusText.textContent = "已停止";

    // Gateway 已停止：启用启动按钮，禁用停止按钮
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
}

async function startGateway() {
  if (!confirm("确定要启动 Gateway 吗？")) {
    return;
  }

  try {
    showToast("正在启动 Gateway...", "info");
    await apiRequest("/gateway/start", { method: "POST" });
    showToast("Gateway 启动成功", "success");

    // 等待几秒后刷新状态
    setTimeout(refreshStatus, 3000);
  } catch (error) {
    showToast("启动失败: " + error.message, "error");
  }
}

async function stopGateway() {
  if (!confirm("确定要停止 Gateway 吗？这将中断当前所有连接。")) {
    return;
  }

  try {
    showToast("正在停止 Gateway...", "info");
    await apiRequest("/gateway/stop", { method: "POST" });
    showToast("Gateway 已停止", "success");

    // 等待几秒后刷新状态
    setTimeout(refreshStatus, 2000);
  } catch (error) {
    showToast("停止失败: " + error.message, "error");
  }
}

async function restartGateway() {
  if (!confirm("确定要重启 Gateway 吗？这将中断当前所有连接。")) {
    return;
  }

  try {
    showToast("正在重启 Gateway...", "info");
    await apiRequest("/gateway/restart", { method: "POST" });
    showToast("Gateway 重启成功", "success");

    // 等待几秒后刷新状态
    setTimeout(refreshStatus, 2000);
  } catch (error) {
    showToast("重启失败: " + error.message, "error");
  }
}

async function refreshStatus() {
  showToast("正在刷新状态...", "info");
  await refreshDashboard();
  showToast("状态已刷新", "success");
}

// ============================================================================
// 快速添加模型
// ============================================================================

// 渲染快速添加按钮
function renderQuickAddButtons() {
  const container = document.getElementById("quick-add-grid");
  if (!container) return;

  let html = "";
  for (const [modelId, modelData] of Object.entries(QUICK_ADD_MODELS)) {
    html += `
      <button class="quick-add-btn" data-model-id="${modelId}">
        <span class="model-name">${modelId}</span>
        <span class="provider-name">${modelData.providerName}</span>
      </button>
    `;
  }
  container.innerHTML = html;

  // 添加事件监听器
  container.querySelectorAll(".quick-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modelId = btn.dataset.modelId;
      quickAddModel(modelId);
    });
  });
}

// 从已保存的 API 类型推断协议，用于编辑模型时正确回填协议下拉框
function inferProtocolFromApiType(apiValue) {
  if (!apiValue) return "openai";
  if (apiValue === "anthropic") return "anthropic";
  if (apiValue === "openai") return "openai";
  if (apiValue.startsWith("anthropic-")) return "anthropic";
  if (apiValue.startsWith("openai-")) return "openai";
  return "openai";
}

// 更新 API 类型下拉框选项
function updateApiTypeOptions(protocol) {
  const apiTypeSelect = document.getElementById("api-type");
  if (!apiTypeSelect) return;

  // 清空现有选项
  apiTypeSelect.innerHTML = "";

  // 根据协议获取对应的 API 类型
  let options = [];
  if (protocol === "openai") {
    options = API_TYPES.openai;
  } else if (protocol === "anthropic") {
    options = API_TYPES.anthropic;
  } else {
    // 默认显示所有 OpenAI 选项
    options = API_TYPES.openai;
  }

  // 添加选项并自动选择默认值
  let defaultValue = null;
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    apiTypeSelect.appendChild(option);

    if (opt.default) {
      defaultValue = opt.value;
    }
  });

  // 自动选择默认值
  if (defaultValue) {
    apiTypeSelect.value = defaultValue;
  }
}

// 快速添加模型
async function quickAddModel(modelId) {
  const modelData = QUICK_ADD_MODELS[modelId];
  if (!modelData) {
    showToast("模型预设不存在", "error");
    return;
  }

  // 显示表单并填充数据
  const formCard = document.getElementById("model-form-card");
  const formTitle = document.getElementById("form-title");
  const submitBtnText = document.getElementById("submit-btn-text");

  formCard.style.display = "block";
  formTitle.textContent = `快速添加 ${modelId}`;
  submitBtnText.textContent = "添加新模型";

  // 填充表单
  document.getElementById("edit-model-key").value = "";
  document.getElementById("model-id").value = modelData.modelId;
  document.getElementById("model-id").disabled = false;
  document.getElementById("provider-name").value = modelData.providerName;
  document.getElementById("base-url").value = modelData.baseUrl;
  document.getElementById("api-protocol").value = modelData.apiProtocol;
  const {
    storageSelect,
    envInput,
    keepExistingInput,
    existingRefInput,
  } = getApiKeyStorageElements();
  if (storageSelect) storageSelect.value = getDefaultApiKeyStorageMode();
  if (envInput) envInput.value = "";
  if (keepExistingInput) keepExistingInput.value = "false";
  if (existingRefInput) existingRefInput.value = "";
  handleApiKeyStorageModeChange();

  // 更新 API 类型下拉框并设置值
  updateApiTypeOptions(modelData.apiProtocol);
  if (modelData.apiType) {
    document.getElementById("api-type").value = modelData.apiType;
  }

  // 高级配置
  if (modelData.advanced) {
    const { reasoning, input, contextWindow, maxTokens } = modelData.advanced;

    if (contextWindow) {
      document.getElementById("context-window").value = contextWindow;
    }
    if (maxTokens) {
      document.getElementById("max-tokens").value = maxTokens;
    }
    if (reasoning !== undefined) {
      document.getElementById("reasoning").checked = reasoning;
    }

    // 输入类型
    if (input) {
      document.getElementById("input-type-text").checked =
        input.includes("text");
      document.getElementById("input-image").checked = input.includes("image");
    }
  }

  // 滚动到表单
  formCard.scrollIntoView({ behavior: "smooth", block: "start" });

  // 聚焦到 API Key 输入框
  setTimeout(() => {
    document.getElementById("api-key").focus();
  }, 300);
}

// 展开/收起表单
function toggleModelForm() {
  const formCard = document.getElementById("model-form-card");
  const formTitle = document.getElementById("form-title");
  const submitBtnText = document.getElementById("submit-btn-text");

  if (formCard.style.display === "none") {
    formCard.style.display = "block";
    formTitle.textContent = "添加新模型";
    submitBtnText.textContent = "添加新模型";
    resetModelForm();
    // 初始化 API 类型下拉框（默认 openai）
    updateApiTypeOptions("openai");
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    formCard.style.display = "none";
    resetModelForm();
  }
}

// 取消表单
function cancelModelForm() {
  document.getElementById("model-form-card").style.display = "none";
  resetModelForm();
}

// API Key 脱敏显示
function maskApiKey(key) {
  if (!key || key.length < 8) {
    return "***";
  }
  const start = key.substring(0, 4);
  const end = key.substring(key.length - 4);
  return `${start}${"*".repeat(Math.min(20, key.length - 8))}${end}`;
}

function getApiKeyStorageElements() {
  return {
    apiKeyInput: document.getElementById("api-key"),
    storageSelect: document.getElementById("api-key-storage-mode"),
    envGroup: document.getElementById("api-key-env-var-group"),
    envInput: document.getElementById("api-key-env-var"),
    storageNote: document.getElementById("api-key-storage-note"),
    inputNote: document.getElementById("api-key-input-note"),
    keepExistingInput: document.getElementById("keep-existing-api-key-ref"),
    existingRefInput: document.getElementById("existing-api-key-ref"),
  };
}

function isSecretRefStorageMode(mode) {
  return mode === "managed-file" || mode === "env";
}

function parseExistingApiKeyRefFromForm(existingRefInput) {
  const raw = String(existingRefInput?.value || "").trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function canKeepLegacySecretRefInEditMode() {
  if (apiKeyProtectionEnabled === true) {
    return false;
  }
  const editModelKey = String(
    document.getElementById("edit-model-key")?.value || "",
  ).trim();
  if (!editModelKey) {
    return false;
  }
  const { existingRefInput } = getApiKeyStorageElements();
  const existingRef = parseExistingApiKeyRefFromForm(existingRefInput);
  if (!existingRef) {
    return false;
  }
  const existingMode = inferApiKeyStorageState(existingRef).mode;
  return isSecretRefStorageMode(existingMode);
}

function enforceApiKeyStorageModePolicy() {
  const { storageSelect, keepExistingInput } = getApiKeyStorageElements();
  if (!storageSelect) {
    return;
  }

  const allowSecretRef =
    apiKeyProtectionEnabled === true || canKeepLegacySecretRefInEditMode();
  Array.from(storageSelect.options).forEach((option) => {
    if (!option || !isSecretRefStorageMode(option.value)) {
      return;
    }
    option.disabled = !allowSecretRef;
  });

  if (!allowSecretRef && isSecretRefStorageMode(storageSelect.value)) {
    storageSelect.value = "plaintext";
    if (keepExistingInput) {
      keepExistingInput.value = "false";
    }
  }
}

function getDefaultApiKeyStorageMode() {
  return apiKeyProtectionEnabled ? "managed-file" : "plaintext";
}

function applyDefaultApiKeyStorageMode() {
  const { storageSelect, keepExistingInput } = getApiKeyStorageElements();
  if (!storageSelect) {
    return;
  }

  const editModelKey = document.getElementById("edit-model-key")?.value || "";
  if (editModelKey) {
    enforceApiKeyStorageModePolicy();
    handleApiKeyStorageModeChange();
    return;
  }

  enforceApiKeyStorageModePolicy();
  storageSelect.value = getDefaultApiKeyStorageMode();
  if (keepExistingInput) {
    keepExistingInput.value = "false";
  }
  handleApiKeyStorageModeChange();
}

function inferApiKeyStorageState(apiKeyValue) {
  if (typeof apiKeyValue === "string") {
    const hasValue = apiKeyValue.trim().length > 0;
    return {
      mode: "plaintext",
      envVar: "",
      keepExisting: false,
      hasValue,
      descriptor: hasValue ? `明文（${maskApiKey(apiKeyValue.trim())}）` : "未配置",
    };
  }

  if (apiKeyValue && typeof apiKeyValue === "object") {
    if (typeof apiKeyValue.env === "string") {
      return {
        mode: "env",
        envVar: apiKeyValue.env.trim(),
        keepExisting: true,
        hasValue: true,
        descriptor: `环境变量 SecretRef (${apiKeyValue.env.trim()})`,
      };
    }

    const source = String(apiKeyValue.source || "").toLowerCase();
    if (source === "env") {
      return {
        mode: "env",
        envVar: String(apiKeyValue.id || "").trim(),
        keepExisting: true,
        hasValue: true,
        descriptor: `环境变量 SecretRef (${String(apiKeyValue.id || "").trim()})`,
      };
    }
    if (source === "file" || typeof apiKeyValue.file === "string") {
      return {
        mode: "managed-file",
        envVar: "",
        keepExisting: true,
        hasValue: true,
        descriptor: "文件 SecretRef（已配置）",
      };
    }
  }

  return {
    mode: "managed-file",
    envVar: "",
    keepExisting: false,
    hasValue: false,
    descriptor: "未配置",
  };
}

function handleApiKeyStorageModeChange() {
  const {
    apiKeyInput,
    storageSelect,
    envGroup,
    envInput,
    storageNote,
    inputNote,
    keepExistingInput,
    existingRefInput,
  } = getApiKeyStorageElements();
  if (!apiKeyInput || !storageSelect || !envGroup || !envInput) {
    return;
  }

  enforceApiKeyStorageModePolicy();
  const mode = storageSelect.value || getDefaultApiKeyStorageMode();
  const hasExistingRef = !!(existingRefInput && existingRefInput.value.trim());
  const keepExisting = keepExistingInput?.value === "true";

  if (mode === "env") {
    envGroup.style.display = "block";
    envInput.required = true;
    apiKeyInput.required = false;
    if (inputNote) {
      inputNote.textContent = "环境变量模式下不需要输入密钥值。";
    }
    if (storageNote) {
      storageNote.innerHTML =
        "将保存为环境变量 SecretRef（例如 <code>{ source: \"env\", id: \"OPENAI_API_KEY\" }</code>）。";
    }
    if (keepExistingInput) {
      keepExistingInput.value = "true";
    }
    return;
  }

  envGroup.style.display = "none";
  envInput.required = false;
  envInput.value = mode === "managed-file" ? envInput.value : "";

  if (mode === "plaintext") {
    apiKeyInput.required = true;
    if (inputNote) {
      inputNote.textContent = apiKeyProtectionEnabled
        ? "你已手动选择明文模式，密钥会直接写入 openclaw.json。"
        : "明文模式会直接写入 openclaw.json。开启 API 防护后才可切换为 SecretRef。";
    }
    if (storageNote) {
      storageNote.innerHTML = apiKeyProtectionEnabled
        ? "已开启 API 防护，但你当前手动选择了明文存储。"
        : "当前仅允许明文存储。若需使用 SecretRef，请先在“系统 → API 防护”中开启。";
    }
    if (keepExistingInput) {
      keepExistingInput.value = "false";
    }
    return;
  }

  // managed-file
  if (keepExisting && hasExistingRef && !apiKeyInput.value.trim()) {
    apiKeyInput.required = false;
    apiKeyInput.placeholder = "留空则保留当前 SecretRef；输入新值将覆盖";
  } else {
    apiKeyInput.required = true;
    if (!apiKeyInput.placeholder || apiKeyInput.placeholder.includes("留空则保留")) {
      apiKeyInput.placeholder = "输入 API Key";
    }
  }

  if (inputNote) {
    inputNote.textContent =
      "受管文件模式会把密钥写入独立文件，并在配置里保存 SecretRef。";
  }
  if (storageNote) {
    storageNote.innerHTML =
      "推荐：受管密钥文件（SecretRef），密钥将保存到 <code>/root/.openclaw/oc-deploy-secrets.json</code>。";
  }
}

// 复制路径
function copyPath(path) {
  copyToClipboard(path, "路径");
}

// 复制到剪贴板
function copyToClipboard(text, label) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast(`${label || "内容"}已复制到剪贴板`, "success");
      })
      .catch((err) => {
        showToast("复制失败: " + err.message, "error");
      });
  } else {
    // 降级方案：使用 textarea
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast(`${label || "内容"}已复制到剪贴板`, "success");
    } catch (err) {
      showToast("复制失败", "error");
    }
    document.body.removeChild(textarea);
  }
}

// 加载模型列表
async function loadModelsList() {
  try {
    const config = await apiRequest("/config");
    const modelsListEl = document.getElementById("models-list");

    // 检查是否有 providers 配置
    if (
      !config.models ||
      !config.models.providers ||
      Object.keys(config.models.providers).length === 0
    ) {
      modelsListEl.innerHTML = '<p>暂无模型，点击"添加新模型"开始配置</p>';
      return;
    }

    const providers = config.models.providers;
    const sortedProviders = Object.keys(providers).sort();

    // 获取 primary 模型
    const primaryModel = config.agents?.defaults?.model?.primary || "";

    let html = "";
    for (const providerName of sortedProviders) {
      const provider = providers[providerName];

      // 该供应商下的所有模型
      if (provider.models && Array.isArray(provider.models)) {
        for (const model of provider.models) {
          const baseUrl = provider.baseUrl || provider.baseURL || "未配置";
          const apiKeyState = inferApiKeyStorageState(provider.apiKey);
          const storageModeLabel =
            apiKeyState.mode === "env"
              ? "环境变量"
              : apiKeyState.mode === "managed-file"
                ? "受管文件"
                : "明文";
          const modelId = model.id || model.name || model.model;
          const modelKey = `${providerName}/${modelId}`;

          // 判断是否为 primary 模型
          const isPrimary = modelKey === primaryModel;
          const primaryClass = isPrimary ? " model-card-primary" : "";

          html += `
          <div class="model-card${primaryClass}" data-model-key="${modelKey}">
          <div class="model-card-header">
            <h3 class="model-card-title">${modelKey}</h3>
            ${isPrimary ? '<span class="primary-badge">主模型</span>' : ''}
          </div>
            <div class="model-card-info">
              <div class="model-card-info-item">
                <span>密钥存储:</span>
                <span>
                  ${apiKeyState.hasValue ? "已配置" : "未配置"}
                  <code style="margin-left: 8px; font-size: 0.85em;">${storageModeLabel}</code>
                  <span style="margin-left: 8px; font-size: 0.8em; color: var(--text-light);">${escapeHtml(apiKeyState.descriptor)}</span>
                </span>
              </div>
              <div class="model-card-info-item">
                <span>Base URL:</span>
                <span style="font-size: 0.75rem; word-break: break-all;">${baseUrl}</span>
              </div>
            </div>
            <div class="model-card-actions">
              ${!isPrimary ? `<button class="btn btn-primary btn-sm set-primary-btn" data-model-key="${modelKey}">设为主模型</button>` : ''}
              <button class="btn btn-secondary btn-sm edit-model-btn" data-provider="${providerName}" data-model="${modelId}">
                编辑
              </button>
              <button class="btn btn-danger btn-sm delete-model-btn" data-provider="${providerName}" data-model="${modelId}">
                删除
              </button>
            </div>
          </div>
        `;
        }
      }
    }

    modelsListEl.innerHTML = html;

    // 为"设为主模型"按钮添加点击事件
    modelsListEl.querySelectorAll(".set-primary-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const modelKey = btn.dataset.modelKey;
        if (modelKey) {
          setPrimaryModel(modelKey);
        }
      });
    });

    // 为编辑按钮添加事件监听器
    document.querySelectorAll(".edit-model-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const providerName = btn.dataset.provider;
        const modelId = btn.dataset.model;
        editModel(providerName, modelId);
      });
    });

    // 为删除按钮添加事件监听器
    document.querySelectorAll(".delete-model-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const providerName = btn.dataset.provider;
        const modelId = btn.dataset.model;
        deleteModel(providerName, modelId);
      });
    });
  } catch (error) {
    document.getElementById("models-list").innerHTML =
      '<p class="loading">加载失败: ' + error.message + "</p>";
  }
}

// 设置当前主模型
async function setPrimaryModel(modelKey) {
  try {
    if (!modelKey) {
      return;
    }

    // 避免重复保存
    if (currentConfig?.agents?.defaults?.model?.primary === modelKey) {
      showToast("该模型已是当前模型", "info");
      return;
    }

    showToast("正在设置当前模型...", "info");

    const config = await apiRequest("/config");
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.model = config.agents.defaults.model || {};
    config.agents.defaults.model.primary = modelKey;

    await apiRequest("/config", {
      method: "POST",
      body: JSON.stringify(config),
    });

    currentConfig = config;
    showToast("当前模型已更新", "success");

    await loadModelsList();
    await loadConfigSummary();
    await loadConfig();
  } catch (error) {
    showToast("设置当前模型失败: " + error.message, "error");
  }
}

// 编辑模型
async function editModel(providerName, modelId) {
  try {
    const config = await apiRequest("/config");

    if (
      !config.models ||
      !config.models.providers ||
      !config.models.providers[providerName]
    ) {
      showToast("供应商不存在", "error");
      return;
    }

    const provider = config.models.providers[providerName];
    const model = provider.models?.find(
      (m) => m.id === modelId || m.name === modelId || m.model === modelId,
    );

    if (!model) {
      showToast("模型不存在", "error");
      return;
    }

    // 显示表单
    const formCard = document.getElementById("model-form-card");
    const formTitle = document.getElementById("form-title");
    const submitBtnText = document.getElementById("submit-btn-text");

    formCard.style.display = "block";
    formTitle.textContent = "编辑模型";
    submitBtnText.textContent = "保存修改";

    // 填充表单数据
    document.getElementById("edit-model-key").value =
      `${providerName}/${modelId}`;
    document.getElementById("model-id").value = modelId;
    document.getElementById("model-id").disabled = true; // 编辑时不允许修改模型 ID
    document.getElementById("provider-name").value = providerName;
    document.getElementById("base-url").value =
      provider.baseUrl || provider.baseURL || "";
    const {
      apiKeyInput,
      storageSelect,
      envInput,
      keepExistingInput,
      existingRefInput,
    } = getApiKeyStorageElements();
    const apiKeyState = inferApiKeyStorageState(provider.apiKey);

    if (apiKeyInput) {
      apiKeyInput.value = apiKeyState.mode === "plaintext"
        ? String(provider.apiKey || "")
        : "";
      apiKeyInput.placeholder =
        apiKeyState.mode === "managed-file" && apiKeyState.keepExisting
          ? "留空则保留当前 SecretRef；输入新值将覆盖"
          : "输入 API Key";
    }
    if (storageSelect) {
      storageSelect.value = apiKeyState.mode;
    }
    if (envInput) {
      envInput.value = apiKeyState.envVar || "";
    }
    if (keepExistingInput) {
      keepExistingInput.value = apiKeyState.keepExisting ? "true" : "false";
    }
    if (existingRefInput) {
      if (provider.apiKey && typeof provider.apiKey === "object") {
        existingRefInput.value = JSON.stringify(provider.apiKey);
      } else {
        existingRefInput.value = "";
      }
    }
    handleApiKeyStorageModeChange();

    // provider.api 保存的是 API 类型（如 openai-completions），需先推断协议再回填
    const savedApiType = provider.api || "openai-completions";
    const protocol = inferProtocolFromApiType(savedApiType);
    document.getElementById("api-protocol").value = protocol;
    updateApiTypeOptions(protocol);
    const apiTypeSelect = document.getElementById("api-type");
    apiTypeSelect.value = savedApiType;

    // 兼容旧配置：如果旧值不在当前选项里，回退到当前协议默认值
    if (
      apiTypeSelect.value !== savedApiType &&
      apiTypeSelect.options.length > 0
    ) {
      apiTypeSelect.selectedIndex = 0;
    }

    // 填充高级配置（如果存在）
    if (model.contextWindow) {
      document.getElementById("context-window").value = model.contextWindow;
    }
    if (model.maxTokens) {
      document.getElementById("max-tokens").value = model.maxTokens;
    }
    if (model.reasoning !== undefined) {
      document.getElementById("reasoning").checked = model.reasoning;
    }
    if (model.input) {
      document.getElementById("input-type-text").checked =
        model.input.includes("text");
      document.getElementById("input-image").checked =
        model.input.includes("image");
    }

    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showToast("加载模型数据失败: " + error.message, "error");
  }
}

// 删除模型
async function deleteModel(providerName, modelId) {
  if (
    !confirm(`确定要删除模型 "${providerName}/${modelId}" 吗？此操作不可撤销。`)
  ) {
    return;
  }

  try {
    showToast("正在删除模型...", "info");

    const modelKey = `${providerName}/${modelId}`;
    const result = await apiRequest(`/models/delete`, {
      method: "POST",
      body: JSON.stringify({ modelKey }),
    });

    showToast(result.message || "模型删除成功！", "success");

    // 重新加载模型列表和配置编辑器
    await loadModelsList();
    await loadConfig();
  } catch (error) {
    showToast("删除模型失败: " + error.message, "error");
  }
}

// ==================== 消息渠道管理 ====================

function inferChannelType(channelId, channel) {
  if (channel && channel.type) {
    return channel.type;
  }
  if (channel && ("botId" in channel || "secret" in channel)) {
    return "wecom";
  }
  if (channel && ("appId" in channel || "clientSecret" in channel)) {
    return "qqbot";
  }
  if (channel && channel.accounts && channel.accounts.main) {
    return "feishu";
  }
  if (channel && channel.token) {
    return "discord";
  }
  if (channel && (channel.botToken || channel.groups)) {
    return "telegram";
  }
  if (channelId === "telegram") {
    return "telegram";
  }
  if (channelId === "qqbot") {
    return "qqbot";
  }
  if (channelId === "wecom") {
    return "wecom";
  }
  return "unknown";
}

function getChannelDisplayLabel(channelType, channelId) {
  switch (channelType) {
    case "telegram":
      return "Telegram";
    case "discord":
      return "Discord";
    case "feishu":
      return "飞书";
    case "qqbot":
      return "QQ";
    case "wecom":
      return "企业微信";
    default:
      return channelId || "未知渠道";
  }
}

function getChannelIdentityValue(channelType, channel) {
  if (!channel) return "";
  if (channelType === "telegram") {
    return channel.botToken || channel.token || "";
  }
  if (channelType === "discord") {
    return channel.token || "";
  }
  if (channelType === "feishu") {
    return channel.accounts?.main?.appId || "";
  }
  if (channelType === "qqbot") {
    return channel.appId || "";
  }
  if (channelType === "wecom") {
    return channel.botId || "";
  }
  return channel.botToken || channel.token || "";
}

function getChannelBadgeText(channelType, channel) {
  const identityValue = getChannelIdentityValue(channelType, channel);
  if (identityValue) {
    const masked = maskApiKey(identityValue);
    if (channelType === "feishu" || channelType === "qqbot") {
      return `App: ${masked}`;
    }
    return `Bot: ${masked}`;
  }
  return "未绑定凭据";
}

function parseCommaList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeAllowFrom(value, fallback = ["*"]) {
  if (Array.isArray(value)) {
    const list = value
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
    return list.length > 0 ? list : fallback;
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return fallback;
}

function inferTelegramGroupPolicy(channel) {
  const group = channel?.groups?.["*"];
  if (!group) return "disabled";
  if (group.requireMention === false) return "open";
  return "allowlist";
}

// 加载消息渠道列表
async function loadChannelsList() {
  try {
    const config = await apiRequest("/config");
    const channels = config.channels || {};

    const channelsListEl = document.getElementById("channels-list");

    if (Object.keys(channels).length === 0) {
      channelsListEl.innerHTML = "<p>暂无消息渠道配置</p>";
      return;
    }

    let html = "";
    for (const [channelId, channel] of Object.entries(channels)) {
      const enabled = channel.enabled !== false;
      const statusClass = enabled ? "status-running" : "status-stopped";
      const statusText = enabled ? "已启用" : "已禁用";

      // 获取渠道类型
      const channelType = inferChannelType(channelId, channel);

      // 使用渠道类型作为标题（更友好的显示）
      const displayName = getChannelDisplayLabel(channelType, channelId);
      const badgeText = getChannelBadgeText(channelType, channel);

      // 构建渠道信息摘要
      let infoItems = [];

      if (channelType === "telegram") {
        const token = channel.botToken || channel.token;
        if (token) infoItems.push(`Token: ${token.substring(0, 10)}...`);
        if (channel.chatId) infoItems.push(`Chat ID: ${channel.chatId}`);
        infoItems.push(`私聊策略: ${channel.dmPolicy || "open"}`);
        const requireMention = channel.groups?.["*"]?.requireMention;
        if (requireMention !== undefined) {
          infoItems.push(`群组需被提及: ${requireMention ? "需要" : "不需要"}`);
          if (requireMention) {
            infoItems.push("说明: 即在群组中有人 @ 机器人时才会回应");
          }
        }
      } else if (channelType === "discord") {
        // Discord 只有 token
        if (channel.token)
          infoItems.push(`Token: ${channel.token.substring(0, 10)}...`);
      } else if (channelType === "feishu") {
        // 飞书使用 accounts.main 结构
        const mainAccount = channel.accounts?.main || {};
        if (mainAccount.appId) infoItems.push(`App ID: ${mainAccount.appId}`);
        if (channel.dmPolicy) infoItems.push(`私聊策略: ${channel.dmPolicy}`);
      } else if (channelType === "qqbot") {
        if (channel.appId) infoItems.push(`App ID: ${channel.appId}`);
        const allowFrom = Array.isArray(channel.allowFrom)
          ? channel.allowFrom
          : ["*"];
        infoItems.push(`允许来源: ${allowFrom.join(", ")}`);
      } else if (channelType === "wecom") {
        if (channel.botId) infoItems.push(`Bot ID: ${channel.botId}`);
        const allowFrom = normalizeAllowFrom(channel.allowFrom, ["*"]);
        infoItems.push(`允许来源: ${allowFrom.join(", ")}`);
        infoItems.push(`私聊策略: ${channel.dmPolicy || "open"}`);
      } else {
        // 其他渠道类型
        const token = channel.botToken || channel.token;
        if (token) infoItems.push(`Token: ${token.substring(0, 10)}...`);
        if (channel.chatId) infoItems.push(`Chat ID: ${channel.chatId}`);
      }

      html += `
        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h3 class="channel-card-title">${displayName}</h3>
              <span class="channel-card-type">${badgeText}</span>
            </div>
            <span class="channel-status ${statusClass}">${statusText}</span>
          </div>
          <div class="channel-card-info">
            ${infoItems.map((item) => `<div class="channel-card-info-item">${item}</div>`).join("")}
          </div>
          <div class="channel-card-actions">
            <button class="btn btn-secondary btn-sm edit-channel-btn" data-channel="${channelId}">
              编辑
            </button>
            <button class="btn btn-danger btn-sm delete-channel-btn" data-channel="${channelId}">
              删除
            </button>
          </div>
        </div>
      `;
    }

    channelsListEl.innerHTML = html;

    // 绑定编辑按钮事件
    channelsListEl.querySelectorAll(".edit-channel-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const channelId = btn.dataset.channel;
        editChannel(channelId);
      });
    });

    // 绑定删除按钮事件
    channelsListEl.querySelectorAll(".delete-channel-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const channelId = btn.dataset.channel;
        deleteChannel(channelId);
      });
    });
  } catch (error) {
    document.getElementById("channels-list").innerHTML =
      '<p class="loading">加载失败: ' + error.message + "</p>";
  }
}

// 处理渠道类型切换
function handleChannelTypeChange() {
  const channelType = document.getElementById("channel-type").value;
  const recommendedFields = document.getElementById("channel-recommended-fields");
  const advancedSection = document.getElementById("channel-advanced-section");
  const editKey = document.getElementById("edit-channel-key")?.value || "";
  const isEditMode = !!editKey;
  const tokenField = document.getElementById("channel-token");

  // 隐藏所有特定配置
  ["telegram", "discord", "qqbot", "feishu", "wecom"].forEach(type => {
    const config = document.getElementById(`${type}-specific-config`);
    const advanced = document.getElementById(`${type}-advanced-config`);
    if (config) config.style.display = "none";
    if (advanced) advanced.style.display = "none";
  });

  if (!channelType) {
    if (recommendedFields) recommendedFields.style.display = "none";
    if (advancedSection) advancedSection.style.display = "none";
    if (tokenField) {
      tokenField.parentElement.style.display = "none";
      tokenField.removeAttribute("required");
    }
    return;
  }

  if (recommendedFields) recommendedFields.style.display = "block";

  const handler = window.channelHandlers?.[channelType];
  if (handler) {
    // 调整 Token 字段显示
    if (tokenField) {
      if (handler.needsToken) {
        tokenField.parentElement.style.display = "block";
        tokenField.setAttribute("required", "required");
      } else {
        tokenField.parentElement.style.display = "none";
        tokenField.removeAttribute("required");
      }
    }

    // 显示特定配置
    handler.showFields();
    handler.setDefaults(isEditMode);

    // 显示/隐藏高级配置
    if (advancedSection) {
      advancedSection.style.display = handler.hasAdvanced ? "block" : "none";
    }
  }
}

// 显示/隐藏添加渠道表单
function toggleChannelForm() {
  const formCard = document.getElementById("channel-form-card");
  const formTitle = document.getElementById("channel-form-title");
  const submitBtnText = document.getElementById("channel-submit-btn-text");

  formCard.style.display = "block";
  formTitle.textContent = "添加消息渠道";
  submitBtnText.textContent = "添加消息渠道";

  // 清空表单
  document.getElementById("edit-channel-key").value = "";
  document.getElementById("channel-type").value = "";
  document.getElementById("channel-type").disabled = false;
  document.getElementById("channel-token").value = "";
  document.getElementById("channel-enabled").checked = true;

  // 清空 Telegram 特定字段
  const dmPolicyEl = document.getElementById("telegram-dm-policy");
  if (dmPolicyEl) dmPolicyEl.value = "open";
  const groupPolicyEl = document.getElementById("telegram-group-policy");
  if (groupPolicyEl) groupPolicyEl.value = "open";
  const allowFromEl = document.getElementById("telegram-allow-from");
  if (allowFromEl) allowFromEl.value = "*";
  const groupAllowFromEl = document.getElementById("telegram-group-allow-from");
  if (groupAllowFromEl) groupAllowFromEl.value = "";

  // 清空飞书特定字段
  const feishuAppIdEl = document.getElementById("feishu-app-id");
  if (feishuAppIdEl) feishuAppIdEl.value = "";
  const feishuAppSecretEl = document.getElementById("feishu-app-secret");
  if (feishuAppSecretEl) feishuAppSecretEl.value = "";
  const feishuBotNameEl = document.getElementById("feishu-bot-name");
  if (feishuBotNameEl) feishuBotNameEl.value = "";
  const feishuVerificationTokenEl = document.getElementById(
    "feishu-verification-token",
  );
  if (feishuVerificationTokenEl) feishuVerificationTokenEl.value = "";
  const feishuDmPolicyEl = document.getElementById("feishu-dm-policy");
  if (feishuDmPolicyEl) feishuDmPolicyEl.value = "open";
  const feishuAllowFromEl = document.getElementById("feishu-allow-from");
  if (feishuAllowFromEl) feishuAllowFromEl.value = "*";

  // 清空 QQ 特定字段
  const qqbotAppIdEl = document.getElementById("qqbot-app-id");
  if (qqbotAppIdEl) qqbotAppIdEl.value = "";
  const qqbotClientSecretEl = document.getElementById("qqbot-client-secret");
  if (qqbotClientSecretEl) qqbotClientSecretEl.value = "";
  const qqbotAllowFromEl = document.getElementById("qqbot-allow-from");
  if (qqbotAllowFromEl) qqbotAllowFromEl.value = "*";
  const wecomBotIdEl = document.getElementById("wecom-bot-id");
  if (wecomBotIdEl) wecomBotIdEl.value = "";
  const wecomSecretEl = document.getElementById("wecom-secret");
  if (wecomSecretEl) wecomSecretEl.value = "";
  const wecomDmPolicyEl = document.getElementById("wecom-dm-policy");
  if (wecomDmPolicyEl) wecomDmPolicyEl.value = "open";

  // 显示对应类型的配置
  handleChannelTypeChange();

  // 绑定类型切换事件
  const channelTypeEl = document.getElementById("channel-type");
  if (channelTypeEl) {
    channelTypeEl.removeEventListener("change", handleChannelTypeChange);
    channelTypeEl.addEventListener("change", handleChannelTypeChange);
  }

  formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 取消添加/编辑渠道
function cancelChannelForm() {
  document.getElementById("channel-form-card").style.display = "none";
  document.getElementById("add-channel-form").reset();
  document.getElementById("edit-channel-key").value = "";
  document.getElementById("channel-type").disabled = false;
}

// 保存渠道配置
async function submitChannelForm(event) {
  event.preventDefault();

  const editKey = document.getElementById("edit-channel-key").value;
  const isEditMode = !!editKey;
  const channelType = document.getElementById("channel-type").value;
  const token = document.getElementById("channel-token").value.trim();
  const enabled = document.getElementById("channel-enabled").checked;

  if (!channelType) {
    showToast("请选择渠道类型", "error");
    return;
  }

  const handler = window.channelHandlers?.[channelType];

  // 验证通用 token（如果需要）
  if (handler && handler.needsToken && !token) {
    showToast("请输入 Token", "error");
    return;
  }

  // 使用 handler 验证特定字段
  if (handler && !handler.validate()) {
    return;
  }

  // 插件检查
  if (channelType === "qqbot") {
    const pluginReady = await ensureQqbotPluginInstalled();
    if (!pluginReady) return;
  }

  if (channelType === "wecom") {
    const pluginReady = await ensureWecomPluginInstalled();
    if (!pluginReady) return;
  }

  try {
    showToast(
      isEditMode ? "正在保存渠道修改..." : "正在添加消息渠道...",
      "info",
    );

    // 获取当前配置
    const config = await apiRequest("/config");

    // 确保 channels 对象存在
    if (!config.channels) {
      config.channels = {};
    }

    const channelId = editKey || channelType;

    // 如果是编辑模式且渠道类型改变了，删除旧的
    if (editKey && editKey !== channelId) {
      delete config.channels[editKey];
    }

    // 使用 handler 构建配置
    if (handler) {
      const channelConfig = handler.buildConfig();
      config.channels[channelId] = {
        enabled: enabled,
        ...channelConfig
      };

      // 添加通用 token（如果需要）
      if (handler.needsToken && token) {
        config.channels[channelId].botToken = token;
      }
    } else {
      // 未知渠道类型，使用通用配置
      config.channels[channelId] = {
        enabled: enabled,
        botToken: token
      };
    }

    showToast(isEditMode ? "正在保存渠道修改..." : "正在添加消息渠道...", "info");

    // 保存整个配置
    await apiRequest("/config", {
      method: "POST",
      body: JSON.stringify(config),
    });

    showToast(isEditMode ? "渠道修改成功！" : "消息渠道添加成功！", "success");

    // 重新加载渠道列表、配置摘要和配置编辑器
    await loadChannelsList();
    await loadConfigSummary();
    await loadConfig();

    // 隐藏表单
    cancelChannelForm();
  } catch (error) {
    showToast(
      (isEditMode ? "保存渠道修改失败: " : "添加消息渠道失败: ") +
        error.message,
      "error",
    );
  }
}

async function fetchQqbotPluginStatus() {
  return apiRequest("/plugins/qqbot/status");
}

function setQqbotPluginButtonState(state, version = "") {
  const btn = document.getElementById("qqbot-plugin-btn");
  if (!btn) return;

  btn.classList.remove("installed", "missing", "error", "installing");

  switch (state) {
    case "installed":
      btn.classList.add("installed");
      btn.textContent = version
        ? `QQ 插件：已安装 (${version})`
        : "QQ 插件：已安装";
      btn.disabled = false;
      break;
    case "disabled":
      btn.classList.add("missing");
      btn.textContent = "QQ 插件：未启用（点击启用）";
      btn.disabled = false;
      break;
    case "missing":
      btn.classList.add("missing");
      btn.textContent = "QQ 插件：未安装（点击安装）";
      btn.disabled = false;
      break;
    case "unverified":
      btn.classList.add("error");
      btn.textContent = "QQ 插件：异常（缺少插件元数据）";
      btn.disabled = false;
      break;
    case "installing":
      btn.classList.add("installing");
      btn.textContent = "QQ 插件：安装中...";
      btn.disabled = true;
      break;
    case "error":
    default:
      btn.classList.add("error");
      btn.textContent = "QQ 插件：检测失败（点击重试）";
      btn.disabled = false;
      break;
  }
}

async function refreshQqbotPluginStatus() {
  try {
    const status = await fetchQqbotPluginStatus();
    if (status && status.state === "installed") {
      setQqbotPluginButtonState("installed", status.version || "");
    } else if (status && status.state === "disabled") {
      setQqbotPluginButtonState("disabled");
    } else if (status && status.state === "unverified") {
      setQqbotPluginButtonState("unverified");
    } else {
      setQqbotPluginButtonState("missing");
    }
  } catch (error) {
    setQqbotPluginButtonState("error");
  }
}

async function ensureQqbotPluginInstalled() {
  try {
    const status = await fetchQqbotPluginStatus();
    if (status && status.state === "installed") {
      return true;
    }
    if (status && status.state === "unverified") {
      setQqbotPluginButtonState("unverified");
      showToast(status.message || "QQ 插件目录异常，请清理后重试", "error");
      return false;
    }
  } catch (error) {
    setQqbotPluginButtonState("error");
    showToast("QQ 插件状态检测失败: " + error.message, "error");
    return false;
  }

  const installed = await installQqbotPlugin();
  return installed;
}

async function installQqbotPlugin() {
  if (qqbotPluginInstalling) {
    return false;
  }

  qqbotPluginInstalling = true;
  setQqbotPluginButtonState("installing");
  showToast("正在安装 QQ 插件...", "info");

  try {
    const result = await apiRequest("/plugins/qqbot/install", {
      method: "POST",
    });
    const version = result?.version || "";
    setQqbotPluginButtonState("installed", version);
    showToast(result?.message || "QQ 插件安装成功", "success");
    qqbotPluginInstalling = false;
    return true;
  } catch (error) {
    setQqbotPluginButtonState("missing");
    showToast("QQ 插件安装失败: " + error.message, "error");
    qqbotPluginInstalling = false;
    return false;
  }
}

async function fetchWecomPluginStatus() {
  return apiRequest("/plugins/wecom/status");
}

function setWecomPluginButtonState(state, version = "") {
  const btn = document.getElementById("wecom-plugin-btn");
  if (!btn) return;

  btn.classList.remove("installed", "missing", "error", "installing");

  switch (state) {
    case "installed":
      btn.classList.add("installed");
      btn.textContent = version
        ? `企业微信插件：已安装 (${version})`
        : "企业微信插件：已安装";
      btn.disabled = false;
      break;
    case "disabled":
      btn.classList.add("missing");
      btn.textContent = "企业微信插件：未启用（点击启用）";
      btn.disabled = false;
      break;
    case "missing":
      btn.classList.add("missing");
      btn.textContent = "企业微信插件：未安装（点击安装）";
      btn.disabled = false;
      break;
    case "unverified":
      btn.classList.add("error");
      btn.textContent = "企业微信插件：异常（缺少插件元数据）";
      btn.disabled = false;
      break;
    case "installing":
      btn.classList.add("installing");
      btn.textContent = "企业微信插件：安装中...";
      btn.disabled = true;
      break;
    case "error":
    default:
      btn.classList.add("error");
      btn.textContent = "企业微信插件：检测失败（点击重试）";
      btn.disabled = false;
      break;
  }
}

async function refreshWecomPluginStatus() {
  try {
    const status = await fetchWecomPluginStatus();
    if (status && status.state === "installed") {
      setWecomPluginButtonState("installed", status.version || "");
    } else if (status && status.state === "disabled") {
      setWecomPluginButtonState("disabled");
    } else if (status && status.state === "unverified") {
      setWecomPluginButtonState("unverified");
    } else {
      setWecomPluginButtonState("missing");
    }
  } catch (error) {
    setWecomPluginButtonState("error");
  }
}

async function ensureWecomPluginInstalled() {
  try {
    const status = await fetchWecomPluginStatus();
    if (status && status.state === "installed") {
      return true;
    }
    if (status && status.state === "unverified") {
      setWecomPluginButtonState("unverified");
      showToast(
        status.message || "企业微信插件目录异常，请清理后重试",
        "error",
      );
      return false;
    }
  } catch (error) {
    setWecomPluginButtonState("error");
    showToast("企业微信插件状态检测失败: " + error.message, "error");
    return false;
  }

  const installed = await installWecomPlugin();
  return installed;
}

async function installWecomPlugin() {
  if (wecomPluginInstalling) {
    return false;
  }

  wecomPluginInstalling = true;
  setWecomPluginButtonState("installing");
  showToast("正在安装企业微信插件...", "info");

  try {
    const result = await apiRequest("/plugins/wecom/install", {
      method: "POST",
    });
    const version = result?.version || "";
    setWecomPluginButtonState("installed", version);
    showToast(result?.message || "企业微信插件安装成功", "success");
    wecomPluginInstalling = false;
    return true;
  } catch (error) {
    setWecomPluginButtonState("missing");
    showToast("企业微信插件安装失败: " + error.message, "error");
    wecomPluginInstalling = false;
    return false;
  }
}

// 编辑渠道
async function editChannel(channelId) {
  try {
    const config = await apiRequest("/config");
    const channel = config.channels[channelId];

    if (!channel) {
      showToast("渠道不存在", "error");
      return;
    }

    // 获取渠道类型
    const channelType = inferChannelType(channelId, channel);

    // 显示表单
    const formCard = document.getElementById("channel-form-card");
    const formTitle = document.getElementById("channel-form-title");
    const submitBtnText = document.getElementById("channel-submit-btn-text");

    formCard.style.display = "block";
    formTitle.textContent = "编辑消息渠道";
    submitBtnText.textContent = "保存修改";

    // 填充表单数据
    document.getElementById("edit-channel-key").value = channelId;
    document.getElementById("channel-type").value = channelType;
    document.getElementById("channel-type").disabled = false; // 允许修改渠道类型
    document.getElementById("channel-token").value =
      channel.botToken || channel.token || "";
    document.getElementById("channel-enabled").checked =
      channel.enabled !== false;

    // 填充 Telegram 特定字段
    if (channelType === "telegram") {
      const dmPolicyEl = document.getElementById("telegram-dm-policy");
      if (dmPolicyEl) dmPolicyEl.value = channel.dmPolicy || "open";

      const groupPolicyEl = document.getElementById("telegram-group-policy");
      if (groupPolicyEl) {
        groupPolicyEl.value = inferTelegramGroupPolicy(channel);
      }

      const allowFromEl = document.getElementById("telegram-allow-from");
      if (allowFromEl) {
        const allowFrom = Array.isArray(channel.allowFrom)
          ? channel.allowFrom
          : [];
        allowFromEl.value = allowFrom.length > 0 ? allowFrom.join(", ") : "";
      }

      const groupAllowFromEl = document.getElementById(
        "telegram-group-allow-from",
      );
      if (groupAllowFromEl) {
        const allowFrom = Array.isArray(channel.groups?.["*"]?.allowFrom)
          ? channel.groups["*"].allowFrom
          : [];
        groupAllowFromEl.value =
          allowFrom.length > 0 ? allowFrom.join(", ") : "";
      }
    }

    // 填充 Discord 特定字段
    if (channelType === "discord") {
      const discordTokenEl = document.getElementById("discord-token");
      if (discordTokenEl) discordTokenEl.value = channel.token || "";
    }

    // 填充飞书特定字段
    if (channelType === "feishu" && channel.accounts && channel.accounts.main) {
      const mainAccount = channel.accounts.main;

      const appIdEl = document.getElementById("feishu-app-id");
      if (appIdEl) appIdEl.value = mainAccount.appId || "";

      const appSecretEl = document.getElementById("feishu-app-secret");
      if (appSecretEl) appSecretEl.value = mainAccount.appSecret || "";

      const botNameEl = document.getElementById("feishu-bot-name");
      if (botNameEl) botNameEl.value = mainAccount.botName || "";

      // const verificationTokenEl = document.getElementById(
      //   "feishu-verification-token",
      // );
      // if (verificationTokenEl)
      //   verificationTokenEl.value = mainAccount.verificationToken || "";

      const dmPolicyEl = document.getElementById("feishu-dm-policy");
      if (dmPolicyEl) dmPolicyEl.value = channel.dmPolicy || "open";

      const allowFromEl = document.getElementById("feishu-allow-from");
      if (allowFromEl) {
        const allowFrom = Array.isArray(channel.allowFrom)
          ? channel.allowFrom
          : [];
        allowFromEl.value = allowFrom.length > 0 ? allowFrom.join(", ") : "*";
      }
    }

    // 填充 QQ 特定字段
    if (channelType === "qqbot") {
      const qqbotAllowFromEl = document.getElementById("qqbot-allow-from");
      if (qqbotAllowFromEl) {
        const allowFrom = Array.isArray(channel.allowFrom)
          ? channel.allowFrom
          : [];
        qqbotAllowFromEl.value =
          allowFrom.length > 0 ? allowFrom.join(", ") : "*";
      }
      const qqbotAppIdEl = document.getElementById("qqbot-app-id");
      if (qqbotAppIdEl) qqbotAppIdEl.value = channel.appId || "";

      const qqbotClientSecretEl = document.getElementById(
        "qqbot-client-secret",
      );
      if (qqbotClientSecretEl) {
        qqbotClientSecretEl.value = channel.clientSecret || "";
      }
    }

    // 填充企业微信特定字段
    if (channelType === "wecom") {
      const wecomBotIdEl = document.getElementById("wecom-bot-id");
      if (wecomBotIdEl) wecomBotIdEl.value = channel.botId || "";

      const wecomSecretEl = document.getElementById("wecom-secret");
      if (wecomSecretEl) wecomSecretEl.value = channel.secret || "";

      const wecomDmPolicyEl = document.getElementById("wecom-dm-policy");
      if (wecomDmPolicyEl) wecomDmPolicyEl.value = channel.dmPolicy || "open";
    }

    // 显示对应类型的配置
    handleChannelTypeChange();

    // 绑定类型切换事件
    const channelTypeEl = document.getElementById("channel-type");
    if (channelTypeEl) {
      channelTypeEl.removeEventListener("change", handleChannelTypeChange);
      channelTypeEl.addEventListener("change", handleChannelTypeChange);
    }

    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showToast("加载渠道数据失败: " + error.message, "error");
  }
}

// 删除渠道
async function deleteChannel(channelId) {
  if (!confirm(`确定要删除渠道 "${channelId}" 吗？此操作不可撤销。`)) {
    return;
  }

  try {
    showToast("正在删除渠道...", "info");

    // 获取当前配置
    const config = await apiRequest("/config");

    // 删除指定渠道
    if (config.channels && config.channels[channelId]) {
      delete config.channels[channelId];
    } else {
      showToast("渠道不存在", "error");
      return;
    }

    // 保存配置
    await apiRequest("/config", {
      method: "POST",
      body: JSON.stringify(config),
    });

    showToast("渠道删除成功！", "success");

    // 重新加载渠道列表、配置摘要和配置编辑器
    await loadChannelsList();
    await loadConfigSummary();
    await loadConfig();
  } catch (error) {
    showToast("删除渠道失败: " + error.message, "error");
  }
}

// 展开/收起高级配置
function toggleAdvanced() {
  const advanced = document.getElementById("advanced-config");
  const toggle = document.getElementById("advanced-toggle");

  if (advanced.style.display === "none") {
    advanced.style.display = "block";
    toggle.textContent = "▲";
  } else {
    advanced.style.display = "none";
    toggle.textContent = "▼";
  }
}

// 提交模型表单
async function submitModelForm(event) {
  event.preventDefault();

  try {
    const form = document.getElementById("add-model-form");
    const formData = new FormData(form);
    const editModelKey = document.getElementById("edit-model-key").value;
    const isEditMode = !!editModelKey;

    const modelIdInput = document.getElementById("model-id");
    const providerInput = document.getElementById("provider-name");
    // 优先从输入框取值，避免字段在只读/禁用状态下被 FormData 跳过
    const modelId = (
      modelIdInput?.value ||
      formData.get("modelId") ||
      ""
    ).trim();
    const providerName = (
      providerInput?.value ||
      formData.get("providerName") ||
      ""
    ).trim();

    // 与后端校验规则保持一致
    const modelIdPattern = /^[a-zA-Z0-9._/:-]+$/;
    const providerPattern = /^[a-z-]+$/;

    if (modelIdInput) {
      modelIdInput.setCustomValidity("");
    }
    if (providerInput) {
      providerInput.setCustomValidity("");
    }

    if (!modelIdPattern.test(modelId)) {
      if (modelIdInput) {
        modelIdInput.setCustomValidity(
          "模型 ID 只能包含字母、数字、连字符(-)、点号(.)、斜杠(/)和冒号(:)，不能包含空格或其他特殊字符",
        );
        modelIdInput.reportValidity();
        modelIdInput.focus();
      }
      return;
    }

    if (!providerPattern.test(providerName)) {
      if (providerInput) {
        providerInput.setCustomValidity(
          "供应商名称只能包含小写英文字符（a-z）和连字符（-）",
        );
        providerInput.reportValidity();
        providerInput.focus();
      }
      return;
    }

    const {
      apiKeyInput,
      storageSelect,
      envInput,
      keepExistingInput,
      existingRefInput,
    } = getApiKeyStorageElements();
    enforceApiKeyStorageModePolicy();
    const apiKeyStorageMode = storageSelect?.value || getDefaultApiKeyStorageMode();
    const apiKey = String(formData.get("apiKey") || "").trim();
    const apiKeyEnvVar = String(envInput?.value || "").trim();
    const envVarPattern = /^[A-Z_][A-Z0-9_]*$/;
    const legacySecretRefAllowed = canKeepLegacySecretRefInEditMode();
    let keepExistingApiKeyRef = false;

    if (apiKeyInput) {
      apiKeyInput.setCustomValidity("");
    }
    if (envInput) {
      envInput.setCustomValidity("");
    }

    if (
      !apiKeyProtectionEnabled &&
      isSecretRefStorageMode(apiKeyStorageMode) &&
      !legacySecretRefAllowed
    ) {
      if (storageSelect) {
        storageSelect.value = "plaintext";
        handleApiKeyStorageModeChange();
      }
      showToast("当前未开启 API 防护，仅允许明文存储", "error");
      return;
    }

    if (apiKeyStorageMode === "env") {
      if (!envVarPattern.test(apiKeyEnvVar)) {
        if (envInput) {
          envInput.setCustomValidity(
            "环境变量名格式不正确（示例：OPENAI_API_KEY）",
          );
          envInput.reportValidity();
          envInput.focus();
        }
        return;
      }
      keepExistingApiKeyRef = true;
    } else if (apiKeyStorageMode === "managed-file") {
      const hasExistingRef = !!(existingRefInput && existingRefInput.value.trim());
      keepExistingApiKeyRef = isEditMode && hasExistingRef && !apiKey;
      if (!keepExistingApiKeyRef && !apiKey) {
        if (apiKeyInput) {
          apiKeyInput.setCustomValidity("请输入 API Key");
          apiKeyInput.reportValidity();
          apiKeyInput.focus();
        } else {
          showToast("请输入 API Key", "error");
        }
        return;
      }
    } else if (!apiKey) {
      if (apiKeyInput) {
        apiKeyInput.setCustomValidity("明文模式下 API Key 不能为空");
        apiKeyInput.reportValidity();
        apiKeyInput.focus();
      } else {
        showToast("明文模式下 API Key 不能为空", "error");
      }
      return;
    }

    if (keepExistingInput) {
      keepExistingInput.value = keepExistingApiKeyRef ? "true" : "false";
    }

    // 构建输入类型数组（安全访问）
    const inputTypes = [];
    const inputTextEl = document.getElementById("input-type-text");
    const inputImageEl = document.getElementById("input-image");
    const reasoningEl = document.getElementById("reasoning");

    if (inputTextEl && inputTextEl.checked) {
      inputTypes.push("text");
    }
    if (inputImageEl && inputImageEl.checked) {
      inputTypes.push("image");
    }

    // 构建请求数据
    const modelData = {
      modelId: modelId,
      providerName: providerName,
      baseUrl: String(formData.get("baseUrl") || "").trim(),
      apiKey: apiKey,
      apiKeyStorageMode: apiKeyStorageMode,
      apiKeyEnvVar: apiKeyEnvVar,
      keepExistingApiKeyRef: keepExistingApiKeyRef,
      apiProtocol: formData.get("apiProtocol"),
      apiType: formData.get("apiType"),
      isEditMode: isEditMode,
      editModelKey: isEditMode ? editModelKey : undefined,
      advanced: {
        reasoning: reasoningEl ? reasoningEl.checked : false,
        input: inputTypes,
        contextWindow: parseInt(formData.get("contextWindow")),
        maxTokens: parseInt(formData.get("maxTokens")),
      },
    };

    showToast(isEditMode ? "正在保存修改..." : "正在添加新模型...", "info");

    const result = await apiRequest("/models/add", {
      method: "POST",
      body: JSON.stringify(modelData),
    });

    showToast(
      result.message || (isEditMode ? "模型修改成功！" : "新模型添加成功！"),
      "success",
    );

    // 重置表单并隐藏
    cancelModelForm();

    // 刷新列表和配置编辑器
    await loadModelsList();
    await loadConfigSummary();
    await loadConfig();
  } catch (error) {
    const errorMessage = error?.message || "";
    const modelIdInput = document.getElementById("model-id");
    const providerInput = document.getElementById("provider-name");

    if (modelIdInput && errorMessage.includes("模型 ID")) {
      modelIdInput.setCustomValidity(
        errorMessage.replace(/^添加失败:\\s*|^保存失败:\\s*/g, ""),
      );
      modelIdInput.reportValidity();
      modelIdInput.focus();
      return;
    }

    if (providerInput && errorMessage.includes("供应商名称")) {
      providerInput.setCustomValidity(
        errorMessage.replace(/^添加失败:\\s*|^保存失败:\\s*/g, ""),
      );
      providerInput.reportValidity();
      providerInput.focus();
      return;
    }

    showToast(
      (document.getElementById("edit-model-key").value
        ? "保存失败: "
        : "添加失败: ") + error.message,
      "error",
    );
  }
}

// 重置表单
function resetModelForm() {
  const form = document.getElementById("add-model-form");
  form.reset();

  // 清除编辑模式标记
  document.getElementById("edit-model-key").value = "";
  document.getElementById("model-id").disabled = false;

  // 重置测试按钮状态
  const testBtn = document.getElementById("test-model-btn");
  if (testBtn) {
    testBtn.className = "btn";
    testBtn.disabled = false;
  }

  // 重置高级配置默认值（安全访问）
  const contextWindowEl = document.getElementById("context-window");
  const maxTokensEl = document.getElementById("max-tokens");
  const inputTextEl = document.getElementById("input-type-text");
  const inputImageEl = document.getElementById("input-image");
  const reasoningEl = document.getElementById("reasoning");

  if (contextWindowEl) contextWindowEl.value = "200000";
  if (maxTokensEl) maxTokensEl.value = "8192";
  if (inputTextEl) inputTextEl.checked = true;
  if (inputImageEl) inputImageEl.checked = false;
  if (reasoningEl) reasoningEl.checked = false;

  const {
    apiKeyInput,
    storageSelect,
    envInput,
    keepExistingInput,
    existingRefInput,
  } = getApiKeyStorageElements();
  if (apiKeyInput) {
    apiKeyInput.value = "";
    apiKeyInput.placeholder = "输入 API Key";
  }
  if (storageSelect) {
    storageSelect.value = getDefaultApiKeyStorageMode();
  }
  if (envInput) {
    envInput.value = "";
  }
  if (keepExistingInput) {
    keepExistingInput.value = "false";
  }
  if (existingRefInput) {
    existingRefInput.value = "";
  }
  handleApiKeyStorageModeChange();
}

// 测试模型连接
async function testModelConnection() {
  const testBtn = document.getElementById("test-model-btn");
  const modelId = document.getElementById("model-id").value.trim();
  const providerName = document.getElementById("provider-name").value.trim();
  const baseUrl = document.getElementById("base-url").value.trim();
  const apiKey = document.getElementById("api-key").value.trim();
  const apiProtocol = document.getElementById("api-protocol").value;
  const apiType = document.getElementById("api-type")?.value || "";
  const storageMode = document.getElementById("api-key-storage-mode")?.value || getDefaultApiKeyStorageMode();
  const apiKeyEnvVar = document.getElementById("api-key-env-var")?.value.trim() || "";
  const existingRefText = document.getElementById("existing-api-key-ref")?.value.trim() || "";
  const envVarPattern = /^[A-Z_][A-Z0-9_]*$/;
  const hasExistingRef = !!existingRefText;
  const legacySecretRefAllowed = canKeepLegacySecretRefInEditMode();
  let apiKeyRef = null;
  if (storageMode === "env" && envVarPattern.test(apiKeyEnvVar)) {
    apiKeyRef = { source: "env", provider: "default", id: apiKeyEnvVar };
  } else if (hasExistingRef) {
    try {
      apiKeyRef = JSON.parse(existingRefText);
    } catch (err) {
      apiKeyRef = null;
    }
  }

  // 验证必填字段
  if (!modelId || !providerName || !baseUrl) {
    showToast("请先填写所有必填字段（模型ID、供应商、Base URL）", "error");
    return;
  }

  if (
    !apiKeyProtectionEnabled &&
    isSecretRefStorageMode(storageMode) &&
    !legacySecretRefAllowed
  ) {
    showToast("当前未开启 API 防护，不能使用 SecretRef 方式测试", "error");
    return;
  }

  if (storageMode === "env" && !envVarPattern.test(apiKeyEnvVar)) {
    showToast("请填写合法的环境变量名（示例：OPENAI_API_KEY）", "error");
    return;
  }
  if (storageMode === "managed-file" && !apiKey && !hasExistingRef) {
    showToast("请填写 API Key，或先保存后再复用已有 SecretRef", "error");
    return;
  }
  if (storageMode === "plaintext" && !apiKey) {
    showToast("明文模式下 API Key 不能为空", "error");
    return;
  }

  // 验证格式
  const modelIdPattern = /^[a-zA-Z0-9._/:-]+$/;
  const providerPattern = /^[a-z-]+$/;

  if (!modelIdPattern.test(modelId)) {
    showToast("模型 ID 格式不正确（仅支持字母、数字、. / : - _）", "error");
    return;
  }
  if (!providerPattern.test(providerName)) {
    showToast("供应商名称格式不正确（仅支持小写字母和连字符）", "error");
    return;
  }

  // 禁用按钮
  testBtn.disabled = true;
  testBtn.className = "btn";
  testBtn.textContent = "测试中...";

  // 保持单一测试对话框，避免重复 ID 导致更新错位
  document.querySelectorAll(".test-modal").forEach((node) => node.remove());

  // 创建测试对话框
  const modal = document.createElement("div");
  modal.className = "test-modal";
  modal.innerHTML = `
    <div class="test-modal-overlay" onclick="this.closest('.test-modal').remove()"></div>
    <div class="test-modal-content">
      <div class="test-modal-header">
        <h3>模型连接测试</h3>
        <button class="test-modal-close" onclick="this.closest('.test-modal').remove()">×</button>
      </div>
      <div class="test-modal-body">
        <div class="test-section">
          <div class="test-label">请求方法</div>
          <div class="test-endpoint" id="test-method">POST</div>
        </div>
        <div class="test-section">
          <div class="test-label">测试端点</div>
          <div class="test-endpoint" id="test-endpoint">构造中...</div>
        </div>
        <div class="test-section">
          <div class="test-label">请求命令</div>
          <div class="test-command" id="test-command">正在构造请求...</div>
        </div>
        <div class="test-section">
          <div class="test-label">响应结果</div>
          <div class="test-response" id="test-response">等待响应...</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const methodEl = modal.querySelector("#test-method");
  const endpointEl = modal.querySelector("#test-endpoint");
  const commandEl = modal.querySelector("#test-command");

  function normalizeTestBaseUrl(rawBaseUrl, protocol) {
    let normalized = String(rawBaseUrl || "").trim().replace(/\/+$/, "");
    if (protocol === "anthropic") {
      normalized = normalized.replace(/\/v1\/messages$/i, "");
      normalized = normalized.replace(/\/v1$/i, "");
      return normalized;
    }
    normalized = normalized.replace(/\/chat\/completions$/i, "");
    normalized = normalized.replace(/\/responses$/i, "");
    return normalized;
  }

  function resolveOpenAiEndpointSuffix(type) {
    const value = String(type || "").trim().toLowerCase();
    if (value === "openai-responses" || value === "openai-codex-responses") {
      return "/responses";
    }
    return "/chat/completions";
  }

  // 立即显示协议类型和端点（不等待网络）
  const protocol = (apiProtocol || providerName).toLowerCase();
  const endpointSuffix = protocol === "anthropic"
    ? "/v1/messages"
    : resolveOpenAiEndpointSuffix(apiType);
  const protocolName = protocol === "anthropic"
    ? "Anthropic Messages API"
    : endpointSuffix === "/responses"
      ? "OpenAI Responses API"
      : "OpenAI Chat Completions API";
  const normalizedBaseUrl = normalizeTestBaseUrl(baseUrl, protocol);
  const endpoint = `${normalizedBaseUrl}${endpointSuffix}`;

  if (methodEl) {
    methodEl.textContent = `POST (${protocolName})`;
  }
  if (endpointEl) {
    endpointEl.textContent = endpoint;
  }

  // 立即显示基础 curl 命令（不含 API Key）
  const basicCurl = protocol === "anthropic"
    ? `curl -X POST ${endpoint} \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "content-type: application/json"`
    : `curl -X POST ${endpoint} \\\n  -H "content-type: application/json"`;
  if (commandEl) {
    commandEl.textContent = basicCurl;
  }

  try {
    const result = await apiRequest("/models/test", {
      method: "POST",
      body: JSON.stringify({
        providerName,
        modelId,
        baseUrl,
        apiKey,
        apiKeyRef,
        apiKeyStorageMode: storageMode,
        apiKeyEnvVar,
        apiProtocol,
        apiType,
      }),
    });

    // 更新完整 curl 命令（含脱敏 API Key）
    if (result.curlCommand && commandEl) {
      commandEl.textContent = result.curlCommand;
    }
    const responseEl = modal.querySelector("#test-response");

    if (result.success) {
      if (responseEl) {
        responseEl.className = "test-response success";
        // 格式化 JSON 响应
        try {
          const json = JSON.parse(result.response);
          responseEl.textContent = JSON.stringify(json, null, 2);
        } catch (e) {
          responseEl.textContent = result.response || "测试成功";
        }
      }
      testBtn.className = "btn success";
      testBtn.textContent = "测试成功 ✓";
      showToast("模型连接测试成功", "success");
    } else {
      // 尝试解析并格式化错误信息
      let errorMsg = result.response || "测试失败";
      try {
        const errorJson = JSON.parse(result.response);
        // 提取友好的错误信息
        if (errorJson.error?.message) {
          errorMsg = `错误: ${errorJson.error.message}\n\n完整响应:\n${JSON.stringify(errorJson, null, 2)}`;
        } else if (errorJson.message) {
          errorMsg = `错误: ${errorJson.message}\n\n完整响应:\n${JSON.stringify(errorJson, null, 2)}`;
        } else {
          errorMsg = JSON.stringify(errorJson, null, 2);
        }
      } catch (e) {
        // 保持原始错误信息
      }
      if (responseEl) {
        responseEl.className = "test-response error";
        responseEl.textContent = errorMsg;
      }
      testBtn.className = "btn error";
      testBtn.textContent = "测试失败 ✗";
      showToast("模型连接测试失败", "error");
    }

  } catch (error) {
    const responseEl = modal.querySelector("#test-response");
    if (responseEl) {
      responseEl.className = "test-response error";
      responseEl.textContent = error.message || "请求失败";
    }
    testBtn.className = "btn error";
    testBtn.textContent = "测试失败 ✗";
    showToast("测试请求失败: " + error.message, "error");
  } finally {
    testBtn.disabled = false;
  }
}

// ============================================================================
// 版本管理
// ============================================================================

function getApiKeyProtectionSourceLabel(source) {
  switch (source) {
    case "file":
      return "WebUI 设置";
    case "default":
    default:
      return "默认值（关闭）";
  }
}

function getApiKeyProtectionNote(enabled) {
  return enabled
    ? "当前已开启 API 防护。新建模型默认写入 SecretRef（受管密钥文件）。再次切换策略会清空全部模型配置。"
    : "当前为明文默认模式。新建模型默认会把 API Key 写入 openclaw.json。切换策略会清空全部模型配置。";
}

function updateApiKeyProtectionBadge(enabled) {
  const badge = document.getElementById("api-protection-state-badge");
  if (!badge) return;

  badge.classList.remove("access-state-local", "access-state-remote");
  if (enabled) {
    badge.classList.add("access-state-remote");
    badge.textContent = "防护开启";
  } else {
    badge.classList.add("access-state-local");
    badge.textContent = "明文模式";
  }
}

function updateApiKeyProtectionToggle(enabled) {
  const checkbox = document.getElementById("api-protection-enabled");
  const toggleSwitch = document.getElementById("api-protection-switch");

  if (checkbox) {
    checkbox.checked = enabled === true;
  }
  if (!toggleSwitch) {
    return;
  }

  toggleSwitch.classList.toggle("active", enabled === true);
  toggleSwitch.dataset.enabled = enabled === true ? "true" : "false";
  toggleSwitch.setAttribute("aria-checked", enabled === true ? "true" : "false");
  toggleSwitch.setAttribute("aria-pressed", enabled === true ? "true" : "false");
  toggleSwitch.title = enabled === true
    ? "当前已开启 API 防护，点击切换为明文默认"
    : "当前为明文默认，点击切换为 SecretRef 默认";
}

function initApiKeyProtectionToggleControl() {
  const checkbox = document.getElementById("api-protection-enabled");
  const toggleSwitch = document.getElementById("api-protection-switch");
  if (!checkbox || !toggleSwitch) {
    return;
  }

  const toggleHandler = () => {
    if (toggleSwitch.disabled) {
      return;
    }
    updateApiKeyProtectionToggle(!checkbox.checked);
  };

  toggleSwitch.addEventListener("click", toggleHandler);
  toggleSwitch.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }
    e.preventDefault();
    toggleHandler();
  });
}

async function loadApiKeyProtectionSettings() {
  try {
    const result = await apiRequest("/security/api-key-protection");
    const checkbox = document.getElementById("api-protection-enabled");
    const toggleSwitch = document.getElementById("api-protection-switch");
    const saveBtn = document.getElementById("api-protection-save-btn");
    const sourceEl = document.getElementById("api-protection-source");
    const fileEl = document.getElementById("api-protection-file");
    const noteEl = document.getElementById("api-protection-note");

    apiKeyProtectionEnabled = result.enabled === true;

    if (checkbox) checkbox.disabled = false;
    if (toggleSwitch) toggleSwitch.disabled = false;
    if (saveBtn) saveBtn.disabled = false;

    updateApiKeyProtectionToggle(apiKeyProtectionEnabled);
    updateApiKeyProtectionBadge(apiKeyProtectionEnabled);

    if (sourceEl) {
      sourceEl.textContent = getApiKeyProtectionSourceLabel(result.source);
    }
    if (fileEl) {
      fileEl.textContent = result.file || "-";
    }
    if (noteEl) {
      noteEl.textContent = getApiKeyProtectionNote(apiKeyProtectionEnabled);
    }

    applyDefaultApiKeyStorageMode();
  } catch (error) {
    console.error("加载 API 防护设置失败:", error);
  }
}

async function saveApiKeyProtectionSettings() {
  const checkbox = document.getElementById("api-protection-enabled");
  const noteEl = document.getElementById("api-protection-note");
  if (!checkbox) {
    showToast("未找到 API 防护控件", "error");
    return;
  }

  const enabled = checkbox.checked === true;
  const previousEnabled = apiKeyProtectionEnabled === true;
  if (enabled === previousEnabled) {
    showToast("API 防护状态未变化", "info");
    return;
  }

  const confirmMessage = enabled
    ? "开启 API 防护后会立即清空当前所有模型配置（包括供应商、模型列表和主模型绑定），并需要你重新配置模型。是否继续？"
    : "关闭 API 防护并切回明文模式后，会立即清空当前所有模型配置，并需要你重新配置模型。是否继续？";
  if (!confirm(confirmMessage)) {
    updateApiKeyProtectionToggle(previousEnabled);
    return;
  }

  try {
    const result = await apiRequest("/security/api-key-protection", {
      method: "POST",
      body: JSON.stringify({
        enabled,
        confirmReset: true,
      }),
    });

    apiKeyProtectionEnabled = result.enabled === true;
    updateApiKeyProtectionToggle(apiKeyProtectionEnabled);
    updateApiKeyProtectionBadge(apiKeyProtectionEnabled);

    const sourceEl = document.getElementById("api-protection-source");
    if (sourceEl) {
      sourceEl.textContent = getApiKeyProtectionSourceLabel(result.source);
    }
    const fileEl = document.getElementById("api-protection-file");
    if (fileEl) {
      fileEl.textContent = result.file || "-";
    }
    if (noteEl) {
      noteEl.textContent = getApiKeyProtectionNote(apiKeyProtectionEnabled);
    }

    applyDefaultApiKeyStorageMode();
    await Promise.all([
      loadModelsList(),
      loadConfigSummary(),
    ]);

    const clearedModels = result?.modelsReset?.modelsCleared || 0;
    showToast(
      apiKeyProtectionEnabled
        ? `已开启 API 防护，已清空 ${clearedModels} 个模型，请重新配置`
        : `已切换为明文默认，已清空 ${clearedModels} 个模型，请重新配置`,
      "success",
    );
  } catch (error) {
    updateApiKeyProtectionToggle(previousEnabled);
    showToast("保存 API 防护设置失败: " + error.message, "error");
  }
}

function getManagementAccessSourceLabel(source) {
  switch (source) {
    case "file":
      return "WebUI 设置";
    case "default":
    default:
      return "默认值（远程可访问）";
  }
}

function updateManagementAccessBadge(allowRemote) {
  const badge = document.getElementById("management-access-state-badge");
  if (!badge) return;

  badge.classList.remove("access-state-local", "access-state-remote");
  if (allowRemote) {
    badge.classList.add("access-state-remote");
    badge.textContent = "远程可访问";
  } else {
    badge.classList.add("access-state-local");
    badge.textContent = "仅本机";
  }
}

function updateManagementAccessToggle(allowRemote) {
  const checkbox = document.getElementById("management-allow-remote");
  const toggleSwitch = document.getElementById("management-allow-remote-switch");

  if (checkbox) {
    checkbox.checked = allowRemote === true;
  }
  if (!toggleSwitch) {
    return;
  }

  toggleSwitch.classList.toggle("active", allowRemote === true);
  toggleSwitch.dataset.enabled = allowRemote === true ? "true" : "false";
  toggleSwitch.setAttribute("aria-checked", allowRemote === true ? "true" : "false");
  toggleSwitch.setAttribute("aria-pressed", allowRemote === true ? "true" : "false");
  toggleSwitch.title = allowRemote === true
    ? "当前已开启远程访问，点击切换为仅本机访问"
    : "当前仅本机访问，点击切换为远程可访问";
}

function initManagementAccessToggleControl() {
  const checkbox = document.getElementById("management-allow-remote");
  const toggleSwitch = document.getElementById("management-allow-remote-switch");
  if (!checkbox || !toggleSwitch) {
    return;
  }

  const toggleHandler = () => {
    if (toggleSwitch.disabled) {
      return;
    }
    updateManagementAccessToggle(!checkbox.checked);
  };

  toggleSwitch.addEventListener("click", toggleHandler);
  toggleSwitch.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }
    e.preventDefault();
    toggleHandler();
  });
}

async function loadManagementAccessSettings() {
  try {
    const result = await apiRequest("/management/access");
    const checkbox = document.getElementById("management-allow-remote");
    const toggleSwitch = document.getElementById("management-allow-remote-switch");
    const saveBtn = document.getElementById("management-access-save-btn");
    const sourceEl = document.getElementById("management-access-source");
    const fileEl = document.getElementById("management-access-file");
    const noteEl = document.getElementById("management-access-note");

    if (checkbox) checkbox.disabled = false;
    if (toggleSwitch) toggleSwitch.disabled = false;
    updateManagementAccessToggle(!!result.allowRemote);
    if (saveBtn) {
      saveBtn.disabled = false;
    }
    if (sourceEl) {
      sourceEl.textContent = getManagementAccessSourceLabel(result.source);
    }
    if (fileEl) {
      fileEl.textContent = result.file || "-";
    }
    if (noteEl) {
      noteEl.textContent = result.allowRemote
        ? "当前为远程可访问模式。请确认网络边界已加固。"
        : "当前为仅本机访问模式。";
    }
    updateManagementAccessBadge(!!result.allowRemote);
  } catch (error) {
    console.error("加载管理访问设置失败:", error);
  }
}

async function saveManagementAccessSettings() {
  const checkbox = document.getElementById("management-allow-remote");
  const noteEl = document.getElementById("management-access-note");
  if (!checkbox) {
    showToast("未找到访问设置控件", "error");
    return;
  }

  const allowRemote = checkbox.checked === true;
  if (allowRemote) {
    const confirmed = confirm(
      "开启远程访问后，局域网设备可能直接调用管理 API。\n请确认网络环境可信。\n\n确定继续吗？",
    );
    if (!confirmed) {
      return;
    }
  }

  try {
    const result = await apiRequest("/management/access", {
      method: "POST",
      body: JSON.stringify({ allowRemote }),
    });
    const sourceEl = document.getElementById("management-access-source");
    if (sourceEl) {
      sourceEl.textContent = getManagementAccessSourceLabel(result.source);
    }
    const fileEl = document.getElementById("management-access-file");
    if (fileEl) {
      fileEl.textContent = result.file || "-";
    }
    if (noteEl) {
      noteEl.textContent = allowRemote
        ? "当前为远程可访问模式。请确认网络边界已加固。"
        : "当前为仅本机访问模式。";
    }
    updateManagementAccessBadge(allowRemote);
    showToast(
      allowRemote ? "已启用远程访问" : "已切换为仅本机访问",
      "success",
    );
    await loadManagementAccessSettings();
  } catch (error) {
    showToast("保存访问设置失败: " + error.message, "error");
  }
}

async function loadToolProfiles() {
  try {
    const config = await apiRequest("/config");
    const toolProfiles = config?.tools?.profile || "full";
    document.getElementById("tool-profiles").value = toolProfiles;
  } catch (error) {
    console.error("加载 Tool Profiles 失败:", error);
  }
}

async function saveToolProfiles() {
  try {
    const value = document.getElementById("tool-profiles").value;
    const config = await apiRequest("/config");

    config.tools = config.tools || {};
    config.tools.profile = value;

    await apiRequest("/config", { method: "POST", body: JSON.stringify(config) });
    showToast("Tool Profiles 已更新为: " + value, "success");
  } catch (error) {
    showToast("保存失败: " + error.message, "error");
  }
}

// ============================================================================

async function loadVersionInfo() {
  try {
    const current = await apiRequest("/version/current");
    document.getElementById("ver-current").textContent = current.version;
    document.getElementById("ver-latest").textContent = "检查中...";
    document.getElementById("ver-status").textContent = "检查中...";

    // 自动检查最新版本
    await checkUpdate();
  } catch (error) {
    showToast("加载版本信息失败: " + error.message, "error");
  }
}

async function checkUpdate() {
  try {
    showToast("正在检查更新...", "info");

    const latest = await apiRequest("/version/latest");

    document.getElementById("ver-latest").textContent = latest.version;

    if (latest.available) {
      document.getElementById("ver-status").textContent = "有新版本可用";
      document.getElementById("update-btn").disabled = false;
      showToast("发现新版本: " + latest.version, "success");
    } else {
      document.getElementById("ver-status").textContent = "已是最新版本";
      document.getElementById("update-btn").disabled = true;
      showToast("当前已是最新版本", "success");
    }
  } catch (error) {
    showToast("检查更新失败: " + error.message, "error");
  }
}

async function updateVersion() {
  const message =
    "确定要更新 OpenClaw 到最新版本吗？\n\n" +
    "升级过程将执行以下操作：\n" +
    "1. 停止 Gateway 服务\n" +
    "2. 通过 npm 安装最新版本\n" +
    "3. 重启 Gateway 服务\n\n" +
    "整个过程大约需要 1-2 分钟，期间服务将暂时不可用。";

  if (!confirm(message)) {
    return;
  }

  try {
    showToast("正在更新版本...", "info");
    const result = await apiRequest("/version/update", { method: "POST" });

    if (result.success) {
      showToast("更新成功！", "success");
      setTimeout(() => location.reload(), 2000);
    } else {
      showToast(result.message || "更新失败", "warning");
    }
  } catch (error) {
    showToast("更新失败: " + error.message, "error");
  }
}

// ============================================================================
// 原生控制面板
// ============================================================================

async function loadConsoleInfo() {
  try {
    const info = await apiRequest("/console/url");

    document.getElementById("console-url").textContent = info.url;
    document.getElementById("console-token").textContent =
      info.token || "(未设置)";

    // 加载日志
    refreshLogs();
  } catch (error) {
    showToast("加载原生控制面板信息失败: " + error.message, "error");
  }
}

async function openConsole() {
  try {
    const info = await apiRequest("/console/url");

    if (!info || !info.url) {
      showToast("获取原生控制面板地址失败，尝试直接打开...", "warning");
      window.location.href = "/dashboard/";
      return;
    }

    if (!info.token) {
      showToast(
        "未检测到网关令牌，打开原生控制面板可能需要手动填写",
        "warning",
      );
    }

    // 通过 Management API 代理打开，并尽量在 URL 上携带 token
    window.location.href = info.url;
  } catch (error) {
    showToast("打开原生控制面板失败: " + error.message, "error");
  }
}

async function refreshLogs() {
  try {
    const result = await apiRequest("/logs?lines=100");
    const logContent = document.getElementById("log-content");
    logContent.textContent = result.logs || "(暂无日志)";

    // 滚动到底部
    logContent.scrollTop = logContent.scrollHeight;
  } catch (error) {
    document.getElementById("log-content").textContent =
      "加载日志失败: " + error.message;
  }
}

// ============================================================================
// 技能管理
// ============================================================================

const installedSkillSlugs = new Set();

function normalizeSkillSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

function isSkillInstalled(slug) {
  return installedSkillSlugs.has(normalizeSkillSlug(slug));
}

function syncInstalledSkillSlugs(skills = []) {
  installedSkillSlugs.clear();
  for (const skill of skills) {
    if (skill?.location !== "user" || skill?.exists !== true) {
      continue;
    }
    const normalized = normalizeSkillSlug(skill.slug);
    if (normalized) {
      installedSkillSlugs.add(normalized);
    }
  }
}

async function refreshInstalledSkillSlugs() {
  try {
    const result = await apiRequest("/skills/list");
    if (result?.success && Array.isArray(result.skills)) {
      syncInstalledSkillSlugs(result.skills);
    }
  } catch (err) {
    console.warn("获取已安装技能列表失败:", err);
  }
}

function updateSearchInstallButtons() {
  const container = document.getElementById("skills-search-results");
  if (!container) return;

  container.querySelectorAll('button[data-action="install"]').forEach((btn) => {
    const installed = isSkillInstalled(btn.dataset.slug);
    btn.disabled = installed;
    btn.textContent = installed ? "已安装" : "安装";
    btn.classList.toggle("btn-primary", !installed);
    btn.classList.toggle("btn-ghost", installed);
    btn.setAttribute("aria-disabled", installed ? "true" : "false");
  });
}

async function searchSkills() {
  const query = document.getElementById("skills-search-input").value.trim();
  if (!query) {
    showToast("请输入搜索关键词", "warning");
    return;
  }

  try {
    const [result] = await Promise.all([
      apiRequest(`/skills/search?q=${encodeURIComponent(query)}`),
      refreshInstalledSkillSlugs(),
    ]);
    const container = document.getElementById("skills-search-results");

    if (!result.success || !result.skills || result.skills.length === 0) {
      container.innerHTML = '<p class="empty-state">未找到相关技能</p>';
      return;
    }

    container.innerHTML = '<div class="skills-grid">' + result.skills.map(skill => {
      const displayName = skill.displayName || skill.name || skill.slug;
      const summary = skill.summary || skill.description || '';
      const version = skill.version || '';
      const updatedAt = skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString('zh-CN') : '';
      const score = skill.score ? Math.min(100, Math.round(skill.score * 500)) : 0;
      const installed = isSkillInstalled(skill.slug);

      return `
      <div class="skill-card">
        <div class="skill-card-header">
          <h4 class="skill-card-title">${escapeHtml(displayName)}</h4>
          ${score > 0 ? `<div class="skill-badges"><span class="skill-badge" style="background: var(--success); color: white;">${score}% 匹配</span></div>` : ''}
        </div>

        <div class="skill-card-meta">
          <div class="skill-card-slug">${escapeHtml(skill.slug)}</div>
          ${summary ? `<p class="skill-card-description">${escapeHtml(summary)}</p>` : ''}
          <div class="skill-card-stats">
            ${version ? `<span class="skill-card-stat">v${escapeHtml(version)}</span>` : ''}
            ${updatedAt ? `<span class="skill-card-stat">更新于 ${updatedAt}</span>` : ''}
          </div>
        </div>

        <div class="skill-card-footer">
          <button class="btn ${installed ? "btn-ghost" : "btn-primary"} btn-sm" data-slug="${escapeHtml(skill.slug)}" data-action="install" style="width: 100%;" ${installed ? "disabled aria-disabled=\"true\"" : ""}>${installed ? "已安装" : "安装"}</button>
        </div>
      </div>
      `;
    }).join('') + '</div>';

    // 事件委托：为安装按钮绑定事件
    container.querySelectorAll('button[data-action="install"]').forEach(btn => {
      btn.addEventListener('click', () => installSkill(btn.dataset.slug));
    });
  } catch (err) {
    showToast(`搜索失败: ${err.message}`, "error");
  }
}

async function installSkill(slug, force = false) {
  try {
    const result = await apiRequest("/skills/install", { method: "POST", body: JSON.stringify({ slug, force }) });
    if (result.success) {
      installedSkillSlugs.add(normalizeSkillSlug(slug));
      updateSearchInstallButtons();
      showToast(result.message || `技能 ${slug} 安装成功`, "success");
      await loadInstalledSkills();
    } else {
      if (String(result.error || "").includes("已安装")) {
        installedSkillSlugs.add(normalizeSkillSlug(slug));
        updateSearchInstallButtons();
      }
      showToast(result.error || "安装失败", "error");
    }
  } catch (err) {
    showToast(`安装失败: ${err.message}`, "error");
  }
}

async function loadInstalledSkills() {
  try {
    const result = await apiRequest("/skills/list");
    const container = document.getElementById("skills-installed-list");
    const skills = Array.isArray(result?.skills) ? result.skills : [];
    syncInstalledSkillSlugs(skills);
    updateSearchInstallButtons();

    if (!result.success || skills.length === 0) {
      container.innerHTML = '<p class="empty-state">暂无已安装技能</p>';
      return;
    }

    const userSkills = skills.filter((s) => s.location === "user");
    const builtinSkills = skills.filter((s) => s.location === "builtin");

    let html = "";

    if (userSkills.length > 0) {
      html += `
        <div class="skills-section-header">
          <h3>用户安装的技能</h3>
          <button id="skills-update-all-btn" class="btn btn-secondary btn-sm">更新全部用户技能</button>
        </div>
      `;
      html += '<div class="skills-grid">';
      html += userSkills.map((skill) => renderSkillCard(skill)).join("");
      html += "</div>";
    }

    if (builtinSkills.length > 0) {
      html += `
        <div class="skills-section-header" style="margin-top: 30px;">
          <h3>内置技能</h3>
        </div>
      `;
      html += '<div class="skills-grid">';
      html += builtinSkills.map((skill) => renderSkillCard(skill)).join("");
      html += "</div>";
    }

    container.innerHTML = html;

    // Bind events
    bindSkillCardEvents();
  } catch (err) {
    showToast(`加载失败: ${err.message}`, "error");
  }
}

function renderSkillCard(skill) {
  const isBuiltin = skill.location === "builtin";
  const requiresApi = skill.requiresApi || false;
  const enabled = skill.enabled !== false;
  const entryKey = skill.entryKey || skill.name || skill.slug;
  const showsEntryKey = entryKey && entryKey !== skill.slug;

  return `
    <div class="skill-card" data-slug="${escapeHtml(skill.slug)}">
      <div class="skill-card-header">
        <h4 class="skill-card-title">${escapeHtml(skill.name)}</h4>
        <div class="skill-badges">
          ${isBuiltin ? '<span class="skill-badge builtin">内置</span>' : '<span class="skill-badge user">用户</span>'}
          ${requiresApi ? '<span class="skill-badge api-required">需要 API</span>' : ''}
          ${!skill.exists ? '<span class="skill-badge" style="background: var(--danger); color: white;">缺失</span>' : ''}
        </div>
      </div>

      <div class="skill-card-meta">
        <div class="skill-card-slug">${escapeHtml(skill.slug)}</div>
        ${showsEntryKey ? `<div style="font-size: 0.8rem; color: var(--text-light);">skillKey: <code>${escapeHtml(entryKey)}</code></div>` : ""}
        ${skill.description ? `<p class="skill-card-description">${escapeHtml(skill.description)}</p>` : ''}
        ${skill.version ? `<div style="font-size: 0.8rem; color: var(--text-light);">版本: ${escapeHtml(skill.version)}</div>` : ''}
        ${skill.installed_at ? `<div style="font-size: 0.8rem; color: var(--text-light);">安装时间: ${new Date(skill.installed_at).toLocaleDateString('zh-CN')}</div>` : ''}
      </div>

      <div class="skill-card-footer">
        <div class="skill-toggle">
          <span class="skill-toggle-status ${enabled ? "enabled" : "disabled"}">
            ${enabled ? "已启用" : "已禁用"}
          </span>
          <button
            class="toggle-switch ${enabled ? "active" : ""}"
            data-action="toggle-skill"
            data-slug="${escapeHtml(skill.slug)}"
            data-entry-key="${escapeHtml(entryKey)}"
            data-location="${escapeHtml(skill.location || "")}"
            data-enabled="${enabled ? "true" : "false"}"
            title="${enabled ? "点击禁用技能" : "点击启用技能"}"
            aria-label="${enabled ? "禁用技能" : "启用技能"}"
            aria-pressed="${enabled ? "true" : "false"}"
            type="button"
          ></button>
        </div>
        ${isBuiltin
    ? '<span style="font-size: 0.85rem; color: var(--text-light);">内置技能</span>'
    : `
          <div class="skill-actions">
            <button class="btn btn-secondary btn-sm" data-action="update-skill" data-slug="${escapeHtml(skill.slug)}">更新</button>
            <button class="btn btn-danger btn-sm" data-action="uninstall" data-slug="${escapeHtml(skill.slug)}">卸载</button>
          </div>
        `}
      </div>
    </div>
  `;
}

function bindSkillCardEvents() {
  const updateAllBtn = document.getElementById("skills-update-all-btn");
  if (updateAllBtn) {
    updateAllBtn.addEventListener("click", updateAllSkills);
  }

  document.querySelectorAll('[data-action="toggle-skill"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) {
        return;
      }
      const currentlyEnabled = btn.dataset.enabled === "true";
      btn.disabled = true;
      try {
        await toggleSkillStatus(
          btn.dataset.slug,
          !currentlyEnabled,
          btn.dataset.entryKey,
          btn.dataset.location,
        );
      } finally {
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-action="update-skill"]').forEach((btn) => {
    btn.addEventListener("click", () => updateSkill(btn.dataset.slug));
  });

  // Uninstall buttons
  document.querySelectorAll('[data-action="uninstall"]').forEach((btn) => {
    btn.addEventListener("click", () => uninstallSkill(btn.dataset.slug));
  });
}

async function toggleSkillStatus(slug, enabled, entryKey, location) {
  try {
    const result = await apiRequest("/skills/toggle", {
      method: "POST",
      body: JSON.stringify({
        slug,
        enabled,
        entryKey,
        location,
      }),
    });
    if (result.success) {
      showToast(result.message || `技能 ${slug} 状态已更新`, "success");
      await loadInstalledSkills();
    } else {
      showToast(result.error || "更新技能状态失败", "error");
    }
  } catch (err) {
    showToast(`更新技能状态失败: ${err.message}`, "error");
  }
}

async function updateSkill(slug) {
  try {
    showToast(`正在更新技能 ${slug}...`, "info");
    const result = await apiRequest("/skills/update", {
      method: "POST",
      body: JSON.stringify({ slug }),
    });
    if (result.success) {
      showToast(result.message || `技能 ${slug} 更新成功`, "success");
      await loadInstalledSkills();
    } else {
      showToast(result.error || `技能 ${slug} 更新失败`, "error");
    }
  } catch (err) {
    showToast(`更新失败: ${err.message}`, "error");
  }
}

async function updateAllSkills() {
  if (!confirm("确定要更新全部用户技能吗？")) {
    return;
  }

  try {
    showToast("正在更新全部用户技能...", "info");
    const result = await apiRequest("/skills/update", {
      method: "POST",
      body: JSON.stringify({ all: true }),
    });

    if (result.success) {
      showToast(result.message || "全部用户技能更新完成", "success");
    } else {
      showToast(result.message || result.error || "部分技能更新失败", "warning");
    }
    await loadInstalledSkills();
  } catch (err) {
    showToast(`批量更新失败: ${err.message}`, "error");
  }
}

async function uninstallSkill(slug) {
  if (!confirm(`确定要卸载技能 ${slug} 吗？`)) return;

  try {
    const result = await apiRequest("/skills/uninstall", { method: "POST", body: JSON.stringify({ slug }) });
    if (result.success) {
      showToast(result.message || `技能 ${slug} 已卸载`, "success");
      await loadInstalledSkills();
    } else {
      showToast(result.error || "卸载失败", "error");
    }
  } catch (err) {
    showToast(`卸载失败: ${err.message}`, "error");
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  console.log("OpenClaw Management Console 初始化...");

  // 不再在初始化时加载 Ace Editor，改为按需加载
  // Ace Editor 将在用户首次点击"配置编辑"标签页时加载

  // 添加 Ctrl+S / Cmd+S 快捷键保存配置
  document.addEventListener("keydown", (e) => {
    // 检查是否按下 Ctrl+S (Windows/Linux) 或 Cmd+S (Mac)
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault(); // 阻止浏览器默认保存行为

      // 仅在“配置”标签页触发
      if (currentTabName === "config") {
        saveConfig();
        showToast("正在保存配置... (Ctrl+S)", "info");
      }
    }
  });

  // 初始化 textarea 的 input 事件监听器（用于实时验证）
  const refs = window.domRefs;
  const textarea = refs?.config.editorTextarea || document.getElementById("config-editor-textarea");
  if (textarea) {
    textarea.addEventListener("input", validateConfigInput);
  }

  // 初始化 DOM 引用缓存
  if (window.initDomRefs) {
    window.initDomRefs();
  }

  // 初始化标签页
  initTabs();
  initTooltips();
  initManagementAccessToggleControl();
  initApiKeyProtectionToggleControl();

  // Skills 事件绑定
  const skillsSearchBtn = refs?.skills.searchBtn || document.getElementById("skills-search-btn");
  const skillsSearchInput = refs?.skills.searchInput || document.getElementById("skills-search-input");
  const skillsRefreshBtn = refs?.skills.refreshBtn || document.getElementById("skills-refresh-btn");

  if (skillsSearchBtn) {
    skillsSearchBtn.addEventListener("click", searchSkills);
  }

  // 回车键触发搜索
  if (skillsSearchInput) {
    skillsSearchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        searchSkills();
      }
    });

    // 实时动态搜索（防抖 500ms）
    let searchTimeout;
    skillsSearchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      const query = skillsSearchInput.value.trim();
      if (query.length > 0) {
        searchTimeout = setTimeout(() => {
          searchSkills();
        }, 500);
      } else {
        document.getElementById("skills-search-results").innerHTML = "";
      }
    });
  }

  if (skillsRefreshBtn) {
    skillsRefreshBtn.addEventListener("click", loadInstalledSkills);
  }

  // 定时刷新状态（每 5 秒）
  setInterval(() => {
    if (currentTabName === "overview") {
      refreshDashboard();
    }
  }, 5000);

  // 监听供应商选择，自动填充 Base URL
  const providerInput = document.getElementById("provider-name");
  const baseUrlInput = document.getElementById("base-url");
  const modelIdInput = document.getElementById("model-id");

  if (providerInput && baseUrlInput) {
    providerInput.addEventListener("input", () => {
      providerInput.setCustomValidity("");
      const provider = providerInput.value.toLowerCase();
      if (PROVIDER_BASE_URLS[provider]) {
        baseUrlInput.value = PROVIDER_BASE_URLS[provider];
      }

      // 根据供应商自动设置 API 协议
      const protocol = provider === "anthropic" ? "anthropic" : "openai";
      const protocolSelect = document.getElementById("api-protocol");
      if (protocolSelect) {
        protocolSelect.value = protocol;
        updateApiTypeOptions(protocol);
      }
    });
  }

  if (modelIdInput) {
    modelIdInput.addEventListener("input", () => {
      modelIdInput.setCustomValidity("");
    });
  }

  // 初始化 API 类型下拉框（默认 openai）
  updateApiTypeOptions("openai");
  const storageSelect = document.getElementById("api-key-storage-mode");
  if (storageSelect) {
    storageSelect.addEventListener("change", handleApiKeyStorageModeChange);
  }
  applyDefaultApiKeyStorageMode();
  loadApiKeyProtectionSettings();

  console.log("初始化完成");
});
