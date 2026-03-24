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
- JSON 校验异常会阻断保存/导入，并显示具体错误
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
- 安装向导支持选择配置位置：`/root/.openclaw`（推荐）或应用目录 `.../var/.openclaw`

### ⚙️ 首次配置

1. 在“模型”页添加模型（推荐区先填最小必需项）
2. 在“渠道”页添加消息渠道（可参考页面内置示例）
3. 在“概览”页启动 Gateway
4. 需要智能体/会话管理时进入原生控制面板（dashboard）

## 🌐 访问边界说明

管理服务默认监听 `0.0.0.0:18790`，也就是所有网卡都会接收连接；但“是否允许非内网来源访问”仍由管理访问策略决定。这两件事不是同一个层面：

- `BIND_ADDR=0.0.0.0`：解决的是“进程监听在哪些网卡上”
- WebUI「系统 -> 管理访问」：解决的是“收到请求后，是否允许非内网地址（公网/WAN）继续访问面板/API”

几种常见访问方式的语义如下：

- fnOS 默认中继访问：通常可以正常打开，因为请求会先经过 fnOS 提供的中继/转发链路，再回到本机管理服务
- 局域网直连访问：例如 `http://NAS_IP:18790`，默认允许（只要 18790 端口在局域网内可达）
- 互联网/WAN 访问：默认拒绝；只有在 WebUI「系统 -> 管理访问」中开启“允许非内网地址访问”后才允许
- 反向代理访问：是否放行取决于管理服务看到的来源地址。若代理部署在本机并回源到 loopback，则可按代理头识别客户端地址；若来自非本机来源，服务将优先使用实际对端地址进行访问判定

“管理访问”开关只负责访问面控制，不负责以下事项：

- 不改变监听端口或监听地址
- 不替代反向代理、端口转发或 fnOS 中继配置
- 不提供本地账号/密码认证

项目当前的安全边界决策是：

- 不引入本地账号/密码认证
- 管理面板/API 的暴露范围仅通过网络边界和“管理访问”开关控制
- 默认仅允许本机与局域网访问；如需开放公网访问，请自行确保反向代理与边界网络策略已加固

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
POST /api/config/analyze-impact
GET  /api/management/access
POST /api/management/access
GET  /api/security/api-key-protection
POST /api/security/api-key-protection
GET  /api/logs?lines=100
GET  /api/console/url
GET  /api/system/paths
```

管理访问说明：

- 默认仅允许本机与局域网访问管理面板/API（进程仍监听 `0.0.0.0`）
- 如需放开互联网/WAN 访问，可在 WebUI 的「系统」->「管理访问」中开启“允许非内网地址访问”；关闭时非内网来源会收到 `403 forbidden`
- 该设置保存后立即生效，并持久化到 `/var/apps/oc-deploy/var/management-access.json`
- 项目决策：不引入本地账号/密码认证；管理面板访问控制仅通过网络边界（内网/反代）与“管理访问”开关实现

### 模型与渠道

```text
POST /api/models/add
POST /api/models/primary
POST /api/models/delete
POST /api/models/test/prepare
POST /api/models/test
POST /api/channels/upsert
POST /api/channels/delete
POST /api/tools/profile
```

高频写回说明：

- 模型主模型切换已走 `POST /api/models/primary`
- 渠道新增/编辑已走 `POST /api/channels/upsert`
- 渠道删除已走 `POST /api/channels/delete`
- Tool Profiles 切换已走 `POST /api/tools/profile`
- `POST /api/config` 继续保留给 JSON 编辑器、配置导入和高级用户全量编辑

`/api/config` 写回并发保护：

- `GET /api/config` 会返回配置版本头：`ETag` 与 `X-Config-Version`
- `POST /api/config` 需携带 `If-Match`（或 `X-Config-Version`）以声明预期版本
- 若版本不一致，接口返回 `409`，错误码 `config_version_conflict`，前端需提示用户刷新后重试

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
GET  /api/plugins/wecom/status
POST /api/plugins/wecom/install
```

### 备份与技能

```text
GET  /api/backup/export
POST /api/backup/import
GET  /api/skills/search?q=xxx
GET  /api/skills/list
POST /api/skills/install
POST /api/skills/uninstall
POST /api/skills/toggle
POST /api/skills/update
```

注意：

- `/api/version/update` 已实现基础升级流程（停止 Gateway -> npm 安装最新 OpenClaw -> 重启 Gateway）

## 🛠️ 开发指南

### 测试与打包

#### Management API 环境变量

