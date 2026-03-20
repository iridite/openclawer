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
  if (systemPaths && typeof systemPaths === "object") {
    return systemPaths;
  }

  try {
    const result = await apiRequest("/system/paths", { retries: 0 });
    if (!result || typeof result !== "object") {
      return null;
    }
    systemPaths = result;
    refreshSystemPathTexts();
    return systemPaths;
  } catch (err) {
    console.warn("加载系统路径信息失败，使用默认展示路径:", err);
    return null;
  }
}

async function copyPath(pathValue) {
  if (!systemPaths || typeof systemPaths !== "object") {
    await loadSystemPaths();
  }
  copyToClipboard(resolveSystemPath(pathValue), "路径");
}

function getApiClient() {
  return window.managementApiClient || null;
}

// API 请求封装（兼容入口；具体实现位于 management.api.js）
async function apiRequest(endpoint, options = {}) {
  const client = getApiClient();
  if (!client?.apiRequest) {
    throw new Error("API client is not ready");
  }
  return client.apiRequest(endpoint, options);
}

async function apiFormRequest(endpoint, options = {}) {
  const client = getApiClient();
  if (!client?.apiFormRequest) {
    throw new Error("API form client is not ready");
  }
  return client.apiFormRequest(endpoint, options);
}

async function apiDownloadRequest(endpoint, options = {}) {
  const client = getApiClient();
  if (!client?.apiDownloadRequest) {
    throw new Error("API download client is not ready");
  }
  return client.apiDownloadRequest(endpoint, options);
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
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
