// System tab, console, version and access control actions

(function attachSystemModule(global) {
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
      return;
    }

    badge.classList.add("access-state-local");
    badge.textContent = "明文模式";
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
      await Promise.all([loadModelsList(), loadConfigSummary()]);

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
        return "默认值（仅内网可访问）";
    }
  }

  function updateManagementAccessBadge(allowRemote) {
    const badge = document.getElementById("management-access-state-badge");
    if (!badge) return;

    badge.classList.remove("access-state-local", "access-state-remote");
    if (allowRemote) {
      badge.classList.add("access-state-remote");
      badge.textContent = "允许非内网访问";
      return;
    }

    badge.classList.add("access-state-local");
    badge.textContent = "仅内网可访问";
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
      ? "当前已允许非内网访问，点击切换为仅内网可访问"
      : "当前仅内网可访问，点击切换为允许非内网访问";
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
          ? "当前已允许非内网地址访问。请确认边界网络与反向代理策略已加固。"
          : "当前仅允许本机与局域网访问。";
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
        "开启后，将允许非内网地址（例如互联网/WAN）访问管理面板/API。\n本机和局域网本来就可访问。\n\n确定继续吗？",
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
          ? "当前已允许非内网地址访问。请确认边界网络与反向代理策略已加固。"
          : "当前仅允许本机与局域网访问。";
      }
      updateManagementAccessBadge(allowRemote);
      showToast(
        allowRemote ? "已允许非内网访问" : "已切换为仅内网可访问",
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
      await apiRequest("/tools/profile", {
        method: "POST",
        body: JSON.stringify({ profile: value }),
      });
      showToast("Tool Profiles 已更新为: " + value, "success");
    } catch (error) {
      showToast("保存失败: " + error.message, "error");
    }
  }

  async function loadVersionInfo() {
    try {
      const current = await apiRequest("/version/current");
      document.getElementById("ver-current").textContent = current.version;
      document.getElementById("ver-latest").textContent = "检查中...";
      document.getElementById("ver-status").textContent = "检查中...";
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
        return;
      }

      document.getElementById("ver-status").textContent = "已是最新版本";
      document.getElementById("update-btn").disabled = true;
      showToast("当前已是最新版本", "success");
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
        return;
      }

      showToast(result.message || "更新失败", "warning");
    } catch (error) {
      showToast("更新失败: " + error.message, "error");
    }
  }

  async function loadConsoleInfo() {
    try {
      const info = await apiRequest("/console/url");
      document.getElementById("console-url").textContent = info.url;
      document.getElementById("console-token").textContent = info.token || "(未设置)";
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
        global.location.href = "/dashboard/";
        return;
      }

      if (!info.token) {
        showToast(
          "未检测到网关令牌，打开原生控制面板可能需要手动填写",
          "warning",
        );
      }

      global.location.href = info.url;
    } catch (error) {
      showToast("打开原生控制面板失败: " + error.message, "error");
    }
  }

  async function refreshLogs() {
    try {
      const result = await apiRequest("/logs?lines=1000");
      const logContent = document.getElementById("log-content");
      logContent.textContent = result.logs || "(暂无日志)";
      logContent.scrollTop = logContent.scrollHeight;
    } catch (error) {
      document.getElementById("log-content").textContent =
        "加载日志失败: " + error.message;
    }
  }

  global.managementSystem = {
    getApiKeyProtectionSourceLabel,
    getApiKeyProtectionNote,
    updateApiKeyProtectionBadge,
    updateApiKeyProtectionToggle,
    initApiKeyProtectionToggleControl,
    loadApiKeyProtectionSettings,
    saveApiKeyProtectionSettings,
    getManagementAccessSourceLabel,
    updateManagementAccessBadge,
    updateManagementAccessToggle,
    initManagementAccessToggleControl,
    loadManagementAccessSettings,
    saveManagementAccessSettings,
    loadToolProfiles,
    saveToolProfiles,
    loadVersionInfo,
    checkUpdate,
    updateVersion,
    loadConsoleInfo,
    openConsole,
    refreshLogs,
  };

  Object.assign(global, global.managementSystem);
})(window);
