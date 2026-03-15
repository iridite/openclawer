<div align="center">

# 🚀 OC-Deploy for fnOS

**一键部署 OpenClaw Gateway 到飞牛 NAS**

[![GitHub release](https://img.shields.io/github/v/release/iridite/openclawer?style=flat-square)](https://github.com/iridite/openclawer/releases)
[![License](https://img.shields.io/github/license/iridite/openclawer?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/iridite/openclawer?style=flat-square)](https://github.com/iridite/openclawer/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/iridite/openclawer?style=flat-square)](https://github.com/iridite/openclawer/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/iridite/openclawer/pulls)

[English](README_EN.md) | 简体中文

</div>

---

## 📖 项目简介

OC-Deploy 将 OpenClaw Gateway 封装为 fnOS FPK 应用，并提供 Web 管理界面。

### ✨ 特性

- 🎯 **一键部署** - 通过 fnOS 应用中心快速安装
- 🖥️ **可视化管理** - 直观的 Web 控制面板
- 🤖 **多模型支持** - 轻松配置 OpenAI、Claude 等多种 AI 模型
- 💬 **多渠道接入** - 支持 Telegram、Discord、飞书、QQ 等消息平台
- 📊 **实时监控** - Gateway 状态、CPU、内存实时监控
- 🔧 **配置管理** - 可视化编辑器 + JSON 导入导出
- 🔌 **插件系统** - 支持扩展插件安装与管理

### 🏗️ 架构

```
用户 -> fnOS App Center -> Management Console (18790) -> /dashboard 代理 -> OpenClaw Gateway (18789)
```

**职责分工：**

- **OC-Deploy**：网关启停、配置管理、模型/渠道配置、插件安装
- **原生 dashboard**：智能体、会话和运行时使用

## 📸 界面展示

| 截图 | 说明 |
|------|------|
| ![概览页面](images/Screenshot@2026-03-15%2010-40-01.png) | 概览页面：显示 Gateway 运行状态、系统资源监控（CPU/内存）、配置摘要和快速操作入口 |
| ![模型管理](images/Screenshot@2026-03-15%2011-11-05.png) | 模型管理：支持添加、编辑、删除模型，主模型高亮显示，分为推荐配置和高级配置 |
| ![渠道管理](images/Screenshot@2026-03-15%2011-11-09.png) | 渠道管理：配置 Telegram、Discord、飞书、QQ 等消息渠道，提供配置引导和示例 |
| ![配置编辑器](images/Screenshot@2026-03-15%2011-11-31.png) | 配置编辑器：支持直接编辑 JSON 配置文件，提供导入/导出/复制/重置功能 |
| ![日志查看](images/Screenshot@2026-03-15%2011-11-36.png) | 日志查看：实时查看 Gateway 运行日志，支持刷新和查看完整日志文件路径 |

## 💡 核心能力

### 管理面板

- 仪表板：Gateway 状态、PID、CPU、内存、配置摘要
- 模型管理：快速添加、编辑、删除，主模型边框高亮
- 渠道管理：Telegram / Discord / 飞书 / QQ
- 配置编辑器：导入 / 导出 / 复制 / 恢复原始配置
- 原生控制面板入口：自动拼接 token，走 `/dashboard` 代理
- 日志路径展示：便于排障

### 配置体验

- 模型与渠道表单均分为“推荐配置 / 高级配置”
- 渠道配置引导卡片集中展示关键字段与最小示例
- JSON 校验异常会提示，但不强制阻断保存
- 一键恢复原始配置后自动重启 Gateway
- QQ 渠道支持插件状态检测与一键安装

### 关键规则

- 模型 ID 支持：字母、数字、`-`、`.`、`/`、`:`
- 供应商名称仅支持小写英文：`a-z`
- 渠道以类型作为 key（同类型仅保留一条）

## 🚀 快速开始

### 📦 安装

1. 访问 Releases：`https://github.com/iridite/openclawer/releases`
2. 下载最新发布包并上传到 fnOS 应用中心安装
3. 安装完成后点击“启动”
4. 点击“打开”进入管理控制台

安装提示：

- 40% / 55% 卡住通常是在线安装 npm 依赖
- 安装时长依赖网络环境
- 安装向导包含用户条款摘要，继续安装视为同意

### ⚙️ 首次配置

1. 在“模型”页添加模型（推荐区先填最小必需项）
2. 在“渠道”页添加消息渠道（可参考页面内置示例）
3. 在“概览”页启动 Gateway
4. 需要智能体/会话管理时进入原生控制面板（dashboard）

## 📁 项目结构

```text
oc-deploy/
├── app/
│   ├── server/
│   │   └── management-api.js
│   └── ui/
│       ├── management.html
│       ├── assets/
│       │   ├── management.js
│       │   └── management.css
│       ├── config
│       └── images/
├── cmd/
│   ├── main
│   ├── install_init / install_callback
│   ├── upgrade_init / upgrade_callback
│   ├── config_init / config_callback
│   └── uninstall_init / uninstall_callback
├── config/
├── wizard/
├── test/
│   ├── smoke.sh
│   ├── local-test.sh
│   ├── setup-test-env.sh
│   └── README.md
├── manifest
└── TODO.md
```

## 📝 配置示例

### 模型配置（新结构）

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "apiKey": "sk-...",
        "baseUrl": "https://api.openai.com/v1",
        "api": "openai-completions",
        "models": [
          { "id": "gpt-4o", "name": "gpt-4o" },
          { "id": "azure:gpt-4o", "name": "azure:gpt-4o" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "openai/gpt-4o" },
      "models": {
        "openai/gpt-4o": {}
      }
    }
  }
}
```

### 渠道配置

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123:abc",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groups": { "*": { "requireMention": true } }
    },
    "discord": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN"
    },
    "feishu": {
      "enabled": true,
      "dmPolicy": "open",
      "accounts": {
        "main": {
          "appId": "cli_xxx",
          "appSecret": "xxx",
          "botName": "MyBot"
        }
      }
    },
    "qqbot": {
      "enabled": true,
      "allowFrom": ["*"],
      "appId": "1903321275",
      "clientSecret": "xxxx"
    }
  }
}
```

QQ 说明：

- 需要安装 `@tencent-connect/openclaw-qqbot`
- 面板内提供状态检测和安装入口
- 若报 `plugins.allow is empty`，需在 `openclaw.json` 中允许 `openclaw-qqbot`

## 🔌 API 列表

### 系统与配置

```text
GET  /api/status
GET  /api/config
POST /api/config
POST /api/config/reset
POST /api/config/validate
GET  /api/logs?lines=100
GET  /api/console/url
```

### 模型与渠道

```text
POST /api/models/add
POST /api/models/delete
```

### 网关控制

```text
POST /api/gateway/start
POST /api/gateway/stop
POST /api/gateway/restart
```

### 版本与插件

```text
GET  /api/version/current
GET  /api/version/latest
POST /api/version/update
GET  /api/plugins/qqbot/status
POST /api/plugins/qqbot/install
```

注意：

- `/api/version/update` 当前为占位实现，返回 `success: false`（尚未完成在线升级逻辑）

## 🛠️ 开发指南

### 测试与打包

#### 本地运行

```bash
export TRIM_PKGVAR="/tmp/oc-deploy-test"
export TRIM_APPDEST="/tmp/oc-deploy-test"
export MANAGEMENT_PORT="18790"
export GATEWAY_PORT="18789"
node app/server/management-api.js
```

#### 轻量 smoke 测试

```bash
bash test/smoke.sh
```

#### 打包 FPK

```bash
chmod +x cmd/main cmd/install_callback cmd/install_init cmd/uninstall_init cmd/upgrade_init cmd/upgrade_callback
chmod +x app/server/management-api.js
tar -czf oc-deploy.fpk app/ cmd/ config/ manifest wizard/
```

## 🔍 故障排查

### 端口占用 / API 启动失败

```bash
ss -ltn | grep 18790
lsof -ti:18790 | xargs kill -9
tail -n 100 /var/apps/oc-deploy/var/info.log
```

### Gateway 启动失败

```bash
ls -la /var/apps/oc-deploy/var/node_modules/.bin/openclaw
tail -n 100 /var/apps/oc-deploy/var/openclaw.log
```

### 400 no body

常见于模型配置不匹配导致上游没有返回可用响应体，优先检查：

- 模型 ID
- Base URL
- API 协议 / API 类型

是否与供应商文档一致。

### QQ 插件安装失败

若出现 `plugins.allow is empty`，在 `openclaw.json` 中加入：

```json
{
  "plugins": {
    "allow": ["openclaw-qqbot"]
  }
}
```

## 📚 文档

- `CLAUDE.md`：开发与维护说明
- `TODO.md`：需求与迭代清单
- `test/README.md`：本地测试脚本说明

## 🔗 相关链接

- OpenClaw 官方：`https://openclaw.ai`
- OpenClaw 文档：`https://docs.openclaw.ai`
- 项目仓库：`https://github.com/iridite/openclawer`

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [OpenClaw](https://openclaw.ai) - 强大的 AI Gateway 框架
- [fnOS](https://www.fnnas.com) - 飞牛 NAS 操作系统
- 所有贡献者和用户

## 📊 项目信息

- **Manifest 版本**: `1.0.0`
- **Release 标签**: `v1.1.0`
- **最后更新**: `2026-03-15`
- **维护者**: [@iridite](https://github.com/iridite)

---

<div align="center">

**⚠️ 免责声明**

本项目是社区贡献的 FPK 打包版本，非 OpenClaw 官方发布。

如果觉得这个项目对你有帮助，请给个 ⭐️ Star 支持一下！

Made with ❤️ by the community

</div>

