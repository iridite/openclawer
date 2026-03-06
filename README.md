# OpenClaw for fnOS

一个为飞牛 NAS 设计的 OpenClaw AI Gateway 应用，提供完整的 Web 管理界面。

## 📋 项目简介

OpenClaw 是一个强大的 AI Agent Gateway，支持多种 AI 模型和通信渠道。本项目将 OpenClaw 打包为 FPK 格式，并提供完整的 Web 管理控制台，让用户可以轻松配置和管理 OpenClaw Gateway。

## ✨ 核心特性

### 🎯 Web 管理控制台
- **📊 仪表板**：实时监控 Gateway 运行状态、版本信息、配置摘要
- **⚙️ 配置编辑器**：可视化编辑 `openclaw.json`，支持自定义服务器
- **🔄 版本管理**：查看版本信息，检查更新
- **🎮 控制台集成**：一键跳转到 OpenClaw 原生控制台

### 🔧 配置管理
- ✅ 实时编辑 AI 模型配置（Claude、GPT-4、Gemini 等）
- ✅ 支持自定义服务器（Custom baseURL）
- ✅ 消息渠道配置（Telegram、Discord、WhatsApp 等）
- ✅ JSON 格式实时验证
- ✅ 自动配置备份

### 📊 状态监控
- ✅ Gateway 运行状态监控
- ✅ 进程 PID 显示
- ✅ 版本信息查看
- ✅ 实时日志查看

## 🚀 快速开始

### 安装

1. 下载 `openclaw_2026.2.26_x86_64.fpk`
2. 在飞牛应用中心上传并安装
3. 点击"启动"按钮
4. 点击"打开"按钮，自动进入管理控制台

### 首次配置

1. **进入配置编辑器**：点击"⚙️ 配置编辑"标签
2. **添加 AI 模型**：
   ```json
   {
     "models": {
       "claude": {
         "provider": "anthropic",
         "apiKey": "sk-ant-...",
         "baseURL": "https://api.anthropic.com"
       }
     }
   }
   ```
3. **添加消息渠道**：
   ```json
   {
     "channels": {
       "telegram": {
         "type": "telegram",
         "token": "123456:ABC-DEF",
         "enabled": true
       }
     }
   }
   ```
4. **保存配置**：点击"💾 保存配置"
5. **重启 Gateway**：返回仪表板，点击"🔄 重启 Gateway"
6. **开始使用**：点击"🎮 进入控制台"

## 🏗️ 架构设计

```
用户 → fnOS App Center → Management Console (18790) → OpenClaw Gateway (18789)
```

### 端口分配
- **18790**：Management Console（用户访问入口）
- **18789**：OpenClaw Gateway（AI 服务）

### 核心组件
- **Management API**：提供 RESTful API
- **Web UI**：管理界面（HTML + CSS + JS）
- **CGI Gateway**：fnOS 路由
- **Lifecycle Scripts**：生命周期管理

## 📁 项目结构

```
openclawer/
├── src/
│   ├── app/
│   │   ├── server/
│   │   │   ├── management-api.js      # Management API 服务器
│   │   │   ├── openclaw_global/       # OpenClaw 打包
│   │   │   └── node/                  # Node.js 运行时
│   │   └── ui/
│   │       ├── management.html        # 管理界面
│   │       ├── index.cgi              # CGI 网关
│   │       └── assets/                # 前端资源
│   ├── cmd/
│   │   └── main                       # 生命周期脚本
│   ├── config/
│   │   ├── privilege                  # 权限配置
│   │   └── resource                   # 资源配置
│   ├── wizard/                        # 用户向导
│   └── manifest                       # FPK 元数据
└── docs/                              # 文档
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
GET  /api/status              - 获取系统状态
GET  /api/config              - 获取配置
POST /api/config              - 保存配置
POST /api/config/validate     - 验证配置
POST /api/gateway/restart     - 重启 Gateway
GET  /api/version/current     - 获取当前版本
GET  /api/version/latest      - 获取最新版本
POST /api/version/update      - 更新版本
GET  /api/console/url         - ��取控制台 URL
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
- ✅ **实时验证**：JSON 格式检查、配置验证
- ✅ **响应式设计**：适配桌面和移动端
- ✅ **安全可靠**：配置备份、路径验证、错误处理
- ✅ **用户友好**：Toast 通知、加载动画、状态更新

## 🔒 安全特性

- 配置文件自动备份（`.backup.时间戳`）
- JSON 格式验证
- 路径安全检查（防止目录穿越）
- 进程隔离
- 应用用户权限（openclaw:openclaw）

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
tail -f /var/apps/openclaw/var/openclaw.log
```

### Gateway 启动失败

```bash
# 检查配置
cat /var/apps/openclaw/var/data/.openclaw/openclaw.json

# 查看日志
tail -f /var/apps/openclaw/var/openclaw.log

# 手动测试
cd /var/apps/openclaw/target
./server/openclaw_global/bin/openclaw gateway --port 18789
```

### 配置保存失败

1. 检查 JSON 格式是否正确
2. 检查配置文件目录权限
3. 查看浏览器控制台错误信息
4. 查看 API 日志

## 🧪 开发测试

### 本地测试

```bash
# 1. 运行测试脚本
./test-management.sh

# 2. 访问管理界面
http://localhost:18790/

# 3. 测试 API
curl http://localhost:18790/api/status
curl http://localhost:18790/api/config
```

### 打包 FPK

```bash
# 设置权限
chmod +x src/cmd/main
chmod +x src/app/ui/index.cgi
chmod +x src/app/server/management-api.js

# 打包
cd src
tar -czf ../openclaw_2026.2.26_x86_64.fpk .
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
- **问题反馈**：https://github.com/openclaw/openclaw/issues

## 🙏 致谢

感谢 OpenClaw 团队开发了这个优秀的 AI Agent Gateway。

---

**版本**：2026.2.26
**最后更新**：2026-03-06
**维护者**：OpenClawer 项目组

**注意**：本项目是社区贡献的 FPK 打包版本，非 OpenClaw 官方发布。
