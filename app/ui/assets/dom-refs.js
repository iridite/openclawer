// DOM Reference Caching Module
// Reduces repeated getElementById calls by caching references

const refs = {
  // Dashboard elements
  dash: {
    gatewayStatus: null,
    proxyStatus: null,
    version: null,
    configStatus: null,
    cpuUsage: null,
    memoryUsage: null
  },

  // Gateway controls
  gateway: {
    statusBadge: null,
    startBtn: null,
    stopBtn: null
  },

  // Model form elements
  models: {
    formCard: null,
    formTitle: null,
    submitBtnText: null,
    list: null,
    editKey: null,
    idInput: null,
    providerInput: null,
    baseUrlInput: null,
    apiKeyInput: null,
    apiProtocolSelect: null,
    apiTypeSelect: null,
    contextWindow: null,
    maxTokens: null,
    reasoning: null,
    inputText: null,
    inputImage: null,
    testBtn: null,
    quickAddGrid: null
  },

  // Channel form elements
  channels: {
    formCard: null,
    formTitle: null,
    submitBtnText: null,
    list: null,
    editKey: null,
    typeSelect: null,
    tokenInput: null,
    enabledCheckbox: null,
    recommendedFields: null,
    advancedSection: null
  },

  // Telegram channel fields
  telegram: {
    dmPolicy: null,
    groupPolicy: null,
    allowFrom: null,
    groupAllowFrom: null
  },

  // Discord channel fields
  discord: {
    token: null
  },

  // Feishu channel fields
  feishu: {
    appId: null,
    appSecret: null,
    botName: null,
    dmPolicy: null
  },

  // QQBot channel fields
  qqbot: {
    appId: null,
    clientSecret: null,
    allowFrom: null,
    pluginBtn: null
  },

  // WeCom channel fields
  wecom: {
    botId: null,
    secret: null,
    dmPolicy: null,
    pluginBtn: null
  },

  // Config editor elements
  config: {
    summary: null,
    splitView: null,
    modelPanel: null,
    channelPanel: null,
    editorCard: null,
    templateCard: null,
    editorAce: null,
    editorTextarea: null
  },

  // Test panel elements
  test: {
    method: null,
    endpoint: null,
    command: null,
    response: null
  },

  // Version elements
  version: {
    current: null,
    latest: null,
    status: null,
    updateBtn: null
  },

  // Console elements
  console: {
    url: null,
    token: null
  },

  // Skills elements
  skills: {
    searchInput: null,
    searchBtn: null,
    searchResults: null,
    installedList: null,
    refreshBtn: null
  },

  // Logs elements
  logs: {
    content: null
  },

  // Advanced config
  advanced: {
    section: null,
    toggle: null
  },

  // Tool profiles
  toolProfiles: {
    input: null
  },

  // Global elements
  toast: null,
  tooltipPopup: null
};

