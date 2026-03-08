// OpenClaw Management Console JavaScript

// API 基础 URL
const API_BASE = "/api";

// 全局状态
let currentConfig = null;
let currentStatus = null;

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

// ============================================================================
// 标签页切换
// ============================================================================

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;

      // 更新按钮状态
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // 更新内容显示
      tabContents.forEach((content) => {
        content.classList.remove("active");
        if (content.id === `tab-${tabName}`) {
          content.classList.add("active");
        }
      });

      // 加载对应标签页的数据
      loadTabData(tabName);
    });
  });
}

function loadTabData(tabName) {
  switch (tabName) {
    case "dashboard":
      refreshDashboard();
      break;
    case "config":
      loadConfig();
      break;
    case "version":
      loadVersionInfo();
      break;
    case "console":
      loadConsoleInfo();
      break;
  }
}

// ============================================================================
// 仪表板
// ============================================================================

async function refreshDashboard() {
  try {
    const status = await apiRequest("/status");
    currentStatus = status;

    // 更新状态显示
    updateStatusBadge(status.gateway);

    // 更新仪表板信息
    document.getElementById("dash-gateway-status").textContent =
      status.gateway === "running" ? "✅ 运行中" : "⭕ 已停止";
    document.getElementById("dash-gateway-pid").textContent =
      status.gatewayPid || "(未运行)";
    document.getElementById("dash-version").textContent =
      status.version || "unknown";
    document.getElementById("dash-config-status").textContent =
      status.configExists ? "✅ 已配置" : "⚠️ 未配置";

    // 加载配置摘要
    loadConfigSummary();

    // 加载运行日志
    refreshLogs();
  } catch (error) {
    showToast("加载状态失败: " + error.message, "error");
  }
}

