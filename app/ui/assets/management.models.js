// Models tab and model form actions

(function attachModelsModule(global) {
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

    container.querySelectorAll(".quick-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modelId = btn.dataset.modelId;
        quickAddModel(modelId);
      });
    });
  }

  function inferProtocolFromApiType(apiValue) {
    if (!apiValue) return "openai";
    if (apiValue === "anthropic") return "anthropic";
    if (apiValue === "openai") return "openai";
    if (apiValue.startsWith("anthropic-")) return "anthropic";
    if (apiValue.startsWith("openai-")) return "openai";
    return "openai";
  }

  function updateApiTypeOptions(protocol) {
    const apiTypeSelect = document.getElementById("api-type");
    if (!apiTypeSelect) return;

    apiTypeSelect.innerHTML = "";

    let options = [];
    if (protocol === "openai") {
      options = API_TYPES.openai;
    } else if (protocol === "anthropic") {
      options = API_TYPES.anthropic;
    } else {
      options = API_TYPES.openai;
    }

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

    if (defaultValue) {
      apiTypeSelect.value = defaultValue;
    }
  }

  async function quickAddModel(modelId) {
    const modelData = QUICK_ADD_MODELS[modelId];
    if (!modelData) {
      showToast("模型预设不存在", "error");
      return;
    }

    const formCard = document.getElementById("model-form-card");
    const formTitle = document.getElementById("form-title");
    const submitBtnText = document.getElementById("submit-btn-text");

    formCard.style.display = "block";
    formTitle.textContent = `快速添加 ${modelId}`;
    submitBtnText.textContent = "添加新模型";

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

    updateApiTypeOptions(modelData.apiProtocol);
    if (modelData.apiType) {
      document.getElementById("api-type").value = modelData.apiType;
    }

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
      if (input) {
        document.getElementById("input-type-text").checked =
          input.includes("text");
        document.getElementById("input-image").checked =
          input.includes("image");
      }
    }

    formCard.scrollIntoView({ behavior: "smooth", block: "start" });

    setTimeout(() => {
      document.getElementById("api-key").focus();
    }, 300);
  }

  function toggleModelForm() {
    const formCard = document.getElementById("model-form-card");
    const formTitle = document.getElementById("form-title");
    const submitBtnText = document.getElementById("submit-btn-text");

    if (formCard.style.display === "none") {
      formCard.style.display = "block";
      formTitle.textContent = "添加新模型";
      submitBtnText.textContent = "添加新模型";
      resetModelForm();
      updateApiTypeOptions("openai");
      formCard.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    formCard.style.display = "none";
    resetModelForm();
  }

  function cancelModelForm() {
    document.getElementById("model-form-card").style.display = "none";
    resetModelForm();
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

  async function loadModelsList() {
    try {
      const config = await apiRequest("/config");
      const modelsListEl = document.getElementById("models-list");

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
      const primaryModel = config.agents?.defaults?.model?.primary || "";

      let html = "";
      for (const providerName of sortedProviders) {
        const provider = providers[providerName];
        if (!provider.models || !Array.isArray(provider.models)) {
          continue;
        }

        for (const model of provider.models) {
          const baseUrl = provider.baseUrl || provider.baseURL || "未配置";
          const apiKeyState = inferApiKeyStorageState(provider.apiKey);
          const storageModeLabel =
            apiKeyState.mode === "env"
              ? "环境变量"
              : apiKeyState.mode === "managed-file"
                ? "受管文件"
                : "明文";
          const storageSummary = `${apiKeyState.hasValue ? "已配置" : "未配置"} ${storageModeLabel} ${apiKeyState.descriptor || ""}`.trim();
          const modelId = model.id || model.name || model.model;
          const modelKey = `${providerName}/${modelId}`;
          const isPrimary = modelKey === primaryModel;
          const primaryClass = isPrimary ? " model-card-primary" : "";
          const selectableClass = isPrimary ? "" : " model-card-selectable";
          const selectionAttrs = isPrimary
            ? ""
            : ' tabindex="0" title="点击设为主模型" aria-label="点击设为主模型"';

          html += `
          <div class="model-card${primaryClass}${selectableClass}" data-model-key="${modelKey}"${selectionAttrs}>
          <div class="model-card-header">
            <h3 class="model-card-title">${modelKey}</h3>
            ${isPrimary ? '<span class="primary-badge">主模型</span>' : ''}
          </div>
            <div class="model-card-info">
              <div class="model-card-info-item">
                <span class="model-card-info-label">密钥存储:</span>
                <span class="model-card-info-value model-card-info-value-nowrap" title="${escapeHtml(storageSummary)}">
                  ${apiKeyState.hasValue ? "已配置" : "未配置"}
                  <code style="margin-left: 8px; font-size: 0.85em;">${storageModeLabel}</code>
                  <span style="margin-left: 8px; font-size: 0.8em; color: var(--text-light);">${escapeHtml(apiKeyState.descriptor)}</span>
                </span>
              </div>
              <div class="model-card-info-item">
                <span class="model-card-info-label">Base URL:</span>
                <span class="model-card-info-value model-card-info-value-nowrap" title="${escapeHtml(baseUrl)}">${escapeHtml(baseUrl)}</span>
              </div>
            </div>
            <div class="model-card-actions">
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

      modelsListEl.innerHTML = html;

      modelsListEl.querySelectorAll(".model-card-selectable").forEach((card) => {
        card.addEventListener("click", () => {
          const modelKey = card.dataset.modelKey;
          if (modelKey) {
            setPrimaryModel(modelKey);
          }
        });

        card.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") {
            return;
          }
          e.preventDefault();
          const modelKey = card.dataset.modelKey;
          if (modelKey) {
            setPrimaryModel(modelKey);
          }
        });
      });

      document.querySelectorAll(".edit-model-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          editModel(btn.dataset.provider, btn.dataset.model);
        });
      });

      document.querySelectorAll(".delete-model-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteModel(btn.dataset.provider, btn.dataset.model);
        });
      });
    } catch (error) {
      document.getElementById("models-list").innerHTML =
        '<p class="loading">加载失败: ' + error.message + "</p>";
    }
  }

  async function setPrimaryModel(modelKey) {
    try {
      if (!modelKey) {
        return;
      }

      if (currentConfig?.agents?.defaults?.model?.primary === modelKey) {
        showToast("该模型已是当前模型", "info");
        return;
      }

      showToast("正在设置当前模型...", "info");
      await apiRequest("/models/primary", {
        method: "POST",
        body: JSON.stringify({ modelKey }),
      });
      showToast("当前模型已更新", "success");

      await loadModelsList();
      await global.loadConfigSummary();
      await loadConfig();
    } catch (error) {
      showToast("设置当前模型失败: " + error.message, "error");
    }
  }

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

      const formCard = document.getElementById("model-form-card");
      const formTitle = document.getElementById("form-title");
      const submitBtnText = document.getElementById("submit-btn-text");

      formCard.style.display = "block";
      formTitle.textContent = "编辑模型";
      submitBtnText.textContent = "保存修改";

      document.getElementById("edit-model-key").value =
        `${providerName}/${modelId}`;
      document.getElementById("model-id").value = modelId;
      document.getElementById("model-id").disabled = true;
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

      const savedApiType = provider.api || "openai-completions";
      const protocol = inferProtocolFromApiType(savedApiType);
      document.getElementById("api-protocol").value = protocol;
      updateApiTypeOptions(protocol);
      const apiTypeSelect = document.getElementById("api-type");
      apiTypeSelect.value = savedApiType;

      if (
        apiTypeSelect.value !== savedApiType &&
        apiTypeSelect.options.length > 0
      ) {
        apiTypeSelect.selectedIndex = 0;
      }

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

  async function deleteModel(providerName, modelId) {
    if (
      !confirm(`确定要删除模型 "${providerName}/${modelId}" 吗？此操作不可撤销。`)
    ) {
      return;
    }

    try {
      showToast("正在删除模型...", "info");

      const modelKey = `${providerName}/${modelId}`;
      const result = await apiRequest("/models/delete", {
        method: "POST",
        body: JSON.stringify({ modelKey }),
      });

      showToast(result.message || "模型删除成功！", "success");
      await loadModelsList();
      await loadConfig();
    } catch (error) {
      showToast("删除模型失败: " + error.message, "error");
    }
  }

  async function submitModelForm(event) {
    event.preventDefault();

    try {
      const form = document.getElementById("add-model-form");
      const formData = new FormData(form);
      const editModelKey = document.getElementById("edit-model-key").value;
      const isEditMode = !!editModelKey;

      const modelIdInput = document.getElementById("model-id");
      const providerInput = document.getElementById("provider-name");
      const modelId = (modelIdInput?.value || formData.get("modelId") || "").trim();
      const providerName = (
        providerInput?.value ||
        formData.get("providerName") ||
        ""
      ).trim();

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
      const apiKeyStorageMode =
        storageSelect?.value || getDefaultApiKeyStorageMode();
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

      const modelData = {
        modelId,
        providerName,
        baseUrl: String(formData.get("baseUrl") || "").trim(),
        apiKey,
        apiKeyStorageMode,
        apiKeyEnvVar,
        keepExistingApiKeyRef,
        apiProtocol: formData.get("apiProtocol"),
        apiType: formData.get("apiType"),
        isEditMode,
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

      cancelModelForm();

      await loadModelsList();
      await global.loadConfigSummary();
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

  function resetModelForm() {
    const form = document.getElementById("add-model-form");
    form.reset();

    document.getElementById("edit-model-key").value = "";
    document.getElementById("model-id").disabled = false;

    const testBtn = document.getElementById("test-model-btn");
    if (testBtn) {
      testBtn.className = "btn";
      testBtn.disabled = false;
    }

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

  async function testModelConnection() {
    const testBtn = document.getElementById("test-model-btn");
    const modelId = document.getElementById("model-id").value.trim();
    const providerName = document.getElementById("provider-name").value.trim();
    const baseUrl = document.getElementById("base-url").value.trim();
    const apiKey = document.getElementById("api-key").value.trim();
    const apiProtocol = document.getElementById("api-protocol").value;
    const apiType = document.getElementById("api-type")?.value || "";
    const storageMode =
      document.getElementById("api-key-storage-mode")?.value ||
      getDefaultApiKeyStorageMode();
    const apiKeyEnvVar =
      document.getElementById("api-key-env-var")?.value.trim() || "";
    const existingRefText =
      document.getElementById("existing-api-key-ref")?.value.trim() || "";
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

    testBtn.disabled = true;
    testBtn.className = "btn";
    testBtn.textContent = "测试中...";

    document.querySelectorAll(".test-modal").forEach((node) => node.remove());

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
            <div class="test-label">底层执行</div>
            <div class="test-command" id="test-runtime">等待服务端返回底层请求信息...</div>
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
    const runtimeEl = modal.querySelector("#test-runtime");

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

    function maskTestApiKey(value) {
      const raw = String(value || "").trim();
      if (!raw) {
        return "";
      }
      if (raw.length <= 8) {
        return "****";
      }
      return `${raw.slice(0, 8)}...`;
    }

    function buildLocalTestPayload(protocol, suffix, targetModelId) {
      if (protocol === "anthropic") {
        return {
          model: targetModelId,
          max_tokens: 10,
          messages: [{ role: "user", content: "test" }],
        };
      }
      if (suffix === "/responses") {
        return {
          model: targetModelId,
          input: "test",
          max_output_tokens: 10,
        };
      }
      return {
        model: targetModelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      };
    }

    function resolveMaskedAuthHint() {
      if (apiKey) {
        return maskTestApiKey(apiKey);
      }
      if (storageMode === "env" && apiKeyEnvVar) {
        return `<from env:${apiKeyEnvVar}>`;
      }
      if (apiKeyRef && typeof apiKeyRef === "object") {
        return "<from SecretRef>";
      }
      if (storageMode === "managed-file") {
        return "<from managed secret>";
      }
      return "<resolved on server>";
    }

    function formatRuntimeDebug(runtime) {
      if (!runtime || typeof runtime !== "object") {
        return "服务端未返回底层调试信息";
      }
      const lines = [];
      if (runtime.transport) {
        lines.push(`transport: ${runtime.transport}`);
      }
      if (runtime.endpoint) {
        lines.push(`endpoint: ${runtime.endpoint}`);
      }
      if (runtime.statusCode !== undefined && runtime.statusCode !== null) {
        lines.push(`statusCode: ${runtime.statusCode}`);
      }
      if (runtime.durationMs !== undefined && runtime.durationMs !== null) {
        lines.push(`durationMs: ${runtime.durationMs}`);
      }
      if (runtime.responseBytes !== undefined && runtime.responseBytes !== null) {
        lines.push(`responseBytes: ${runtime.responseBytes}`);
      }
      if (runtime.errorCode) {
        lines.push(`errorCode: ${runtime.errorCode}`);
      }
      if (runtime.requestOptions && typeof runtime.requestOptions === "object") {
        lines.push("requestOptions:");
        lines.push(JSON.stringify(runtime.requestOptions, null, 2));
      }
      if (runtime.headers && typeof runtime.headers === "object") {
        lines.push("headers(masked):");
        lines.push(JSON.stringify(runtime.headers, null, 2));
      }
      if (typeof runtime.bodyPreview === "string" && runtime.bodyPreview) {
        lines.push("body:");
        lines.push(runtime.bodyPreview);
      }
      if (lines.length === 0) {
        return "服务端未返回底层调试信息";
      }
      return lines.join("\n");
    }

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

    const payload = buildLocalTestPayload(protocol, endpointSuffix, modelId);
    const payloadText = JSON.stringify(payload);
    const authHint = resolveMaskedAuthHint();
    const basicCurl = protocol === "anthropic"
      ? `curl -X POST '${endpoint}' \\\n  -H 'x-api-key: ${authHint}' \\\n  -H 'anthropic-version: 2023-06-01' \\\n  -H 'Content-Type: application/json' \\\n  -d '${payloadText}' --max-time 5`
      : `curl -X POST '${endpoint}' \\\n  -H 'Authorization: Bearer ${authHint}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${payloadText}' --max-time 5`;
    if (commandEl) {
      commandEl.textContent = basicCurl;
    }
    if (runtimeEl) {
      runtimeEl.textContent =
        "transport: Node.js http(s).request\nstatus: pending";
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

      if (result.curlCommand && commandEl) {
        commandEl.textContent = result.curlCommand;
      }
      if (runtimeEl) {
        runtimeEl.textContent = formatRuntimeDebug(result.runtime);
      }
      const responseEl = modal.querySelector("#test-response");

      if (result.success) {
        if (responseEl) {
          responseEl.className = "test-response success";
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
        let errorMsg = result.response || "测试失败";
        try {
          const errorJson = JSON.parse(result.response);
          if (errorJson.error?.message) {
            errorMsg = `错误: ${errorJson.error.message}\n\n完整响应:\n${JSON.stringify(errorJson, null, 2)}`;
          } else if (errorJson.message) {
            errorMsg = `错误: ${errorJson.message}\n\n完整响应:\n${JSON.stringify(errorJson, null, 2)}`;
          } else {
            errorMsg = JSON.stringify(errorJson, null, 2);
          }
        } catch (e) {}
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
      if (runtimeEl) {
        runtimeEl.textContent =
          "transport: Node.js http(s).request\nstatus: failed before runtime data returned";
      }
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

  global.managementModels = {
    renderQuickAddButtons,
    inferProtocolFromApiType,
    updateApiTypeOptions,
    quickAddModel,
    toggleModelForm,
    cancelModelForm,
    getApiKeyStorageElements,
    isSecretRefStorageMode,
    parseExistingApiKeyRefFromForm,
    canKeepLegacySecretRefInEditMode,
    enforceApiKeyStorageModePolicy,
    getDefaultApiKeyStorageMode,
    applyDefaultApiKeyStorageMode,
    inferApiKeyStorageState,
    handleApiKeyStorageModeChange,
    loadModelsList,
    setPrimaryModel,
    editModel,
    deleteModel,
    submitModelForm,
    resetModelForm,
    testModelConnection,
  };

  Object.assign(global, global.managementModels);
})(window);