// ID to ref path mapping for quick lookup
const idToRefPath = {
  "dash-gateway-status": "dash.gatewayStatus",
  "dash-proxy-status": "dash.proxyStatus",
  "dash-version": "dash.version",
  "dash-config-status": "dash.configStatus",
  "dash-cpu-usage": "dash.cpuUsage",
  "dash-memory-usage": "dash.memoryUsage",
  "gatewayStatus": "gateway.statusBadge",
  "start-gateway-btn": "gateway.startBtn",
  "stop-gateway-btn": "gateway.stopBtn",
  "model-form-card": "models.formCard",
  "form-title": "models.formTitle",
  "submit-btn-text": "models.submitBtnText",
  "models-list": "models.list",
  "edit-model-key": "models.editKey",
  "model-id": "models.idInput",
  "provider-name": "models.providerInput",
  "base-url": "models.baseUrlInput",
  "api-key": "models.apiKeyInput",
  "api-protocol": "models.apiProtocolSelect",
  "api-type": "models.apiTypeSelect",
  "context-window": "models.contextWindow",
  "max-tokens": "models.maxTokens",
  "reasoning": "models.reasoning",
  "input-type-text": "models.inputText",
  "input-image": "models.inputImage",
  "test-model-btn": "models.testBtn",
  "quick-add-grid": "models.quickAddGrid",
  "channel-form-card": "channels.formCard",
  "channel-form-title": "channels.formTitle",
  "channel-submit-btn-text": "channels.submitBtnText",
  "channels-list": "channels.list",
  "edit-channel-key": "channels.editKey",
  "channel-type": "channels.typeSelect",
  "channel-token": "channels.tokenInput",
  "channel-enabled": "channels.enabledCheckbox",
  "channel-recommended-fields": "channels.recommendedFields",
  "channel-advanced-section": "channels.advancedSection",
  "telegram-dm-policy": "telegram.dmPolicy",
  "telegram-group-policy": "telegram.groupPolicy",
  "telegram-allow-from": "telegram.allowFrom",
  "telegram-group-allow-from": "telegram.groupAllowFrom",
  "discord-token": "discord.token",
  "feishu-app-id": "feishu.appId",
  "feishu-app-secret": "feishu.appSecret",
  "feishu-bot-name": "feishu.botName",
  "feishu-dm-policy": "feishu.dmPolicy",
  "qqbot-app-id": "qqbot.appId",
  "qqbot-client-secret": "qqbot.clientSecret",
  "qqbot-allow-from": "qqbot.allowFrom",
  "qqbot-plugin-btn": "qqbot.pluginBtn",
  "wecom-bot-id": "wecom.botId",
  "wecom-secret": "wecom.secret",
  "wecom-dm-policy": "wecom.dmPolicy",
  "wecom-plugin-btn": "wecom.pluginBtn",
  "config-summary": "config.summary",
  "config-split-view": "config.splitView",
  "config-model-panel": "config.modelPanel",
  "config-channel-panel": "config.channelPanel",
  "config-editor-card": "config.editorCard",
  "config-template-card": "config.templateCard",
  "config-editor-ace": "config.editorAce",
  "config-editor-textarea": "config.editorTextarea",
  "test-method": "test.method",
  "test-endpoint": "test.endpoint",
  "test-command": "test.command",
  "test-response": "test.response",
  "ver-current": "version.current",
  "ver-latest": "version.latest",
  "ver-status": "version.status",
  "update-btn": "version.updateBtn",
  "console-url": "console.url",
  "console-token": "console.token",
  "skills-search-input": "skills.searchInput",
  "skills-search-btn": "skills.searchBtn",
  "skills-search-results": "skills.searchResults",
  "skills-installed-list": "skills.installedList",
  "skills-refresh-btn": "skills.refreshBtn",
  "log-content": "logs.content",
  "advanced-config": "advanced.section",
  "advanced-toggle": "advanced.toggle",
  "tool-profiles": "toolProfiles.input",
  "toast": "toast",
  "tooltip-popup": "tooltipPopup"
};

