# Phase 0 Baseline

更新时间：2026-03-18

本文档用于固化 OC-Deploy 在进入后续重构前的运行基线。除非有明确设计变更，否则以下行为应视为“当前行为即预期行为”。

## 运行边界

- Management API 默认监听所有网卡地址。
  - 默认值：`BIND_ADDR=0.0.0.0`
  - 配置来源：[`app/server/core/env.js`](../app/server/core/env.js)

- Management API 默认监听端口 `18790`。
  - 配置来源：[`app/server/core/env.js`](../app/server/core/env.js)

- OpenClaw Gateway 默认监听端口 `18789`。
  - 配置来源：[`app/server/core/env.js`](../app/server/core/env.js)

- OpenClaw Gateway 默认使用 `gateway.bind="lan"`。
  - 语义：监听所有网卡（等价于 `0.0.0.0`）
  - 这是项目当前默认行为，后续阶段不应无意改回 `loopback` 或其他更收敛的绑定模式
  - 配置来源：[`app/server/core/default-config.js`](../app/server/core/default-config.js)

- 管理面板不引入本地账号/密码认证。
  - 当前访问控制方式：网络边界 + “管理访问”开关
  - 相关说明：[`README.md`](../README.md)

- `dashboard` 通过 Management API 的 `/dashboard` 代理访问，而不是要求用户直接访问 Gateway 端口。
  - 代理实现：[`app/server/http/dashboard-proxy.js`](../app/server/http/dashboard-proxy.js)

## 管理访问语义

- 默认允许远程访问管理面板/API。
- 如关闭“管理访问”远程开关，非本机来源请求应返回 `403`，而不是依赖本地认证拦截。
- 走本机回源的代理或中继链路，仍可在“本机来源”语义下访问服务。

## 配置中心语义

- `openclaw.json` 是主配置中心。
- `oc-deploy-secrets.json` 是受管密钥存储。
- `management-access.json` 负责管理访问状态。
- `api-key-protection.json` 负责 API key 保护开关状态。
- `.skills_store_lock.json` 负责用户技能安装状态持久化。

## 默认产品边界

- OC-Deploy 负责部署、启停、配置、升级、插件、技能、备份、运维入口。
- OpenClaw 原生 dashboard 负责智能体、会话与运行时操作。
- OC-Deploy 不试图替代原生 dashboard，而是增强其部署和运维可用性。

## 插件与技能语义

- 插件安装后，不以 `npm install` 成功作为最终完成标准。
- 插件必须通过运行时元数据与渠道声明校验，并在需要时修复 `plugins.allow`。
- 技能启用/禁用通过 `openclaw.json.skills.entries` 生效，不以目录存在与否作为启用状态判断。

## 安装与重置语义

- 安装初始化后，OC-Deploy 会主动 patch OpenClaw 默认配置，而不是完全依赖 `openclaw setup` 原始输出。
- 配置重置优先恢复初始快照；不存在快照时再使用 fallback 默认配置。

## 后续阶段不得无意改变的行为

- `http://<host>:18790/dashboard/` 仍然必须是访问原生控制台的稳定入口。
- dashboard 上游未就绪时，代理应返回可恢复的 fallback 页面，而不是直接挂死或返回空白页。
- management-api 仍应在 Gateway 挂掉时可单独启动并提供诊断与恢复入口。
- 轻量 smoke 测试应继续作为最小快速验证手段。
