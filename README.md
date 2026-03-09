# OC-Deploy for fnOS

一个为飞牛 NAS 设计的 OpenClaw AI Gateway 应用，提供完整的 Web 管理界面。

## 📋 项目简介

OpenClaw 是一个强大的 AI Agent Gateway，支持多种 AI 模型和通信渠道。本项目将 OpenClaw 打包为 FPK 格式，并提供完整的 Web 管理控制台，让用户可以轻松配置和管理 OpenClaw Gateway。

## ✨ 核心特性

### 🎯 Web 管理控制台
- **📊 仪表板**：实时监控 Gateway 运行状态（PID、CPU、内存）、版本信息、配置摘要
- **⚙️ 模型管理**：卡片式展示已配置模型，支持快速添加、编辑、删除
- **📝 配置编辑器**：可视化编辑 `openclaw.json`，支持自定义服务器
- **🎮 控制台集成**：内嵌 OpenClaw 原生控制台，无需跳转
- **📋 日志路径**：显示各类日志文件位置，方便故障排查

### 🔧 配置管理
- ✅ 快速添加模型（支持 OpenAI、Anthropic 协议）
- ✅ 卡片式模型管理（编辑、删除、查看详情）
- ✅ 支持自定义服务器（Custom baseURL）
- ✅ 消息渠道配置（Telegram、Discord、WhatsApp 等）
- ✅ JSON 格式实时验证
- ✅ 自动配置备份
- ✅ 预配置 Hybrid Reload 模式

### 📊 状态监控
- ✅ Gateway 运行状态监控（PID、CPU、内存使用情况）
- ✅ 快速操作（启动/停止/重启 Gateway）
- ✅ 版本信息查看
- ✅ 实时配置摘要更新

## 🚀 快速开始

### 安装

1. 下载 `oc-deploy_0.2.2_x86_64.fpk`
2. 在飞牛应用中心上传并安装
3. 等待安装完成（约 2-3 分钟，40% 时正在安装 npm 依赖）
4. 点击"启动"按钮
5. 点击"打开"按钮，自动进入管理控制台

### 首次配置

1. **进入模型管理**：点击"⚙️ 模型管理"标签
2. **快速添加模型**：
   - 点击"➕ 快速添加模型"按钮
   - 选择协议类型（OpenAI 或 Anthropic）
   - 填写模型名称、API Key、Base URL
   - 点击"添加模型"
3. **或手动编辑配置**：
   - 切换到"📝 配置编辑"标签
   - 编辑 JSON 配置
   - 点击"💾 保存配置"
4. **启动 Gateway**：返回仪表板，点击"▶️ 启动 Gateway"
5. **开始使用**：点击"🎮 控制台"标签，在内嵌控制台中使用

## 🏗️ 架构设计

```
用户 → fnOS App Center → Management Console (18790) → OpenClaw Gateway (18789)
```

### 端口分配
- **18790**：Management Console（用户访问入口）
- **18789**：OpenClaw Gateway（AI 服务）

### 核心组件
- **Management API**：提供 RESTful API（Node.js）
- **Web UI**：管理界面（HTML + CSS + Vanilla JS）
- **CGI Gateway**：fnOS 路由（index.cgi）
- **Lifecycle Scripts**：生命周期管理（cmd/main）
- **OpenClaw Gateway**：AI Agent 核心服务

## 📁 项目结构

```
oc-deploy/
├── app/
│   ├── server/
│   │   ├── management-api.js      # Management API 服务器
│   │   ├── iframe-proxy.js        # iframe 代理服务器
│   │   └── openclaw_global/       # OpenClaw 打包（安装时生成）
│   └── ui/
│       ├── management.html        # 管理界面
│       ├── index.html             # iframe 代理页面
│       ├── index.cgi              # CGI 网关
│       ├── token.js               # Token 管理
│       └── assets/                # 前端资源
│           ├── management.js      # 前端逻辑
│           └── management.css     # 样式表
├── cmd/
│   ├── main                       # 生命周期脚本
│   ├── install_callback           # 安装后回调
│   ├── install_init               # 安装前初始化
│   └── uninstall_init             # 卸载前清理
├── config/
│   ├── privilege                  # 权限配置
│   └── resource                   # 资源配置
├── wizard/                        # 安装向导
└── manifest                       # FPK 元数据
```

## 📝 配置示例

### AI 模型配置（支持自定义服务器）

```json
{
  "models": {
    "claude": {
      "provider": "anthropic",
      "apiKey": "sk-ant-...",
      "baseURL": "https://api.anthropic.com"
    },
    "custom-gpt": {
      "provider": "openai",
      "apiKey": "sk-...",
      "baseURL": "https://your-custom-server.com/v1"
    },
    "gemini": {
      "provider": "google",
      "apiKey": "AIza...",
      "baseURL": "https://generativelanguage.googleapis.com"
    }
  }
}
```