function initDomRefs() {
  // Dashboard
  refs.dash.gatewayStatus = document.getElementById("dash-gateway-status");
  refs.dash.proxyStatus = document.getElementById("dash-proxy-status");
  refs.dash.version = document.getElementById("dash-version");
  refs.dash.configStatus = document.getElementById("dash-config-status");
  refs.dash.cpuUsage = document.getElementById("dash-cpu-usage");
  refs.dash.memoryUsage = document.getElementById("dash-memory-usage");

  // Gateway controls
  refs.gateway.statusBadge = document.getElementById("gatewayStatus");
  refs.gateway.startBtn = document.getElementById("start-gateway-btn");
  refs.gateway.stopBtn = document.getElementById("stop-gateway-btn");

  // Model form
  refs.models.formCard = document.getElementById("model-form-card");
  refs.models.formTitle = document.getElementById("form-title");
  refs.models.submitBtnText = document.getElementById("submit-btn-text");
  refs.models.list = document.getElementById("models-list");
  refs.models.editKey = document.getElementById("edit-model-key");
  refs.models.idInput = document.getElementById("model-id");
  refs.models.providerInput = document.getElementById("provider-name");
  refs.models.baseUrlInput = document.getElementById("base-url");
  refs.models.apiKeyInput = document.getElementById("api-key");
  refs.models.apiProtocolSelect = document.getElementById("api-protocol");
  refs.models.apiTypeSelect = document.getElementById("api-type");
  refs.models.contextWindow = document.getElementById("context-window");
  refs.models.maxTokens = document.getElementById("max-tokens");
  refs.models.reasoning = document.getElementById("reasoning");
  refs.models.inputText = document.getElementById("input-type-text");
  refs.models.inputImage = document.getElementById("input-image");
  refs.models.testBtn = document.getElementById("test-model-btn");
  refs.models.quickAddGrid = document.getElementById("quick-add-grid");

  // Channel form
  refs.channels.formCard = document.getElementById("channel-form-card");
  refs.channels.formTitle = document.getElementById("channel-form-title");
  refs.channels.submitBtnText = document.getElementById("channel-submit-btn-text");
  refs.channels.list = document.getElementById("channels-list");
  refs.channels.editKey = document.getElementById("edit-channel-key");
  refs.channels.typeSelect = document.getElementById("channel-type");
  refs.channels.tokenInput = document.getElementById("channel-token");
  refs.channels.enabledCheckbox = document.getElementById("channel-enabled");
  refs.channels.recommendedFields = document.getElementById("channel-recommended-fields");
  refs.channels.advancedSection = document.getElementById("channel-advanced-section");

  // Telegram
  refs.telegram.dmPolicy = document.getElementById("telegram-dm-policy");
  refs.telegram.groupPolicy = document.getElementById("telegram-group-policy");
  refs.telegram.allowFrom = document.getElementById("telegram-allow-from");
  refs.telegram.groupAllowFrom = document.getElementById("telegram-group-allow-from");

  // Discord
  refs.discord.token = document.getElementById("discord-token");

  // Feishu
  refs.feishu.appId = document.getElementById("feishu-app-id");
  refs.feishu.appSecret = document.getElementById("feishu-app-secret");
  refs.feishu.botName = document.getElementById("feishu-bot-name");
  refs.feishu.dmPolicy = document.getElementById("feishu-dm-policy");

  // QQBot
  refs.qqbot.appId = document.getElementById("qqbot-app-id");
  refs.qqbot.clientSecret = document.getElementById("qqbot-client-secret");
  refs.qqbot.allowFrom = document.getElementById("qqbot-allow-from");
  refs.qqbot.pluginBtn = document.getElementById("qqbot-plugin-btn");

  // WeCom
  refs.wecom.botId = document.getElementById("wecom-bot-id");
  refs.wecom.secret = document.getElementById("wecom-secret");
  refs.wecom.dmPolicy = document.getElementById("wecom-dm-policy");
  refs.wecom.pluginBtn = document.getElementById("wecom-plugin-btn");

  // Config editor
  refs.config.summary = document.getElementById("config-summary");
  refs.config.splitView = document.getElementById("config-split-view");
  refs.config.modelPanel = document.getElementById("config-model-panel");
  refs.config.channelPanel = document.getElementById("config-channel-panel");
  refs.config.editorCard = document.getElementById("config-editor-card");
  refs.config.templateCard = document.getElementById("config-template-card");
  refs.config.editorAce = document.getElementById("config-editor-ace");
  refs.config.editorTextarea = document.getElementById("config-editor-textarea");

  // Test panel
  refs.test.method = document.getElementById("test-method");
  refs.test.endpoint = document.getElementById("test-endpoint");
  refs.test.command = document.getElementById("test-command");
  refs.test.response = document.getElementById("test-response");

  // Version
  refs.version.current = document.getElementById("ver-current");
  refs.version.latest = document.getElementById("ver-latest");
  refs.version.status = document.getElementById("ver-status");
  refs.version.updateBtn = document.getElementById("update-btn");

  // Console
  refs.console.url = document.getElementById("console-url");
  refs.console.token = document.getElementById("console-token");

  // Skills
  refs.skills.searchInput = document.getElementById("skills-search-input");
  refs.skills.searchBtn = document.getElementById("skills-search-btn");
  refs.skills.searchResults = document.getElementById("skills-search-results");
  refs.skills.installedList = document.getElementById("skills-installed-list");
  refs.skills.refreshBtn = document.getElementById("skills-refresh-btn");

  // Logs
  refs.logs.content = document.getElementById("log-content");

  // Advanced config
  refs.advanced.section = document.getElementById("advanced-config");
  refs.advanced.toggle = document.getElementById("advanced-toggle");

  // Tool profiles
  refs.toolProfiles.input = document.getElementById("tool-profiles");

  // Global
  refs.toast = document.getElementById("toast");
  refs.tooltipPopup = document.getElementById("tooltip-popup");
}

// Helper function: get element by ID with caching
function getEl(id) {
  const refPath = idToRefPath[id];
  if (refPath) {
    const parts = refPath.split('.');
    let ref = refs;
    for (const part of parts) {
      ref = ref?.[part];
      if (!ref) break;
    }
    if (ref) return ref;
  }
  return document.getElementById(id);
}

// Export to window
window.domRefs = refs;
window.initDomRefs = initDomRefs;
window.getEl = getEl;
