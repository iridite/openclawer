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

function copyToClipboard(text, label = "内容") {
  const value = String(text || "");
  if (!value) {
    showToast(`没有可复制的${label}`, "warning");
    return;
  }

  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (err) {
      copied = false;
    } finally {
      document.body.removeChild(textarea);
    }

    if (copied) {
      showToast(`${label}已复制到剪贴板`, "success");
    } else {
      showToast(`${label}复制失败，请手动复制`, "error");
    }
  };

  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(
      () => {
        showToast(`${label}已复制到剪贴板`, "success");
      },
      () => {
        fallbackCopy();
      },
    );
    return;
  }

  fallbackCopy();
}

const STATIC_OC_HOME = "/root/.openclaw";
const STATIC_RUNTIME_DIR = "/var/apps/oc-deploy/var";
const STATIC_APP_DIR = "/var/apps/oc-deploy/target";

function replaceStaticPathPrefix(rawPath, staticPrefix, runtimePrefix) {
  const source = String(rawPath || "");
  const from = String(staticPrefix || "");
  const to = String(runtimePrefix || "").trim();
  if (!source || !from || !to || !source.startsWith(from)) {
    return source;
  }

  const suffix = source.slice(from.length);
  if (!suffix) {
    return to;
  }

  const normalizedTo = to.endsWith("/") && to.length > 1
    ? to.slice(0, -1)
    : to;
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${normalizedTo}${normalizedSuffix}`;
}

function resolveSystemPath(rawPath) {
  let resolved = String(rawPath || "").trim();
  if (!resolved || !systemPaths || typeof systemPaths !== "object") {
    return resolved;
  }

  resolved = replaceStaticPathPrefix(resolved, STATIC_OC_HOME, systemPaths.ocHome);
  resolved = replaceStaticPathPrefix(
    resolved,
    STATIC_RUNTIME_DIR,
    systemPaths.runtimeDir,
  );
  resolved = replaceStaticPathPrefix(resolved, STATIC_APP_DIR, systemPaths.appDir);

  return resolved;
}

function refreshSystemPathTexts() {
  const selectors = ["#tab-console .path-value", "#tab-skills .form-hint code"];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      const template = String(el.dataset.pathTemplate || el.textContent || "").trim();
      if (!template) return;
      if (!el.dataset.pathTemplate) {
        el.dataset.pathTemplate = template;
      }
      el.textContent = resolveSystemPath(template);
    });
  });
}

async function loadSystemPaths() {
  try {
    const result = await apiRequest("/system/paths", { retries: 0 });
    if (!result || typeof result !== "object") {
      return;
    }
    systemPaths = result;
    refreshSystemPathTexts();
  } catch (err) {
    console.warn("加载系统路径信息失败，使用默认展示路径:", err);
  }
}

function copyPath(pathValue) {
  copyToClipboard(resolveSystemPath(pathValue), "路径");
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

// API 请求封装
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
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
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

  try {
    const response = await performApiFetch(endpoint, {
      ...rest,
      headers,
      body: formData,
    }, "API 表单请求");
    return await parseApiResponse(endpoint, response);
  } catch (error) {
    throw error;
  }
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
      window.refreshDashboard();
      window.refreshLogs();
      break;
    case "models":
      setConfigViewMode("models");
      window.renderQuickAddButtons();
      window.loadModelsList();
      break;
    case "channels":
      setConfigViewMode("channels");
      window.loadChannelsList();
      break;
    case "config":
      setConfigViewMode("config");
      loadConfig();
      break;
    case "skills":
      loadInstalledSkills();
      break;
    case "system":
      window.loadToolProfiles();
      window.loadManagementAccessSettings();
      window.loadApiKeyProtectionSettings();
      window.loadVersionInfo();
      window.loadConsoleInfo();
      break;
  }
}

// ============================================================================
// 公共工具
// ============================================================================

function maskApiKey(key) {
  if (!key || key.length < 8) {
    return "***";
  }
  const start = key.substring(0, 4);
  const end = key.substring(key.length - 4);
  return `${start}${"*".repeat(Math.min(20, key.length - 8))}${end}`;
}
// ============================================================================
// 技能管理
// ============================================================================

const installedSkillSlugs = new Set();

function normalizeSkillSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

function normalizeSkillLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
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
        <div class="skills-section-header skills-section-header-spaced">
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
  const showsSlug =
    !!skill.slug &&
    normalizeSkillLabel(skill.slug) !== normalizeSkillLabel(skill.name);

  return `
    <div class="skill-card" data-slug="${escapeHtml(skill.slug)}">
        <div class="skill-card-header">
          <h4 class="skill-card-title">${escapeHtml(skill.name)}</h4>
          <div class="skill-badges">
            ${isBuiltin ? '<span class="skill-badge builtin">内置</span>' : '<span class="skill-badge user">用户</span>'}
            ${requiresApi ? '<span class="skill-badge api-required">需要 API</span>' : ''}
            ${!skill.exists ? '<span class="skill-badge missing">缺失</span>' : ''}
          </div>
        </div>

      <div class="skill-card-meta">
        ${showsSlug ? `<div class="skill-card-slug">${escapeHtml(skill.slug)}</div>` : ""}
        ${showsEntryKey ? `<div class="card-meta-line">skillKey: <code>${escapeHtml(entryKey)}</code></div>` : ""}
        ${skill.description ? `<p class="skill-card-description">${escapeHtml(skill.description)}</p>` : ''}
        ${skill.version ? `<div class="card-meta-line">版本: ${escapeHtml(skill.version)}</div>` : ''}
        ${skill.installed_at ? `<div class="card-meta-line">安装时间: ${new Date(skill.installed_at).toLocaleDateString('zh-CN')}</div>` : ''}
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

  loadSystemPaths();

  // 初始化标签页
  initTabs();
  initTooltips();
  window.initManagementAccessToggleControl();
  window.initApiKeyProtectionToggleControl();

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
      window.refreshDashboard();
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
        window.updateApiTypeOptions(protocol);
      }
    });
  }

  if (modelIdInput) {
    modelIdInput.addEventListener("input", () => {
      modelIdInput.setCustomValidity("");
    });
  }

  // 初始化 API 类型下拉框（默认 openai）
  window.updateApiTypeOptions("openai");
  const storageSelect = document.getElementById("api-key-storage-mode");
  if (storageSelect) {
    storageSelect.addEventListener("change", window.handleApiKeyStorageModeChange);
  }
  window.applyDefaultApiKeyStorageMode();
  window.loadApiKeyProtectionSettings();

  console.log("初始化完成");
});
