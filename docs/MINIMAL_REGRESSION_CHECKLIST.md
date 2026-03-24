# Minimal Regression Checklist

更新时间：2026-03-18

本文档用于后续每个 Phase 或较大改动前后的最小回归核对。目标不是替代自动测试，而是在改动路径较广时，快速确认没有破坏当前核心行为。

## 使用方式

- 在实施前先确认本次改动会影响哪些条目。
- 在实施后逐项确认。
- 若某条目行为发生改变，必须同步更新：
  - 代码
  - README / docs
  - 对应 smoke 或其他测试

## 基线检查

- [ ] Management API 可启动，默认监听 `0.0.0.0:18790`
- [ ] `GET /api/status` 可返回有效 JSON
- [ ] `GET /` 可返回管理面板 HTML
- [ ] `GET /assets/management.js` 带有 `ETag`
- [ ] 静态资源二次请求可返回 `304`

## Dashboard 代理检查

- [ ] `GET /dashboard/` 在 Gateway 未启动时返回 `503` 或 `504`
- [ ] fallback 页面包含明确可恢复提示，而不是空白响应
- [ ] 原生控制台入口仍通过 `/dashboard/` 代理生成 URL

## 配置与写回检查

- [ ] `GET /api/config` 可读取配置，并返回配置版本头（`ETag` / `X-Config-Version`）
- [ ] `POST /api/config` 需携带 `If-Match`（或 `X-Config-Version`）并可在版本一致时成功写回
- [ ] `POST /api/config` 在版本冲突时返回 `409 config_version_conflict`
- [ ] `POST /api/config/validate` 可校验最小合法配置
- [ ] 模型主模型切换后，配置摘要与模型列表状态一致
- [ ] 渠道新增/编辑/删除后，配置摘要与列表状态一致

## 访问控制检查

- [ ] 管理访问说明仍与 README 中描述一致
- [ ] 关闭远程访问后，非本机来源语义应返回 `403`
- [ ] 项目仍不引入本地账号/密码认证

## 插件与技能检查

- [ ] 插件状态检查仍能区分 `installed / disabled / missing / unverified`
- [ ] 技能列表仍能区分 `builtin / user`
- [ ] 技能启用/禁用仍通过 `skills.entries` 生效

## 运维链路检查

- [ ] 配置重置仍优先使用初始快照
- [ ] 手动备份导出仍可生成有效归档
- [ ] 升级前后恢复逻辑未被无意破坏

## 最低验收要求

每次较大改动，至少应满足以下三项：

- [ ] `bash test/smoke.sh` 通过
- [ ] README / docs 已同步更新
- [ ] 本文档中与本次改动相关的条目已人工确认
