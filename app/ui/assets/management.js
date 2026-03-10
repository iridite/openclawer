// OpenClaw Management Console JavaScript

// API 基础 URL
const API_BASE = "/api";

// 全局状态
let currentConfig = null;
let currentStatus = null;
let aceEditor = null; // Ace Editor 实例
let editorMode = "textarea"; // 编辑器模式：'ace' 或 'textarea'（默认 textarea）
let aceEditorLoaded = false; // Ace Editor 是否已加载
let aceEditorLoading = false; // Ace Editor 是否正在加载
let activeTooltipTarget = null;
let currentTabName = "overview";
let qqbotPluginInstalling = false;

// 快速添加模型预设
const QUICK_ADD_MODELS = {
  "claude-sonnet-4-5": {
    modelId: "claude-sonnet-4-5",
    providerName: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiProtocol: "anthropic",
    apiType: "anthropic-messages",
    advanced: {
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
  },
  "qwen-plus": {
    modelId: "qwen-plus",
    providerName: "bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiProtocol: "openai",
    apiType: "openai-completions",
    advanced: {
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 131072,
      maxTokens: 8192,
    },
  },
  "glm4.7": {
    modelId: "glm4.7",
    providerName: "zai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiProtocol: "openai",
    apiType: "openai-completions",
    advanced: {
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
  },
};

// ============================================================================
// Ace Editor 动态加载
// ============================================================================

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
    // 加载 Ace Editor 核心库
    await loadScript("https://cdn.bootcdn.net/ajax/libs/ace/1.32.2/ace.js");

    // 加载 JSON 模式和主题
    await Promise.all([
      loadScript("https://cdn.bootcdn.net/ajax/libs/ace/1.32.2/mode-json.js"),
      loadScript(
        "https://cdn.bootcdn.net/ajax/libs/ace/1.32.2/theme-monokai.js",
      ),
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

// 加载单个脚本
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
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
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

// API 请求封装
async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(API_BASE + endpoint, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "请求失败");
    }

    return data;
  } catch (error) {
    console.error("API 请求失败:", error);
    throw error;
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
    icon.addEventListener("mouseenter", () => showTooltip(icon));
    icon.addEventListener("mouseleave", () => hideTooltip(icon));
    icon.addEventListener("focus", () => showTooltip(icon));
    icon.addEventListener("blur", () => hideTooltip(icon));
  });

  window.addEventListener("resize", refreshTooltipPosition);
  document.addEventListener("scroll", refreshTooltipPosition, true);
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
    case "system":
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
    document.getElementById("dash-gateway-status").textContent =
      gatewayStatusText + gatewayPidText;

    // Proxy 状态：显示状态 + PID
    const proxyStatusText = status.proxy === "running" ? "运行中" : "已停止";
    const proxyPidText = status.proxyPid ? ` (PID: ${status.proxyPid})` : "";
    document.getElementById("dash-proxy-status").textContent =
      proxyStatusText + proxyPidText;

    document.getElementById("dash-version").textContent =
      status.version || "unknown";
    document.getElementById("dash-config-status").textContent =
      status.configExists ? "已配置" : "未配置";

    // 更新系统资源信息
    if (status.system) {
      document.getElementById("dash-cpu-usage").textContent =
        status.system.cpuUsage !== undefined
          ? `${status.system.cpuUsage.toFixed(1)}%`
          : "N/A";

      // 显示内存使用：百分比 + MB 数值（小字）
      const memoryEl = document.getElementById("dash-memory-usage");
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
    let models = {};
    if (config.models && config.models.providers) {
      models = config.models.providers;
    }

    const modelCount = Object.keys(models).length;
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
      for (const [name, model] of Object.entries(models)) {
        const provider = name; // provider 名称就是 key
        const hasKey = model.apiKey ? "已配置" : "未配置";
        const baseUrl = model.baseURL || model.baseUrl || "";
        const urlHint = baseUrl ? ` - ${baseUrl.split("/")[2] || baseUrl}` : "";
        html += `<li><code>${provider}</code>${urlHint} ${hasKey}</li>`;
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
  const badge = document.getElementById("gatewayStatus");
  const statusText = badge.querySelector(".status-text");

  badge.className = "status-badge";

  // 获取按钮元素
  const startBtn = document.getElementById("start-gateway-btn");
  const stopBtn = document.getElementById("stop-gateway-btn");

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

// 供应商 Base URL 映射
const PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  bailian: "https://coding.dashscope.aliyuncs.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
};

// API 类型选项（OpenClaw 支持的所有 API 类型）
const API_TYPES = {
  openai: [
    { value: "openai-completions", label: "OpenAI Completions", default: true },
    { value: "openai-responses", label: "OpenAI Responses" },
    { value: "openai-codex-responses", label: "OpenAI Codex Responses" },
  ],
  anthropic: [
    { value: "anthropic-messages", label: "Anthropic Messages", default: true },
  ],
  google: [
    {
      value: "google-generative-ai",
      label: "Google Generative AI",
      default: true,
    },
  ],
  github: [{ value: "github-copilot", label: "GitHub Copilot", default: true }],
  bedrock: [
    {
      value: "bedrock-converse-stream",
      label: "Bedrock Converse Stream",
      default: true,
    },
  ],
  ollama: [{ value: "ollama", label: "Ollama", default: true }],
};

// 渲染快速添加按钮
function renderQuickAddButtons() {
  const container = document.getElementById("quick-add-grid");
  if (!container) return;

  let html = "";
  for (const [modelId, modelData] of Object.entries(QUICK_ADD_MODELS)) {
    html += `
      <button class="quick-add-btn" data-model-id="${modelId}">
        <span class="provider-name">${modelData.providerName}</span>
        <span class="model-name">${modelId}</span>
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
  if (apiValue === "google-ai") return "google-ai";
  if (apiValue === "github") return "github";
  if (apiValue === "bedrock") return "bedrock";
  if (apiValue.startsWith("anthropic-")) return "anthropic";
  if (apiValue.startsWith("openai-")) return "openai";
  if (apiValue.startsWith("google-")) return "google-ai";
  if (apiValue.startsWith("github-")) return "github";
  if (apiValue.startsWith("bedrock-")) return "bedrock";
  if (apiValue === "ollama") return "ollama";
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
  } else if (protocol === "google-ai") {
    options = API_TYPES.google;
  } else if (protocol === "github") {
    options = API_TYPES.github;
  } else if (protocol === "bedrock") {
    options = API_TYPES.bedrock;
  } else if (protocol === "ollama") {
    options = API_TYPES.ollama;
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
          const apiKey = provider.apiKey || "";
          const hasKey = apiKey ? "已配置" : "未配置";
          const maskedKey = maskApiKey(apiKey);
          const modelId = model.id || model.name;
          const modelKey = `${providerName}/${modelId}`;

          // 判断是否为 primary 模型
          const isPrimary = modelKey === primaryModel;
          const primaryClass = isPrimary ? " model-card-primary" : "";

          html += `
          <div class="model-card${primaryClass}" data-model-key="${modelKey}" title="点击设为当前模型">
          <div class="model-card-header">
            <h3 class="model-card-title">${modelKey}</h3>
          </div>
            <div class="model-card-info">
              <div class="model-card-info-item">
                <span>API Key:</span>
                <span>
                  ${hasKey}
                  ${
                    apiKey
                      ? `<code style="margin-left: 8px; font-size: 0.85em;">${maskedKey}</code>
                  <button class="btn btn-secondary btn-sm copy-apikey-btn" style="margin-left: 4px; padding: 2px 6px; font-size: 0.85em;" data-apikey="${apiKey.replace(/"/g, "&quot;")}" title="复制 API Key">
                    复制
                  </button>`
                      : ""
                  }
                </span>
              </div>
              <div class="model-card-info-item">
                <span>Base URL:</span>
                <span style="font-size: 0.75rem; word-break: break-all;">${baseUrl}</span>
              </div>
            </div>
            <div class="model-card-actions">
              <button class="btn btn-secondary btn-sm edit-model-btn" data-provider="${providerName}" data-model="${modelId}">
                编辑
              </button>
              <button class="btn btn-secondary btn-sm delete-model-btn" data-provider="${providerName}" data-model="${modelId}">
                删除
              </button>
            </div>
          </div>
        `;
        }
      }
    }

    modelsListEl.innerHTML = html;

    // 为卡片添加点击事件（设置当前模型）
    modelsListEl.querySelectorAll(".model-card").forEach((card) => {
      card.addEventListener("click", () => {
        const modelKey = card.dataset.modelKey;
        if (!modelKey) {
          return;
        }
        setPrimaryModel(modelKey);
      });
    });

    // 为复制按钮添加事件监听器
    document.querySelectorAll(".copy-apikey-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const apiKey = btn.getAttribute("data-apikey");
        copyToClipboard(apiKey, "API Key");
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
      (m) => m.id === modelId || m.name === modelId,
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
    document.getElementById("api-key").value = provider.apiKey || "";

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
  const telegramConfig = document.getElementById("telegram-specific-config");
  const discordConfig = document.getElementById("discord-specific-config");
  const qqbotConfig = document.getElementById("qqbot-specific-config");
  const feishuConfig = document.getElementById("feishu-specific-config");
  const editKey = document.getElementById("edit-channel-key")?.value || "";
  const isEditMode = !!editKey;
  const tokenField = document.getElementById("channel-token");
  const tokenLabel = tokenField
    ? tokenField.parentElement.querySelector("label")
    : null;

  // 隐藏所有特定配置
  if (telegramConfig) telegramConfig.style.display = "none";
  if (discordConfig) discordConfig.style.display = "none";
  if (qqbotConfig) qqbotConfig.style.display = "none";
  if (feishuConfig) feishuConfig.style.display = "none";

  // 未选择类型时，不展示任何设置项
  if (!channelType) {
    if (tokenField) {
      tokenField.parentElement.style.display = "none";
      tokenField.removeAttribute("required");
    }
    return;
  }

  // 根据渠道类型调整 Token 字段
  if (channelType === "feishu") {
    // 飞书不需要 Bot Token 字段，隐藏它
    if (tokenField) {
      tokenField.parentElement.style.display = "none";
      tokenField.removeAttribute("required");
    }
  } else if (channelType === "qqbot") {
    // QQ 不需要通用 Bot Token 字段
    if (tokenField) {
      tokenField.parentElement.style.display = "none";
      tokenField.removeAttribute("required");
    }
  } else if (channelType === "discord") {
    // Discord 不需要通用 Bot Token 字段（使用专用字段）
    if (tokenField) {
      tokenField.parentElement.style.display = "none";
      tokenField.removeAttribute("required");
    }
  } else {
    // 其他渠道需要 Bot Token
    if (tokenField) {
      tokenField.parentElement.style.display = "block";
      tokenField.setAttribute("required", "required");
    }
  }

  // 显示对应类型的配置
  if (channelType === "telegram" && telegramConfig) {
    telegramConfig.style.display = "block";

    const dmPolicyEl = document.getElementById("telegram-dm-policy");
    const groupPolicyEl = document.getElementById("telegram-group-policy");
    const allowFromEl = document.getElementById("telegram-allow-from");
    const groupAllowFromEl = document.getElementById(
      "telegram-group-allow-from",
    );

    if (!isEditMode) {
      if (dmPolicyEl) dmPolicyEl.value = "open";
      if (groupPolicyEl) groupPolicyEl.value = "open";
      if (allowFromEl) allowFromEl.value = "*";
      if (groupAllowFromEl) groupAllowFromEl.value = "";
    }
  } else if (channelType === "discord" && discordConfig) {
    discordConfig.style.display = "block";
  } else if (channelType === "qqbot" && qqbotConfig) {
    qqbotConfig.style.display = "block";
    refreshQqbotPluginStatus();
    if (!isEditMode) {
      const qqbotAllowFromEl = document.getElementById("qqbot-allow-from");
      if (qqbotAllowFromEl && !qqbotAllowFromEl.value) {
        qqbotAllowFromEl.value = "*";
      }
    }
  } else if (channelType === "feishu" && feishuConfig) {
    feishuConfig.style.display = "block";
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

  // 清空 QQ 特定字段
  const qqbotAppIdEl = document.getElementById("qqbot-app-id");
  if (qqbotAppIdEl) qqbotAppIdEl.value = "";
  const qqbotClientSecretEl = document.getElementById("qqbot-client-secret");
  if (qqbotClientSecretEl) qqbotClientSecretEl.value = "";
  const qqbotAllowFromEl = document.getElementById("qqbot-allow-from");
  if (qqbotAllowFromEl) qqbotAllowFromEl.value = "*";

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

  // 飞书渠道不需要 token，Discord 使用专用字段，其他渠道需要通用 token
  if (
    channelType !== "feishu" &&
    channelType !== "discord" &&
    channelType !== "qqbot" &&
    !token
  ) {
    showToast("请输入 Token", "error");
    return;
  }

  // Discord 渠道需要验证必填字段
  if (channelType === "discord") {
    const discordTokenEl = document.getElementById("discord-token");

    if (!discordTokenEl || !discordTokenEl.value.trim()) {
      showToast("请输入 Discord Bot Token", "error");
      return;
    }
  }

  // 飞书渠道需要验证必填字段
  if (channelType === "feishu") {
    const appIdEl = document.getElementById("feishu-app-id");
    const appSecretEl = document.getElementById("feishu-app-secret");

    if (!appIdEl || !appIdEl.value.trim()) {
      showToast("请输入飞书 App ID", "error");
      return;
    }

    if (!appSecretEl || !appSecretEl.value.trim()) {
      showToast("请输入飞书 App Secret", "error");
      return;
    }
  }

  // QQ 渠道需要验证必填字段
  if (channelType === "qqbot") {
    const qqbotAppIdEl = document.getElementById("qqbot-app-id");
    const qqbotClientSecretEl = document.getElementById("qqbot-client-secret");

    if (!qqbotAppIdEl || !qqbotAppIdEl.value.trim()) {
      showToast("请输入 QQ App ID", "error");
      return;
    }

    if (!qqbotClientSecretEl || !qqbotClientSecretEl.value.trim()) {
      showToast("请输入 QQ Client Secret", "error");
      return;
    }

    const pluginReady = await ensureQqbotPluginInstalled();
    if (!pluginReady) {
      return;
    }
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

    // 添加或更新渠道配置（使用渠道名称作为 key）
    if (channelType === "telegram") {
      const allowFromList = parseCommaList(
        document.getElementById("telegram-allow-from")?.value,
      );
      const groupAllowFromList = parseCommaList(
        document.getElementById("telegram-group-allow-from")?.value,
      );
      const dmPolicy =
        document.getElementById("telegram-dm-policy")?.value || "open";
      const groupPolicy =
        document.getElementById("telegram-group-policy")?.value || "open";
      let groups = {};
      if (groupPolicy !== "disabled") {
        groups = {
          "*": {
            requireMention: groupPolicy !== "open",
          },
        };
        if (groupAllowFromList.length > 0) {
          groups["*"].allowFrom = groupAllowFromList;
        }
      }

      config.channels[channelId] = {
        enabled: enabled,
        botToken: token,
        dmPolicy: dmPolicy,
        allowFrom: allowFromList.length > 0 ? allowFromList : ["*"],
        groups: groups,
      };
    } else if (channelType === "feishu") {
      const dmPolicyEl = document.getElementById("feishu-dm-policy");
      const appIdEl = document.getElementById("feishu-app-id");
      const appSecretEl = document.getElementById("feishu-app-secret");
      const botNameEl = document.getElementById("feishu-bot-name");

      config.channels[channelId] = {
        enabled: enabled,
        dmPolicy: dmPolicyEl?.value || "pairing",
        accounts: {
          main: {
            appId: appIdEl?.value.trim() || "",
            appSecret: appSecretEl?.value.trim() || "",
            botName: botNameEl?.value.trim() || "",
          },
        },
      };
    } else if (channelType === "qqbot") {
      const existing = config.channels[channelId];
      const qqbotAppIdEl = document.getElementById("qqbot-app-id");
      const qqbotClientSecretEl = document.getElementById(
        "qqbot-client-secret",
      );
      const allowFromList = parseCommaList(
        document.getElementById("qqbot-allow-from")?.value,
      );
      const allowFrom = allowFromList.length > 0 ? allowFromList : ["*"];
      config.channels[channelId] = {
        enabled: enabled,
        allowFrom: allowFrom,
        appId: qqbotAppIdEl?.value.trim() || "",
        clientSecret: qqbotClientSecretEl?.value.trim() || "",
      };
    } else {
      config.channels[channelId] = {
        enabled: enabled,
      };
    }

    // 非飞书和非 Discord 渠道才需要通用 botToken
    if (
      channelType !== "feishu" &&
      channelType !== "discord" &&
      channelType !== "telegram" &&
      channelType !== "qqbot"
    ) {
      config.channels[channelId].botToken = token;
    }

    // Discord 特定配置
    if (channelType === "discord") {
      const discordTokenEl = document.getElementById("discord-token");
      if (discordTokenEl && discordTokenEl.value.trim()) {
        config.channels[channelId].token = discordTokenEl.value.trim();
      }
    }

    // Telegram 特定配置已在上方处理（严格对齐官方结构）

    // 飞书特定配置已在上方处理（严格对齐官方结构）

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
    case "missing":
      btn.classList.add("missing");
      btn.textContent = "QQ 插件：未安装（点击安装）";
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
    if (status && status.installed) {
      setQqbotPluginButtonState("installed", status.version || "");
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
    if (status && status.installed) {
      return true;
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
    showToast("QQ 插件安装成功", "success");
    qqbotPluginInstalling = false;
    return true;
  } catch (error) {
    setQqbotPluginButtonState("missing");
    showToast("QQ 插件安装失败: " + error.message, "error");
    qqbotPluginInstalling = false;
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
    const modelIdPattern = /^[a-zA-Z0-9.-]+$/;
    const providerPattern = /^[a-z]+$/;

    if (modelIdInput) {
      modelIdInput.setCustomValidity("");
    }
    if (providerInput) {
      providerInput.setCustomValidity("");
    }

    if (!modelIdPattern.test(modelId)) {
      if (modelIdInput) {
        modelIdInput.setCustomValidity(
          "模型 ID 只能包含字母、数字、连字符(-)和点号(.)，不能包含空格或其他特殊字符",
        );
        modelIdInput.reportValidity();
        modelIdInput.focus();
      }
      return;
    }

    if (!providerPattern.test(providerName)) {
      if (providerInput) {
        providerInput.setCustomValidity(
          "供应商名称只能包含小写英文字符（a-z），不能包含大写字母、数字、中文、空格或特殊字符",
        );
        providerInput.reportValidity();
        providerInput.focus();
      }
      return;
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
      baseUrl: formData.get("baseUrl"),
      apiKey: formData.get("apiKey"),
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
}

// ============================================================================
// 配置编辑
// ============================================================================

// 切换编辑器模式
async function toggleEditorMode() {
  const aceContainer = document.getElementById("config-editor-ace");
  const textareaContainer = document.getElementById("config-editor-textarea");
  const toggleBtn = document.getElementById("toggle-editor-btn");
  const loadingOverlay = document.getElementById("editor-loading");

  if (editorMode === "ace") {
    // 从 Ace 切换到 textarea
    const content = aceEditor ? aceEditor.getValue() : "";
    textareaContainer.value = content;
    aceContainer.style.display = "none";
    textareaContainer.style.display = "block";
    editorMode = "textarea";
    toggleBtn.textContent = "切换到高级编辑器";
    toggleBtn.title = "切换到高级编辑器（语法高亮）";
  } else {
    // 从 textarea 切换到 Ace
    const content = textareaContainer.value;

    // 如果 Ace Editor 还没加载，先加载
    if (!aceEditorLoaded) {
      // 显示 loading 遮罩
      loadingOverlay.style.display = "flex";
      toggleBtn.disabled = true;

      try {
        const loaded = await loadAceEditor();
        if (loaded) {
          // 初始化 Ace Editor 实例
          const initialized = initAceEditorInstance();
          if (initialized) {
            // 设置内容
            aceEditor.setValue(content, -1);
            // 切换显示
            textareaContainer.style.display = "none";
            aceContainer.style.display = "block";
            editorMode = "ace";
            toggleBtn.textContent = "切换到简单编辑器";
            toggleBtn.title = "切换到简单编辑器";
          } else {
            showToast("高级编辑器初始化失败，继续使用简单编辑器", "error");
          }
        } else {
          showToast("高级编辑器加载失败，继续使用简单编辑器", "error");
        }
      } catch (error) {
        console.error("加载 Ace Editor 失败:", error);
        showToast("高级编辑器加载失败: " + error.message, "error");
      } finally {
        // 隐藏 loading 遮罩
        loadingOverlay.style.display = "none";
        toggleBtn.disabled = false;
      }
    } else {
      // Ace Editor 已经加载过，直接切换
      if (aceEditor) {
        aceEditor.setValue(content, -1);
      }
      textareaContainer.style.display = "none";
      aceContainer.style.display = "block";
      editorMode = "ace";
      toggleBtn.textContent = "切换到简单编辑器";
      toggleBtn.title = "切换到简单编辑器";
    }
  }

  validateConfigInput();
}

async function loadConfig() {
  try {
    const config = await apiRequest("/config");
    currentConfig = config;
    const jsonStr = JSON.stringify(config, null, 2);

    // 根据当前编辑器模式更新内容
    if (editorMode === "ace" && aceEditor) {
      aceEditor.setValue(jsonStr, -1);
    }

    // 始终更新 textarea（作为数据源）
    const textarea = document.getElementById("config-editor-textarea");
    if (textarea) {
      textarea.value = jsonStr;
    }

    validateConfigInput();
  } catch (error) {
    showToast("加载配置失败: " + error.message, "error");
  }
}

async function saveConfig() {
  try {
    // 获取编辑器内容
    let content;
    if (editorMode === "ace" && aceEditor) {
      content = aceEditor.getValue();
    } else {
      const textarea = document.getElementById("config-editor-textarea");
      content = textarea ? textarea.value : "";
    }

    // 解析 JSON
    const config = JSON.parse(content);

    // 验证配置
    const validation = await apiRequest("/config/validate", {
      method: "POST",
      body: JSON.stringify(config),
    });

    let hasValidationWarning = false;
    let validationWarningText = "";
    if (!validation.valid) {
      hasValidationWarning = true;
      const warnings = Array.isArray(validation.errors)
        ? validation.errors
        : [];
      validationWarningText = warnings.join(", ");
      showToast(
        "配置校验警告（仍将保存）: " +
          (validationWarningText || "存在未知校验问题"),
        "warning",
      );
    }

    // 保存配置
    await apiRequest("/config", {
      method: "POST",
      body: JSON.stringify(config),
    });

    currentConfig = config;
    if (hasValidationWarning) {
      showToast(
        "配置已保存，但存在校验警告。请检查配置后重启 Gateway。",
        "warning",
      );
    } else {
      showToast("配置保存成功！请重启 Gateway 使配置生效。", "success");
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      showToast("JSON 格式错误: " + error.message, "error");
    } else {
      showToast("保存失败: " + error.message, "error");
    }
  }
}

function toggleConfigImportPanel(forceVisible) {
  const panel = document.getElementById("config-import-panel");
  const toggleBtn = document.getElementById("toggle-config-import-btn");
  const textarea = document.getElementById("config-import-textarea");
  if (!panel || !toggleBtn) {
    return;
  }

  const isVisible =
    panel.style.display !== "none" &&
    getComputedStyle(panel).display !== "none";
  const shouldShow =
    typeof forceVisible === "boolean" ? forceVisible : !isVisible;

  panel.style.display = shouldShow ? "block" : "none";
  toggleBtn.textContent = shouldShow ? "收起导入" : "导入配置";

  if (shouldShow && textarea) {
    textarea.focus();
  }
}

function closeConfigImportPanel() {
  toggleConfigImportPanel(false);
}

function clearConfigImportInput() {
  const textarea = document.getElementById("config-import-textarea");
  const fileInput = document.getElementById("config-import-file");
  if (textarea) {
    textarea.value = "";
  }
  if (fileInput) {
    fileInput.value = "";
  }
}

function getJsonLineAndColumnByPosition(content, position) {
  const safePos = Math.max(0, Math.min(position, content.length));
  const head = content.slice(0, safePos);
  const lines = head.split(/\r\n|\r|\n/);
  const line = lines.length;
  const column = (lines[lines.length - 1] || "").length + 1;
  return { line, column };
}

function formatJsonSyntaxError(error, rawContent) {
  const message = error?.message || "JSON 语法错误";

  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    const position = parseInt(posMatch[1], 10);
    if (Number.isFinite(position)) {
      const { line, column } = getJsonLineAndColumnByPosition(
        rawContent,
        position,
      );
      return `JSON 不合法：第 ${line} 行，第 ${column} 列（position ${position}）`;
    }
  }

  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumnMatch) {
    return `JSON 不合法：第 ${lineColumnMatch[1]} 行，第 ${lineColumnMatch[2]} 列`;
  }

  return `JSON 不合法：${message}`;
}

function parseJsonSafely(rawContent) {
  try {
    return {
      valid: true,
      data: JSON.parse(rawContent),
    };
  } catch (error) {
    return {
      valid: false,
      error: formatJsonSyntaxError(error, rawContent),
    };
  }
}

async function handleConfigImportFile(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }

  try {
    const content = await file.text();
    const textarea = document.getElementById("config-import-textarea");
    if (textarea) {
      textarea.value = content;
    }

    const parsed = parseJsonSafely(content);
    if (!parsed.valid) {
      showToast(parsed.error + "，请修正后再应用。", "warning");
      return;
    }

    showToast(`已读取配置文件：${file.name}`, "success");
  } catch (error) {
    showToast("读取配置文件失败: " + error.message, "error");
  }
}

async function applyImportedConfig() {
  const textarea = document.getElementById("config-import-textarea");
  const rawContent = textarea ? textarea.value.trim() : "";

  if (!rawContent) {
    showToast("请先粘贴 JSON 或上传配置文件", "warning");
    return;
  }

  const parsed = parseJsonSafely(rawContent);
  if (!parsed.valid) {
    showToast(parsed.error + "，已丢弃本次导入。", "error");
    return;
  }

  try {
    showToast("正在导入配置并重启 Gateway...", "info");

    const validation = await apiRequest("/config/validate", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    if (!validation.valid) {
      const warnings = Array.isArray(validation.errors)
        ? validation.errors.join(", ")
        : "存在未知校验问题";
      showToast("配置校验警告（仍将导入）: " + warnings, "warning");
    }

    await apiRequest("/config", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });

    let restartSucceeded = true;
    let restartError = "";
    try {
      await apiRequest("/gateway/restart", { method: "POST" });
    } catch (error) {
      restartSucceeded = false;
      restartError = error?.message || "未知错误";
    }

    currentConfig = parsed.data;
    await Promise.all([
      loadConfig(),
      loadModelsList(),
      loadChannelsList(),
      refreshDashboard(),
    ]);

    clearConfigImportInput();
    closeConfigImportPanel();

    if (restartSucceeded) {
      showToast("配置导入成功，Gateway 已自动重启。", "success");
    } else {
      showToast(
        "配置已导入，但 Gateway 自动重启失败: " + restartError,
        "warning",
      );
    }
  } catch (error) {
    showToast("导入配置失败: " + error.message, "error");
  }
}

function buildConfigExportFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `openclaw-${stamp}.json`;
}

async function exportConfig() {
  try {
    const config = await apiRequest("/config");
    const content = JSON.stringify(config, null, 2);
    const fileName = buildConfigExportFileName();
    const blob = new Blob([content], {
      type: "application/json;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    showToast(`配置已导出：${fileName}`, "success");
  } catch (error) {
    showToast("导出配置失败: " + error.message, "error");
  }
}

function copyConfig() {
  let content = "";
  if (editorMode === "ace" && aceEditor) {
    content = aceEditor.getValue();
  } else {
    const textarea = document.getElementById("config-editor-textarea");
    content = textarea ? textarea.value : "";
  }

  if (!content) {
    showToast("没有可复制的配置内容", "warning");
    return;
  }

  copyToClipboard(content, "配置内容");
}

async function resetConfigToInitial() {
  const confirmed = confirm(
    "确定要恢复原始配置吗？\n\n此操作将覆盖当前 openclaw.json，并自动重启 Gateway。\n系统会先自动备份当前配置。",
  );

  if (!confirmed) {
    return;
  }

  try {
    showToast("正在恢复原始配置并重启 Gateway...", "info");
    const result = await apiRequest("/config/reset", { method: "POST" });

    await Promise.all([
      loadConfig(),
      loadModelsList(),
      loadChannelsList(),
      refreshDashboard(),
    ]);

    if (result.restarted) {
      const backupHint = result.backupFile ? ` 备份: ${result.backupFile}` : "";
      showToast("恢复成功，Gateway 已自动重启。" + backupHint, "success");
    } else {
      showToast(
        "配置已恢复，但 Gateway 自动重启失败: " +
          (result.restartError || "未知错误，请手动重启"),
        "warning",
      );
    }
  } catch (error) {
    showToast("恢复原始配置失败: " + error.message, "error");
  }
}

function validateConfigInput() {
  const statusEl = document.getElementById("validation-status");

  try {
    let content;
    if (editorMode === "ace" && aceEditor) {
      content = aceEditor.getValue();
    } else {
      const textarea = document.getElementById("config-editor-textarea");
      content = textarea ? textarea.value : "{}";
    }
    JSON.parse(content);
    statusEl.textContent = "JSON 格式正确";
    statusEl.className = "validation-status valid";
  } catch (error) {
    statusEl.textContent = "JSON 格式错误: " + error.message;
    statusEl.className = "validation-status invalid";
  }
}

// ============================================================================
// 版本管理
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
  if (!confirm("确定要更新版本吗？")) {
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
  const textarea = document.getElementById("config-editor-textarea");
  if (textarea) {
    textarea.addEventListener("input", validateConfigInput);
  }

  // 初始化标签页
  initTabs();
  initTooltips();

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
    });
  }

  if (modelIdInput) {
    modelIdInput.addEventListener("input", () => {
      modelIdInput.setCustomValidity("");
    });
  }

  // 初始化 API 类型下拉框（默认 openai）
  updateApiTypeOptions("openai");

  console.log("初始化完成");
});
