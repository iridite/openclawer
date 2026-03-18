// Channels tab and plugin installation actions

(function attachChannelsModule(global) {
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
        const channelType = inferChannelType(channelId, channel);
        const displayName = getChannelDisplayLabel(channelType, channelId);
        const badgeText = getChannelBadgeText(channelType, channel);
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
          if (channel.token) {
            infoItems.push(`Token: ${channel.token.substring(0, 10)}...`);
          }
        } else if (channelType === "feishu") {
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

      channelsListEl.querySelectorAll(".edit-channel-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          editChannel(btn.dataset.channel);
        });
      });

      channelsListEl.querySelectorAll(".delete-channel-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          deleteChannel(btn.dataset.channel);
        });
      });
    } catch (error) {
      document.getElementById("channels-list").innerHTML =
        '<p class="loading">加载失败: ' + error.message + "</p>";
    }
  }

  function handleChannelTypeChange() {
    const channelType = document.getElementById("channel-type").value;
    const recommendedFields = document.getElementById("channel-recommended-fields");
    const advancedSection = document.getElementById("channel-advanced-section");
    const editKey = document.getElementById("edit-channel-key")?.value || "";
    const isEditMode = !!editKey;
    const tokenField = document.getElementById("channel-token");

    ["telegram", "discord", "qqbot", "feishu", "wecom"].forEach((type) => {
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

    const handler = global.channelHandlers?.[channelType];
    if (handler) {
      if (tokenField) {
        if (handler.needsToken) {
          tokenField.parentElement.style.display = "block";
          tokenField.setAttribute("required", "required");
        } else {
          tokenField.parentElement.style.display = "none";
          tokenField.removeAttribute("required");
        }
      }

      handler.showFields();
      handler.setDefaults(isEditMode);

      if (advancedSection) {
        advancedSection.style.display = handler.hasAdvanced ? "block" : "none";
      }
    }
  }

  function toggleChannelForm() {
    const formCard = document.getElementById("channel-form-card");
    const formTitle = document.getElementById("channel-form-title");
    const submitBtnText = document.getElementById("channel-submit-btn-text");

    formCard.style.display = "block";
    formTitle.textContent = "添加消息渠道";
    submitBtnText.textContent = "添加消息渠道";

    document.getElementById("edit-channel-key").value = "";
    document.getElementById("channel-type").value = "";
    document.getElementById("channel-type").disabled = false;
    document.getElementById("channel-token").value = "";
    document.getElementById("channel-enabled").checked = true;

    const dmPolicyEl = document.getElementById("telegram-dm-policy");
    if (dmPolicyEl) dmPolicyEl.value = "open";
    const groupPolicyEl = document.getElementById("telegram-group-policy");
    if (groupPolicyEl) groupPolicyEl.value = "open";
    const allowFromEl = document.getElementById("telegram-allow-from");
    if (allowFromEl) allowFromEl.value = "*";
    const groupAllowFromEl = document.getElementById("telegram-group-allow-from");
    if (groupAllowFromEl) groupAllowFromEl.value = "";

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

    handleChannelTypeChange();

    const channelTypeEl = document.getElementById("channel-type");
    if (channelTypeEl) {
      channelTypeEl.removeEventListener("change", handleChannelTypeChange);
      channelTypeEl.addEventListener("change", handleChannelTypeChange);
    }

    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelChannelForm() {
    document.getElementById("channel-form-card").style.display = "none";
    document.getElementById("add-channel-form").reset();
    document.getElementById("edit-channel-key").value = "";
    document.getElementById("channel-type").disabled = false;
  }

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

    const handler = global.channelHandlers?.[channelType];

    if (handler && handler.needsToken && !token) {
      showToast("请输入 Token", "error");
      return;
    }

    if (handler && !handler.validate()) {
      return;
    }

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

      const channelId = editKey || channelType;
      let channelPayload = null;

      if (handler) {
        const channelConfig = handler.buildConfig();
        channelPayload = {
          enabled,
          ...channelConfig,
        };

        if (handler.needsToken && token) {
          channelPayload.botToken = token;
        }
      } else {
        channelPayload = {
          enabled,
          botToken: token,
        };
      }

      await apiRequest("/channels/upsert", {
        method: "POST",
        body: JSON.stringify({
          channelId,
          editKey,
          channel: channelPayload,
        }),
      });

      showToast(isEditMode ? "渠道修改成功！" : "消息渠道添加成功！", "success");

      await loadChannelsList();
      await global.loadConfigSummary();
      await loadConfig();
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
        showToast(
          status.message || "检测到 QQ 插件异常，正在尝试重新安装",
          "info",
        );
      }
    } catch (error) {
      setQqbotPluginButtonState("error");
      showToast("QQ 插件状态检测失败: " + error.message, "error");
      return false;
    }

    return installQqbotPlugin();
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
      const strategyText = result?.installStrategy
        ? `（${result.installStrategy}）`
        : "";
      showToast((result?.message || "QQ 插件安装成功") + strategyText, "success");
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
          status.message || "检测到企业微信插件异常，正在尝试重新安装",
          "info",
        );
      }
    } catch (error) {
      setWecomPluginButtonState("error");
      showToast("企业微信插件状态检测失败: " + error.message, "error");
      return false;
    }

    return installWecomPlugin();
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
      const strategyText = result?.installStrategy
        ? `（${result.installStrategy}）`
        : "";
      showToast(
        (result?.message || "企业微信插件安装成功") + strategyText,
        "success",
      );
      wecomPluginInstalling = false;
      return true;
    } catch (error) {
      setWecomPluginButtonState("missing");
      showToast("企业微信插件安装失败: " + error.message, "error");
      wecomPluginInstalling = false;
      return false;
    }
  }

  async function editChannel(channelId) {
    try {
      const config = await apiRequest("/config");
      const channel = config.channels[channelId];

      if (!channel) {
        showToast("渠道不存在", "error");
        return;
      }

      const channelType = inferChannelType(channelId, channel);
      const formCard = document.getElementById("channel-form-card");
      const formTitle = document.getElementById("channel-form-title");
      const submitBtnText = document.getElementById("channel-submit-btn-text");

      formCard.style.display = "block";
      formTitle.textContent = "编辑消息渠道";
      submitBtnText.textContent = "保存修改";

      document.getElementById("edit-channel-key").value = channelId;
      document.getElementById("channel-type").value = channelType;
      document.getElementById("channel-type").disabled = false;
      document.getElementById("channel-token").value =
        channel.botToken || channel.token || "";
      document.getElementById("channel-enabled").checked =
        channel.enabled !== false;

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

      if (channelType === "discord") {
        const discordTokenEl = document.getElementById("discord-token");
        if (discordTokenEl) discordTokenEl.value = channel.token || "";
      }

      if (channelType === "feishu" && channel.accounts && channel.accounts.main) {
        const mainAccount = channel.accounts.main;
        const appIdEl = document.getElementById("feishu-app-id");
        if (appIdEl) appIdEl.value = mainAccount.appId || "";

        const appSecretEl = document.getElementById("feishu-app-secret");
        if (appSecretEl) appSecretEl.value = mainAccount.appSecret || "";

        const botNameEl = document.getElementById("feishu-bot-name");
        if (botNameEl) botNameEl.value = mainAccount.botName || "";

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

      if (channelType === "wecom") {
        const wecomBotIdEl = document.getElementById("wecom-bot-id");
        if (wecomBotIdEl) wecomBotIdEl.value = channel.botId || "";

        const wecomSecretEl = document.getElementById("wecom-secret");
        if (wecomSecretEl) wecomSecretEl.value = channel.secret || "";

        const wecomDmPolicyEl = document.getElementById("wecom-dm-policy");
        if (wecomDmPolicyEl) wecomDmPolicyEl.value = channel.dmPolicy || "open";
      }

      handleChannelTypeChange();

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

  async function deleteChannel(channelId) {
    if (!confirm(`确定要删除渠道 "${channelId}" 吗？此操作不可撤销。`)) {
      return;
    }

    try {
      showToast("正在删除渠道...", "info");
      await apiRequest("/channels/delete", {
        method: "POST",
        body: JSON.stringify({ channelId }),
      });

      showToast("渠道删除成功！", "success");
      await loadChannelsList();
      await global.loadConfigSummary();
      await loadConfig();
    } catch (error) {
      showToast("删除渠道失败: " + error.message, "error");
    }
  }

  global.managementChannelsUi = {
    inferChannelType,
    getChannelDisplayLabel,
    getChannelIdentityValue,
    getChannelBadgeText,
    parseCommaList,
    normalizeAllowFrom,
    inferTelegramGroupPolicy,
    loadChannelsList,
    handleChannelTypeChange,
    toggleChannelForm,
    cancelChannelForm,
    submitChannelForm,
    fetchQqbotPluginStatus,
    setQqbotPluginButtonState,
    refreshQqbotPluginStatus,
    ensureQqbotPluginInstalled,
    installQqbotPlugin,
    fetchWecomPluginStatus,
    setWecomPluginButtonState,
    refreshWecomPluginStatus,
    ensureWecomPluginInstalled,
    installWecomPlugin,
    editChannel,
    deleteChannel,
  };

  Object.assign(global, global.managementChannelsUi);
})(window);
