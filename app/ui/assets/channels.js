// Channel type handlers
const channelHandlers = {
  telegram: {
    showFields() {
      const config = document.getElementById("telegram-specific-config");
      const advanced = document.getElementById("telegram-advanced-config");
      if (config) config.style.display = "block";
      if (advanced) advanced.style.display = "block";
    },

    setDefaults(isEditMode) {
      if (isEditMode) return;
      const dmPolicy = document.getElementById("telegram-dm-policy");
      const groupPolicy = document.getElementById("telegram-group-policy");
      const allowFrom = document.getElementById("telegram-allow-from");
      const groupAllowFrom = document.getElementById("telegram-group-allow-from");
      if (dmPolicy) dmPolicy.value = "open";
      if (groupPolicy) groupPolicy.value = "open";
      if (allowFrom) allowFrom.value = "*";
      if (groupAllowFrom) groupAllowFrom.value = "";
    },

    validate() {
      const token = document.getElementById("channel-token");
      if (!token || !token.value.trim()) {
        showToast("请输入 Telegram Bot Token", "error");
        return false;
      }
      return true;
    },

    buildConfig() {
      const dmPolicy = document.getElementById("telegram-dm-policy").value;
      const groupPolicy = document.getElementById("telegram-group-policy").value;
      const token = document.getElementById("channel-token").value.trim();
      const allowFrom = document.getElementById("telegram-allow-from").value.split(",").map(s => s.trim()).filter(Boolean);
      const groupAllowFrom = document.getElementById("telegram-group-allow-from").value.split(",").map(s => s.trim()).filter(Boolean);

      let groups = {};
      if (groupPolicy !== "disabled") {
        groups = {
          "*": {
            requireMention: groupPolicy !== "open"
          }
        };
        if (groupAllowFrom.length > 0) {
          groups["*"].allowFrom = groupAllowFrom;
        }
      }

      return {
        botToken: token,
        dmPolicy,
        allowFrom: allowFrom.length ? allowFrom : ["*"],
        groups
      };
    },

    populateForm(config) {
      const token = config.botToken || "";
      const tokenField = document.getElementById("channel-token");
      if (tokenField) tokenField.value = token;

      document.getElementById("telegram-dm-policy").value = config.dmPolicy || "open";

      const group = config.groups?.["*"];
      let groupPolicy = "disabled";
      if (group) {
        groupPolicy = group.requireMention === false ? "open" : "allowlist";
      }
      document.getElementById("telegram-group-policy").value = groupPolicy;

      document.getElementById("telegram-allow-from").value = (config.allowFrom || ["*"]).join(", ");
      document.getElementById("telegram-group-allow-from").value = (group?.allowFrom || []).join(", ");
    },

    needsToken: true,
    hasAdvanced: true
  },

  discord: {
    showFields() {
      const config = document.getElementById("discord-specific-config");
      if (config) config.style.display = "block";
    },

    setDefaults() {},

    validate() {
      const token = document.getElementById("discord-token");
      if (!token || !token.value.trim()) {
        showToast("请输入 Discord Bot Token", "error");
        return false;
      }
      return true;
    },

    buildConfig() {
      return {
        token: document.getElementById("discord-token").value.trim()
      };
    },

    populateForm(config) {
      document.getElementById("discord-token").value = config.token || "";
    },

    needsToken: false,
    hasAdvanced: false
  },

  feishu: {
    showFields() {
      const config = document.getElementById("feishu-specific-config");
      const advanced = document.getElementById("feishu-advanced-config");
      if (config) config.style.display = "block";
      if (advanced) advanced.style.display = "block";
    },

    setDefaults() {},

    validate() {
      const appId = document.getElementById("feishu-app-id");
      const appSecret = document.getElementById("feishu-app-secret");
      if (!appId || !appId.value.trim()) {
        showToast("请输入飞书 App ID", "error");
        return false;
      }
      if (!appSecret || !appSecret.value.trim()) {
        showToast("请输入飞书 App Secret", "error");
        return false;
      }
      return true;
    },

    buildConfig() {
      const appId = document.getElementById("feishu-app-id").value.trim();
      const appSecret = document.getElementById("feishu-app-secret").value.trim();
      const botName = document.getElementById("feishu-bot-name").value.trim();
      const dmPolicy = document.getElementById("feishu-dm-policy").value;
      const allowFromInput = document.getElementById("feishu-allow-from");
      const allowFrom = (allowFromInput?.value || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      return {
        accounts: {
          main: { appId, appSecret, botName }
        },
        dmPolicy,
        allowFrom: allowFrom.length ? allowFrom : ["*"]
      };
    },

    populateForm(config) {
      const main = config.accounts?.main || {};
      document.getElementById("feishu-app-id").value = main.appId || "";
      document.getElementById("feishu-app-secret").value = main.appSecret || "";
      document.getElementById("feishu-bot-name").value = main.botName || "";
      document.getElementById("feishu-dm-policy").value = config.dmPolicy || "open";
      const allowFromInput = document.getElementById("feishu-allow-from");
      if (allowFromInput) {
        allowFromInput.value = (config.allowFrom || ["*"]).join(", ");
      }
    },

    needsToken: false,
    hasAdvanced: true
  },

  qqbot: {
    showFields() {
      const config = document.getElementById("qqbot-specific-config");
      const advanced = document.getElementById("qqbot-advanced-config");
      if (config) config.style.display = "block";
      if (advanced) advanced.style.display = "block";
      if (window.refreshQqbotPluginStatus) window.refreshQqbotPluginStatus();
    },

    setDefaults(isEditMode) {
      if (isEditMode) return;
      const allowFrom = document.getElementById("qqbot-allow-from");
      if (allowFrom && !allowFrom.value) allowFrom.value = "*";
    },

    validate() {
      const appId = document.getElementById("qqbot-app-id");
      const clientSecret = document.getElementById("qqbot-client-secret");
      if (!appId || !appId.value.trim()) {
        showToast("请输入 QQ Bot App ID", "error");
        return false;
      }
      if (!clientSecret || !clientSecret.value.trim()) {
        showToast("请输入 QQ Bot Client Secret", "error");
        return false;
      }
      return true;
    },

    buildConfig() {
      const appId = document.getElementById("qqbot-app-id").value.trim();
      const clientSecret = document.getElementById("qqbot-client-secret").value.trim();
      const allowFrom = document.getElementById("qqbot-allow-from").value.split(",").map(s => s.trim()).filter(Boolean);

      return {
        appId,
        clientSecret,
        allowFrom: allowFrom.length ? allowFrom : ["*"]
      };
    },

    populateForm(config) {
      document.getElementById("qqbot-app-id").value = config.appId || "";
      document.getElementById("qqbot-client-secret").value = config.clientSecret || "";
      document.getElementById("qqbot-allow-from").value = (config.allowFrom || ["*"]).join(", ");
    },

    needsToken: false,
    hasAdvanced: true
  },

  wecom: {
    showFields() {
      const config = document.getElementById("wecom-specific-config");
      if (config) config.style.display = "block";
      if (window.refreshWecomPluginStatus) window.refreshWecomPluginStatus();
    },

    setDefaults(isEditMode) {
      if (isEditMode) return;
      const dmPolicy = document.getElementById("wecom-dm-policy");
      if (dmPolicy) dmPolicy.value = "open";
    },

    validate() {
      const botId = document.getElementById("wecom-bot-id");
      const secret = document.getElementById("wecom-secret");
      if (!botId || !botId.value.trim()) {
        showToast("请输入企业微信 Bot ID", "error");
        return false;
      }
      if (!secret || !secret.value.trim()) {
        showToast("请输入企业微信 Secret", "error");
        return false;
      }
      return true;
    },

    buildConfig() {
      const botId = document.getElementById("wecom-bot-id").value.trim();
      const secret = document.getElementById("wecom-secret").value.trim();
      const dmPolicy = document.getElementById("wecom-dm-policy").value;

      return { botId, secret, dmPolicy };
    },

    populateForm(config) {
      document.getElementById("wecom-bot-id").value = config.botId || "";
      document.getElementById("wecom-secret").value = config.secret || "";
      document.getElementById("wecom-dm-policy").value = config.dmPolicy || "open";
    },

    needsToken: false,
    hasAdvanced: false
  }
};

window.channelHandlers = channelHandlers;