以下变量在 `app/server/core/env.js` 中读取，可用于覆盖默认行为：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `MANAGEMENT_PORT` | `18790` | Management API 监听端口 |
| `BIND_ADDR` | `0.0.0.0` | Management API 监听地址（默认监听所有网卡） |
| `TRIM_PKGVAR` | `/var/apps/oc-deploy/var` | 应用数据目录（日志、PID、运行时文件） |
| `TRIM_APPDEST` | `/var/apps/oc-deploy/target` | 应用静态资源根目录（管理界面位于 `${TRIM_APPDEST}/ui`） |
| `USER_BACKUP_ROOT` | `/root/oc-deploy/user-backups` | 手动导出/导入前备份的持久化目录 |
| `MAX_BACKUP_UPLOAD_BYTES` | `536870912` | 完整备份导入的最大上传体积限制（字节） |
| `API_MAX_BODY_BYTES` | `5242880` | JSON API 请求体大小上限（字节，默认 5MB） |
| `MANAGEMENT_ALLOW_REMOTE_DEFAULT` | `true` | 管理访问默认是否允许非内网来源（首次启动生效，已有持久化配置优先） |
| `MODEL_TEST_TIMEOUT_MS` | `15000` | 模型连通性测试超时时间（毫秒） |
| `SKILLS_SEARCH_API` | `https://lightmake.site/api/v1/search` | 技能搜索接口地址 |
| `SKILLS_PRIMARY_DOWNLOAD_API` | `https://lightmake.site/api/v1/download` | 技能主下载接口地址 |
| `SKILLS_FALLBACK_DOWNLOAD_BASE` | `https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills` | 技能备用下载地址前缀 |

#### 本地运行

```bash
export TRIM_PKGVAR="/tmp/oc-deploy-test"
export TRIM_APPDEST="$(pwd)/app"
export MANAGEMENT_PORT="18790"
export BIND_ADDR="0.0.0.0"
export GATEWAY_PORT="18789"
node app/server/management-api.js
```

#### 轻量 smoke 测试

```bash
bash test/smoke.sh
```

#### 全量冗余回归（复杂改动建议）

```bash
bash test/full-regression.sh
```

用于一次性覆盖安装脚本、PATH 注入、配置写回、访问策略、备份导入导出、技能安装等高风险链路。

#### 备份导入回归

```bash
bash test/backup-import-regression.sh
```

该测试会走完整的 `/api/backup/export` + `/api/backup/import` 链路，验证 multipart 备份导入、恢复结果与流式上传实现。

#### 管理访问策略回归

```bash
bash test/access-policy-regression.sh
```

该测试覆盖默认允许公网来源、关闭 `allowRemote` 后拦截公网来源、以及开关切换后的即时生效语义。

当前 smoke 基线覆盖：

- management-api 启动与 `GET /api/status`
- `GET /api/status` 不再返回网关 token 明文，仅返回 `tokenConfigured` 状态位
- 静态首页可访问
- 静态资源 `ETag / 304` 协商
- `GET /dashboard/` 在 Gateway 未启动时返回 fallback 页面
- `GET /api/config`
- `POST /api/config/validate`
- `GET /api/console/url`
- `GET /api/logs`

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

### 局域网访问失败 / 反代访问异常

优先区分报错类型：

- 浏览器直接显示“拒绝连接”：先检查 `18790` 端口是否真的在 NAS 上监听、是否被宿主机/防火墙拦截，以及反向代理是否回源到正确地址
- 接口返回 `403 forbidden`：说明请求已经到达管理服务，但被“管理访问”策略拒绝
- 接口返回 `502 bad gateway`：通常是 fnOS 中继、反向代理或回源链路本身异常，不是前端表单参数问题

建议排查：

```bash
ss -ltnp | grep 18790
curl -i http://127.0.0.1:18790/api/status
curl -i http://127.0.0.1:18790/api/management/access
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

### QQ / WeCom 插件安装失败

若出现 `plugins.allow is empty`，在 `openclaw.json` 中加入：

```json
{
  "plugins": {
    "allow": ["openclaw-qqbot", "wecom-openclaw-plugin"]
  }
}
```

若报错包含 `git@github.com`、`Permission denied (publickey)`、`git+ssh`：

- 通常不是插件包本身要求 SSH，而是系统 Git 配置把 `https://github.com` 重写成了 SSH
- 可先检查：

```bash
git config --global --get-regexp '^url\\..*\\.insteadof$'
git config --system --get-regexp '^url\\..*\\.insteadof$'
```

- 若存在将 GitHub 改写到 SSH 的规则，移除后再重试插件安装
- OC-Deploy 当前已在插件安装链路中强制优先使用 HTTPS registry，并屏蔽全局 Git rewrite 以降低该类失败概率

## 📚 文档

- `CLAUDE.md`：开发与维护说明
- `TODO.md`：需求与迭代清单
- `docs/PHASE0_BASELINE.md`：当前运行基线
- `docs/MINIMAL_REGRESSION_CHECKLIST.md`：最小回归检查清单
- `docs/PROJECT_ANALYSIS.md`：项目结构分析
- `docs/IMPLEMENTATION_PLAN.md`：分阶段实施计划
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

- **Manifest 版本**: `1.2.1`
- **Release 标签**: `v1.2.1`
- **最后更新**: `2026-03-17`
- **维护者**: [@iridite](https://github.com/iridite)

---

<div align="center">

**⚠️ 免责声明**

本项目是社区贡献的 FPK 打包版本，非 OpenClaw 官方发布。

如果觉得这个项目对你有帮助，请给个 ⭐️ Star 支持一下！

Made with ❤️ by the community

</div>
