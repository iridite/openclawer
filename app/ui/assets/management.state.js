// OpenClaw Management Console 全局状态与常量

// API 基础 URL
const API_BASE = "/api";

// 全局状态
let currentConfig = null;
let currentStatus = null;
let aceEditor = null; // Ace Editor 实例
let editorMode = "textarea"; // 编辑器模式：'ace' 或 'textarea'（默认 textarea）
let aceEditorLoaded = false; // Ace Editor 是否已加载
let aceEditorLoading = false; // Ace Editor 是否正在加载
let activeTooltipTarget = null;
let currentTabName = "overview";
let qqbotPluginInstalling = false;
let wecomPluginInstalling = false;

// 快速添加模型预设
const QUICK_ADD_MODELS = {
  "claude-sonnet-4-5": {
    modelId: "claude-sonnet-4-5",
    providerName: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiProtocol: "anthropic",
    apiType: "anthropic-messages",
    advanced: {
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
  },
  "qwen-plus": {
    modelId: "qwen-plus",
    providerName: "bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiProtocol: "openai",
    apiType: "openai-completions",
    advanced: {
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 131072,
      maxTokens: 8192,
    },
  },
  "doubao-pro-32k": {
    modelId: "doubao-pro-32k",
    providerName: "volcengine-plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiProtocol: "openai",
    apiType: "openai-completions",
    advanced: {
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 32768,
      maxTokens: 4096,
    },
  },
};

// 供应商 Base URL 映射
const PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "volcengine-plan": "https://ark.cn-beijing.volces.com/api/v3",
  moonshot: "https://api.moonshot.cn/v1",
};

// API 类型选项（OpenClaw 支持的所有 API 类型）
const API_TYPES = {
  openai: [
    { value: "openai-completions", label: "OpenAI Completions", default: true },
    { value: "openai-responses", label: "OpenAI Responses" },
    { value: "openai-codex-responses", label: "OpenAI Codex Responses" },
  ],
  anthropic: [
    { value: "anthropic-messages", label: "Anthropic Messages", default: true },
  ],
};