### 消息渠道配置

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "token": "123456:ABC-DEF",
      "enabled": true
    },
    "discord": {
      "type": "discord",
      "token": "bot_token",
      "enabled": true
    },
    "whatsapp": {
      "type": "whatsapp",
      "token": "whatsapp_token",
      "enabled": true
    }
  }
}
```

## 🔧 API 端点

```
GET  /api/status              - 获取系统状态（Gateway PID、CPU、内存）
GET  /api/config              - 获取配置
POST /api/config              - 保存配置
POST /api/config/validate     - 验证配置
POST /api/models/add          - 快速添加模型
POST /api/gateway/start       - 启动 Gateway
POST /api/gateway/stop        - 停止 Gateway
POST /api/gateway/restart     - 重启 Gateway
GET  /api/version/current     - 获取当前版本
GET  /api/console/url         - 获取控制台 URL（含 token）
GET  /api/logs?lines=100      - 获取日志
```

## 📚 文档

- **[使用指南](docs/WEB_MANAGEMENT_GUIDE.md)**：详细的用户使用文档
- **[架构文档](docs/WRAPPER_ARCHITECTURE.md)**：技术架构说明
- **[实现总结](docs/WEB_MANAGEMENT_IMPLEMENTATION.md)**：开发实现细节
- **[fnOS 规范](docs/FNOS_DEVELOPMENT_GUIDE.md)**：fnOS 开发标准

## 🎨 技术栈

### 后端
- **Node.js**：原生 HTTP 模块
- **child_process**：进程管理
- **fs/path**：文件系统操作

### 前端
- **HTML5 + CSS3**：页面结构和样式
- **Vanilla JavaScript**：前端逻辑
- **Fetch API**：HTTP 请求

### 部署
- **fnOS**：飞牛 NAS 平台
- **FPK**：打包格式
- **Bash**：生命周期脚本

## 💡 特性亮点

- ✅ **纯原生实现**：无需构建工具，直接部署
- ✅ **卡片式管理**：直观的模型管理界面
- ✅ **快速配置**：一键添加 AI 模型
- ✅ **实时验证**：JSON 格式检查、配置验证
- ✅ **内嵌控制台**：无需跳转，直接使用
- ✅ **响应式设计**：适配桌面和移动端
- ✅ **安全可靠**：配置备份、路径验证、错误处理
- ✅ **用户友好**：Toast 通知、自定义 Tooltip、状态更新

## 🔒 安全特性

- 配置文件自动备份（`.backup.时间戳`）
- JSON 格式验证
- 路径安全检查（防止目录穿越）
- 进程隔离
- Token 认证（控制台访问）

## 📊 系统要求

- **平台**：fnOS（飞牛 NAS）
- **架构**：x86_64
- **依赖**：nodejs_v22
- **端口**：18789（Gateway）、18790（Management）
- **内存**：建议 2GB+
- **存储**：建议 5GB+

## 🐛 故障排查

### Management API 无法访问

```bash
# 检查进程
ps aux | grep management-api

# 检查端口
ss -ltn | grep 18790

# 查看日志
tail -f /var/apps/oc-deploy/var/info.log
```

### Gateway 启动失败

```bash
# 检查配置
cat /root/.openclaw/openclaw.json

# 查看日志
tail -f /var/apps/oc-deploy/var/info.log

# 手动测试
cd /var/apps/oc-deploy/target
node app/server/openclaw_global/bin/openclaw gateway --port 18789
```

### 配置保存失败

1. 检查 JSON 格式是否正确
2. 检查配置文件目录权限
3. 查看浏览器控制台错误信息
4. 查看 API 日志

## 🧪 开发测试

### 本地测试

```bash
# 1. 设置环境变量
export TRIM_PKGVAR="/tmp/oc-deploy-test"
export TRIM_APPDEST="/tmp/oc-deploy-test"
export MANAGEMENT_PORT="18790"
export GATEWAY_PORT="18789"

# 2. 运行 Management API
node app/server/management-api.js

# 3. 访问管理界面
# 打开浏览器访问 http://localhost:18790/

# 4. 测试 API
curl http://localhost:18790/api/status
curl http://localhost:18790/api/config
```

### 打包 FPK

```bash
# 设置权限
chmod +x cmd/main
chmod +x cmd/install_callback
chmod +x cmd/install_init
chmod +x cmd/uninstall_init
chmod +x app/ui/index.cgi
chmod +x app/server/management-api.js

# 打包（从项目根目录）
tar -czf oc-deploy_0.2.2_x86_64.fpk app/ cmd/ config/ manifest wizard/
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 发起 Pull Request

## 📄 许可证

本项目遵循 OpenClaw 的许可证。

## 🔗 相关链接

- **OpenClaw 官方**：https://openclaw.ai
- **OpenClaw 文档**：https://docs.openclaw.ai
- **fnOS 开发者**：https://developer.fnnas.com
- **项目仓库**：https://github.com/iridite/oc-deploy

## 🙏 致谢

感谢 OpenClaw 团队开发了这个优秀的 AI Agent Gateway。

---

**版本**：0.2.2
**最后更新**：2026-03-09
**维护者**：iridite@github

**注意**：本项目是社区贡献的 FPK 打包版本，非 OpenClaw 官方发布。