async function loadConfigSummary() {
  try {
    const config = await apiRequest("/config");
    const summaryEl = document.getElementById("config-summary");

    const modelCount = config.models ? Object.keys(config.models).length : 0;
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
        '<div style="margin-top: 15px;"><strong>📦 已配置模型：</strong><ul style="margin: 5px 0; padding-left: 20px;">';
      for (const [name, model] of Object.entries(config.models)) {
        const provider = model.provider || "未知";
        const hasKey = model.apiKey ? "✅" : "❌";
        html += `<li><code>${name}</code> (${provider}) ${hasKey}</li>`;
      }
      html += "</ul></div>";
    } else {
      html +=
        '<div style="margin-top: 15px;"><em>⚠️ 尚未配置 AI 模型</em></div>';
    }

    // 显示渠道详情
    if (channelCount > 0) {
      html +=
        '<div style="margin-top: 10px;"><strong>📡 已配置渠道：</strong><ul style="margin: 5px 0; padding-left: 20px;">';
      for (const [name, channel] of Object.entries(config.channels)) {
        const type = channel.type || "未知";
        const enabled = channel.enabled !== false ? "✅" : "⭕";
        html += `<li><code>${name}</code> (${type}) ${enabled}</li>`;
      }
      html += "</ul></div>";
    } else {
      html +=
        '<div style="margin-top: 10px;"><em>⚠️ 尚未配置消息渠道</em></div>';
    }

    summaryEl.innerHTML = html;
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

// 展开/收起表单
function toggleModelForm() {
  const container = document.getElementById("model-form-container");
  const btn = document.getElementById("toggle-form-btn");

  if (container.style.display === "none") {
    container.style.display = "block";
    btn.textContent = "收起表单";
  } else {
    container.style.display = "none";
    btn.textContent = "展开表单";
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

    // 构建输入类型数组
    const inputTypes = [];
    if (document.getElementById("input-text").checked) {
      inputTypes.push("text");
    }
    if (document.getElementById("input-image").checked) {
      inputTypes.push("image");
    }

    // 构建请求数据
    const modelData = {
      modelId: formData.get("modelId"),
      providerName: formData.get("providerName"),
      baseUrl: formData.get("baseUrl"),
      apiKey: formData.get("apiKey"),
      apiProtocol: formData.get("apiProtocol"),
      advanced: {
        reasoning: document.getElementById("reasoning").checked,
        input: inputTypes,
        contextWindow: parseInt(formData.get("contextWindow")),
        maxTokens: parseInt(formData.get("maxTokens")),
      },
    };

    showToast("正在添加模型...", "info");

    const result = await apiRequest("/models/add", {
      method: "POST",
      body: JSON.stringify(modelData),
    });

    showToast(result.message || "模型添加成功！", "success");

    // 重置表单
    resetModelForm();

    // 刷新配置编辑器
    await loadConfig();

    // 刷新配置摘要
    await loadConfigSummary();
  } catch (error) {
    showToast("添加失败: " + error.message, "error");
  }
}

// 重置表单
function resetModelForm() {
  const form = document.getElementById("add-model-form");
  form.reset();

  // 重置高级配置默认值
  document.getElementById("context-window").value = "200000";
  document.getElementById("max-tokens").value = "8192";
  document.getElementById("input-text").checked = true;
  document.getElementById("input-image").checked = false;
  document.getElementById("reasoning").checked = false;
}

// 监听供应商选择，自动填充 Base URL
document.addEventListener("DOMContentLoaded", () => {
  const providerInput = document.getElementById("provider-name");
  const baseUrlInput = document.getElementById("base-url");

  if (providerInput && baseUrlInput) {
    providerInput.addEventListener("input", () => {
      const provider = providerInput.value.toLowerCase();
      if (PROVIDER_BASE_URLS[provider]) {
        baseUrlInput.value = PROVIDER_BASE_URLS[provider];
      }
    });
  }
});

// ============================================================================
// 配置编辑
// ============================================================================

async function loadConfig() {
  try {
    const config = await apiRequest("/config");
    currentConfig = config;

    const editor = document.getElementById("config-editor");
    editor.value = JSON.stringify(config, null, 2);

    validateConfigInput();
  } catch (error) {
    showToast("加载配置失败: " + error.message, "error");
  }
}

async function saveConfig() {
  const editor = document.getElementById("config-editor");

  try {
    // 解析 JSON
    const config = JSON.parse(editor.value);

    // 验证配置
    const validation = await apiRequest("/config/validate", {
      method: "POST",
      body: JSON.stringify(config),
    });

    if (!validation.valid) {
      showToast("配置验证失败: " + validation.errors.join(", "), "error");
      return;
    }

    // 保存配置
    await apiRequest("/config", {
      method: "POST",
      body: JSON.stringify(config),
    });

    currentConfig = config;
    showToast("配置保存成功！请重启 Gateway 使配置生效。", "success");
  } catch (error) {
    if (error instanceof SyntaxError) {
      showToast("JSON 格式错误: " + error.message, "error");
    } else {
      showToast("保存失败: " + error.message, "error");
    }
  }
}

function validateConfigInput() {
  const editor = document.getElementById("config-editor");
  const statusEl = document.getElementById("validation-status");

  try {
    JSON.parse(editor.value);
    statusEl.textContent = "✅ JSON 格式正确";
    statusEl.className = "validation-status valid";
  } catch (error) {
    statusEl.textContent = "❌ JSON 格式错误: " + error.message;
    statusEl.className = "validation-status invalid";
  }
}

// 监听编辑器输入
document.addEventListener("DOMContentLoaded", () => {
  const editor = document.getElementById("config-editor");
  if (editor) {
    editor.addEventListener("input", validateConfigInput);
  }
});

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
      document.getElementById("ver-status").textContent = "🆕 有新版本可用";
      document.getElementById("update-btn").disabled = false;
      showToast("发现新版本: " + latest.version, "success");
    } else {
      document.getElementById("ver-status").textContent = "✅ 已是最新版本";
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
// 控制台
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
    showToast("加载控制台信息失败: " + error.message, "error");
  }
}

async function openConsole() {
  try {
    const info = await apiRequest("/console/url");
    const url = info.url + (info.token ? "?token=" + info.token : "");
    window.open(url, "_blank");
  } catch (error) {
    showToast("打开控制台失败: " + error.message, "error");
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

  // 初始化标签页
  initTabs();

  // 加载初始数据
  refreshDashboard();

  // 定时刷新状态（每 5 秒）
  setInterval(() => {
    if (document.querySelector(".tab-content.active")?.id === "tab-dashboard") {
      refreshDashboard();
    }
  }, 5000);

  // 监听供应商选择，自动填充 Base URL
  const providerInput = document.getElementById("provider-name");
  const baseUrlInput = document.getElementById("base-url");

  if (providerInput && baseUrlInput) {
    providerInput.addEventListener("input", () => {
      const provider = providerInput.value.toLowerCase();
      if (PROVIDER_BASE_URLS[provider]) {
        baseUrlInput.value = PROVIDER_BASE_URLS[provider];
      }
    });
  }

  console.log("初始化完成");
});
