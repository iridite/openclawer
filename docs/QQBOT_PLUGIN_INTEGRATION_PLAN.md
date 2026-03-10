# QQBot 插件集成方案（待实现）

## 背景

`qqbot` 不是 OpenClaw 官方内置渠道。要让以下配置生效，必须先安装插件：

```bash
openclaw plugins install @tencent-connect/openclaw-qqbot@latest
```

目标是在 OC-Deploy 面板中把这一步纳入可视化流程，降低用户手动操作成本并减少配置失败。

## 目标

1. 在面板里可查看 QQ 插件是否已安装。
2. 用户配置 QQ 渠道时，可一键安装插件。
3. 保存 QQ 渠道时，若插件未安装，支持自动安装并继续保存。
4. 安装失败时，不保存 QQ 渠道配置，并给出明确错误提示。
5. 全流程可追踪（日志可查），避免黑盒失败。

## 推荐交互策略

采用“双保险”：

1. `QQ` 表单区提供“安装插件/重试安装”按钮（显式入口）。
2. 用户点击“保存 QQ 渠道”时做兜底检测：
   - 已安装：直接保存。
   - 未安装：先自动安装，成功后继续保存，失败则中断并提示。

## 后端改造（management-api）

### 1) 新增插件状态接口

- 路径：`GET /api/plugins/qqbot/status`
- 返回示例：

```json
{
  "success": true,
  "installed": true,
  "version": "x.y.z",
  "package": "@tencent-connect/openclaw-qqbot"
}
```

### 2) 新增插件安装接口

- 路径：`POST /api/plugins/qqbot/install`
- 固定执行命令（不允许前端传包名）：

```bash
openclaw plugins install @tencent-connect/openclaw-qqbot@latest
```

- 返回示例：

```json
{
  "success": true,
  "message": "QQ 插件安装成功"
}
```

### 3) 安全与稳定

1. 仅允许白名单固定命令，拒绝动态拼接 shell 参数。
2. 增加安装互斥锁（避免并发安装）。
3. 设定合理超时（建议 300s~600s）。
4. 安装日志写入现有 `info.log` / API 日志，便于定位失败原因。
5. 安装失败时返回简洁错误，详细输出写日志。

## 前端改造（channels / QQ）

### 1) QQ 配置区新增插件状态模块

展示：

1. 插件状态：`已安装` / `未安装` / `检测失败`
2. 操作按钮：`安装插件`（安装中禁用）

### 2) QQ 保存流程

当 `channelType === "qqbot"` 时：

1. 先校验 `appId`、`appSecret`。
2. 调用 `GET /api/plugins/qqbot/status`。
3. 若未安装，自动调用 `POST /api/plugins/qqbot/install`。
4. 安装成功后继续写入：

```json
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "...",
      "appSecret": "...",
      "groupPolicy": "open"
    }
  }
}
```

5. 安装失败则中断保存，并 toast 明确提示。

### 3) 文案建议

1. 状态：`QQ 插件未安装，保存前会自动安装`
2. 按钮：`安装 QQ 插件`
3. 失败：`QQ 插件安装失败，已取消保存，请检查网络后重试`

## 错误处理原则

1. JSON/config 校验错误：前端直接阻断。
2. 插件安装失败：阻断 QQ 渠道保存，不写入半成品配置。
3. 配置写入失败：toast + 保留表单数据。
4. 网关重启失败（若流程含自动重启）：提示失败但不回滚已保存配置。

## 实施顺序

1. 后端：状态/安装接口 + 互斥锁 + 日志。
2. 前端：QQ 区插件状态 UI + 安装按钮。
3. 前端：QQ 保存流程接入“安装兜底”。
4. 联调与 smoke 测试。

## Smoke 测试清单

1. 未安装插件时，保存 QQ 渠道：
   - 自动安装成功 -> 配置保存成功。
2. 未安装插件且网络异常：
   - 安装失败 -> 配置不保存，提示清晰。
3. 已安装插件时，保存 QQ 渠道：
   - 直接保存，无额外安装。
4. 安装按钮可重复重试，且并发点击不会发起多个安装任务。
5. 编辑已有 QQ 渠道可正常保存。

## 验收标准

1. 用户无需 SSH 手动执行插件安装即可在面板完成 QQ 渠道配置。
2. 未安装场景下，保存流程结果可预期（成功或明确失败）。
3. 日志可定位插件安装失败原因。
4. 不影响 Telegram / Discord / 飞书已有流程。
