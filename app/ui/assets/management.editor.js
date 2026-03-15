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

    // 分析配置影响
    const impact = await apiRequest("/config/analyze-impact", {
      method: "POST",
      body: JSON.stringify(config),
    });

    // 如果需要重启，显示确认对话框
    if (impact.requiresRestart && impact.affectedAreas.length > 0) {
      const message =
        "此配置变更将影响以下功能：\n\n" +
        impact.affectedAreas.map((area) => `• ${area}`).join("\n") +
        "\n\n需要重启 Gateway 以生效，这将中断当前所有连接。\n\n确定要保存并重启吗？";

      if (!confirm(message)) {
        return;
      }
    }

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

function parseDownloadFileName(contentDisposition, fallbackName) {
  if (!contentDisposition) return fallbackName;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (err) {}
  }
  const plainMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1];
  }
  return fallbackName;
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

async function exportFullBackup() {
  const fallbackName = `oc-deploy-backup-manual-export-${buildConfigExportFileName().replace("openclaw-", "").replace(".json", ".tar.gz")}`;
  try {
    showToast("正在导出完整备份（包含配置、记忆与插件）...", "info");
    const response = await fetch(`${API_BASE}/backup/export`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = await response.json();
        message = payload.error || payload.message || message;
      } catch (err) {}
      throw new Error(message);
    }

    const blob = await response.blob();
    const fileName = parseDownloadFileName(
      response.headers.get("content-disposition"),
      fallbackName,
    );
    const downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    showToast(`完整备份已导出：${fileName}`, "success");
  } catch (error) {
    showToast("导出完整备份失败: " + error.message, "error");
  }
}

function triggerFullBackupImport() {
  const input = document.getElementById("full-backup-file");
  if (!input) {
    showToast("未找到完整备份上传控件", "error");
    return;
  }
  input.value = "";
  input.click();
}

async function handleFullBackupImportFile(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }

  const confirmed = confirm(
    "确定要导入完整备份吗？\n\n该操作会覆盖配置、记忆与插件目录（append 覆写），并尝试自动重启 Gateway。\n系统会先创建一份导入前备份。",
  );
  if (!confirmed) {
    event.target.value = "";
    return;
  }

  try {
    showToast("正在上传并导入完整备份，请稍候...", "info");
    const formData = new FormData();
    formData.append("backupFile", file);

    const response = await fetch(`${API_BASE}/backup/import`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new Error(
        result.error || result.message || `HTTP ${response.status}`,
      );
    }

    await Promise.all([
      loadConfig(),
      loadModelsList(),
      loadChannelsList(),
      refreshDashboard(),
    ]);

    const restoredHint =
      typeof result.restoredCount === "number"
        ? `已恢复 ${result.restoredCount} 项`
        : "恢复完成";
    if (result.restarted) {
      showToast(
        `完整备份导入成功，${restoredHint}，Gateway 已重启。`,
        "success",
      );
    } else {
      showToast(
        `完整备份已导入，${restoredHint}；Gateway 自动重启失败: ${result.restartError || "未知错误"}`,
        "warning",
      );
    }
    if (result.preBackupWarning) {
      showToast("导入前备份提示: " + result.preBackupWarning, "warning");
    } else if (result.preBackupPath) {
      showToast("已生成导入前备份: " + result.preBackupPath, "info");
    }
  } catch (error) {
    showToast("导入完整备份失败: " + error.message, "error");
  } finally {
    event.target.value = "";
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
