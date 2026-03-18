// Dashboard and overview actions

(function attachDashboardModule(global) {
  async function refreshDashboard() {
    try {
      const [status, config] = await Promise.all([
        apiRequest("/status"),
        apiRequest("/config"),
      ]);

      currentStatus = status;
      updateStatusBadge(status.gateway);

      const gatewayStatusText =
        status.gateway === "running" ? "运行中" : "已停止";
      const gatewayPidText =
        status.gatewayPid && status.gateway === "running"
          ? ` (PID: ${status.gatewayPid})`
          : "";
      const refs = global.domRefs;
      if (refs?.dash.gatewayStatus) {
        refs.dash.gatewayStatus.textContent = gatewayStatusText + gatewayPidText;
      }

      const proxyStatusText = status.proxy === "running" ? "运行中" : "已停止";
      const proxyPidText = status.proxyPid ? ` (PID: ${status.proxyPid})` : "";
      if (refs?.dash.proxyStatus) {
        refs.dash.proxyStatus.textContent = proxyStatusText + proxyPidText;
      }

      if (refs?.dash.version) {
        refs.dash.version.textContent = status.version || "unknown";
      }
      if (refs?.dash.configStatus) {
        refs.dash.configStatus.textContent = status.configExists ? "已配置" : "未配置";
      }

      if (status.system) {
        if (refs?.dash.cpuUsage) {
          refs.dash.cpuUsage.textContent =
            status.system.cpuUsage !== undefined
              ? `${status.system.cpuUsage.toFixed(1)}%`
              : "N/A";
        }

        const memoryEl =
          refs?.dash.memoryUsage || document.getElementById("dash-memory-usage");
        if (
          status.system.memoryPercent !== undefined &&
          status.system.memoryMB !== undefined
        ) {
          memoryEl.innerHTML = `${status.system.memoryPercent.toFixed(1)}% <span style="font-size: 0.8em; color: #888;">(${status.system.memoryMB.toFixed(1)} MB)</span>`;
        } else {
          memoryEl.textContent = "N/A";
        }
      }

      updateConfigSummary(config);
    } catch (error) {
      showToast("加载状态失败: " + error.message, "error");
    }
  }

  function updateConfigSummary(config) {
    try {
      const summaryEl = document.getElementById("config-summary");
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
          modelEntries.push({
            modelKey,
            urlHint,
            isPrimary: modelKey === primaryModel,
          });
        }
      }

      const modelCount = modelEntries.length;
      const channelCount = config.channels ? Object.keys(config.channels).length : 0;

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

      if (modelCount > 0) {
        html +=
          '<div style="margin-top: 15px;"><strong>已配置模型：</strong><ul style="margin: 5px 0; padding-left: 20px;">';
        for (const entry of modelEntries) {
          const activeTag = entry.isPrimary
            ? ' <span class="primary-badge primary-badge-inline">主模型</span>'
            : "";
          html += `<li><code>${entry.modelKey}</code>${entry.urlHint}${activeTag}</li>`;
        }
        html += "</ul></div>";
      } else {
        html += '<div style="margin-top: 15px;"><em>尚未配置 AI 模型</em></div>';
      }

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
    const refs = global.domRefs;
    const badge = refs?.gateway.statusBadge || document.getElementById("gatewayStatus");
    const statusText = badge.querySelector(".status-text");

    badge.className = "status-badge";

    const startBtn =
      refs?.gateway.startBtn || document.getElementById("start-gateway-btn");
    const stopBtn =
      refs?.gateway.stopBtn || document.getElementById("stop-gateway-btn");

    if (status === "running") {
      badge.classList.add("running");
      statusText.textContent = "运行中";
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      return;
    }

    badge.classList.add("stopped");
    statusText.textContent = "已停止";
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }

  async function startGateway() {
    if (!confirm("确定要启动 Gateway 吗？")) {
      return;
    }

    try {
      showToast("正在启动 Gateway...", "info");
      await apiRequest("/gateway/start", { method: "POST" });
      showToast("Gateway 启动成功", "success");
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

  global.managementDashboard = {
    refreshDashboard,
    updateConfigSummary,
    loadConfigSummary,
    updateStatusBadge,
    startGateway,
    stopGateway,
    restartGateway,
    refreshStatus,
  };

  Object.assign(global, global.managementDashboard);
})(window);
