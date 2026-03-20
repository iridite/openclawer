// App bootstrap and startup orchestration

(function attachManagementBootstrap(global) {
  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (currentTabName === "config") {
          global.saveConfig();
          global.showToast("正在保存配置... (Ctrl+S)", "info");
        }
      }
    });
  }

  function bindSkillSearchEvents(refs) {
    const skillsSearchBtn =
      refs?.skills.searchBtn || document.getElementById("skills-search-btn");
    const skillsSearchInput =
      refs?.skills.searchInput || document.getElementById("skills-search-input");
    const skillsRefreshBtn =
      refs?.skills.refreshBtn || document.getElementById("skills-refresh-btn");

    if (skillsSearchBtn) {
      skillsSearchBtn.addEventListener("click", () => {
        global.skillsManager?.searchSkills();
      });
    }

    if (skillsSearchInput) {
      skillsSearchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          global.skillsManager?.searchSkills();
        }
      });

      let searchTimeout;
      skillsSearchInput.addEventListener("input", () => {
        clearTimeout(searchTimeout);
        const query = skillsSearchInput.value.trim();
        if (query.length > 0) {
          searchTimeout = setTimeout(() => {
            global.skillsManager?.searchSkills();
          }, 500);
        } else {
          document.getElementById("skills-search-results").innerHTML = "";
        }
      });
    }

    if (skillsRefreshBtn) {
      skillsRefreshBtn.addEventListener("click", () => {
        global.skillsManager?.loadInstalledSkills();
      });
    }
  }

  function bindModelProviderEvents() {
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

        const protocol = provider === "anthropic" ? "anthropic" : "openai";
        const protocolSelect = document.getElementById("api-protocol");
        if (protocolSelect) {
          protocolSelect.value = protocol;
          global.updateApiTypeOptions(protocol);
        }
      });
    }

    if (modelIdInput) {
      modelIdInput.addEventListener("input", () => {
        modelIdInput.setCustomValidity("");
      });
    }
  }

  function initConfigEditorValidation(refs) {
    const textarea =
      refs?.config.editorTextarea || document.getElementById("config-editor-textarea");
    if (textarea) {
      textarea.addEventListener("input", global.validateConfigInput);
    }
  }

  function initRecurringRefresh() {
    setInterval(() => {
      if (currentTabName === "overview") {
        global.refreshDashboard();
      }
    }, 5000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    console.log("OpenClaw Management Console 初始化...");

    initKeyboardShortcuts();

    if (global.initDomRefs) {
      global.initDomRefs();
    }

    const refs = global.domRefs;
    initConfigEditorValidation(refs);
    global.loadSystemPaths();

    global.managementUiCore?.initTabs();
    global.managementUiCore?.initTooltips();
    global.initManagementAccessToggleControl();
    global.initApiKeyProtectionToggleControl();

    bindSkillSearchEvents(refs);
    initRecurringRefresh();
    bindModelProviderEvents();

    global.updateApiTypeOptions("openai");
    const storageSelect = document.getElementById("api-key-storage-mode");
    if (storageSelect) {
      storageSelect.addEventListener("change", global.handleApiKeyStorageModeChange);
    }
    global.applyDefaultApiKeyStorageMode();
    global.loadApiKeyProtectionSettings();

    console.log("初始化完成");
  });
})(window);
