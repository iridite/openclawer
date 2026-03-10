# UI 重构回归记录（阶段性）

日期：2026-03-10

关联提交：
- 1d4629b
- b252020

## 1. 结论摘要

1. 不能在当前开发环境下“100% 保证”全部原有功能都正常。
2. 原因是后端配置文件路径硬编码为 `/root/.openclaw/openclaw.json`，当前环境无写权限，导致配置写入类接口无法完成真实写测。
3. 在可执行范围内，前端结构、tab 映射、可访问性、无 emoji 改造、非写入 API 均已通过自动检查。

## 2. 已完成自动化验证

## 2.1 语法与结构

1. `node --check app/ui/assets/management.js`：通过
2. `node --check app/server/management-api.js`：通过
3. HTML `id` 与 JS `getElementById` 引用一致性检查：通过（动态创建 `tooltip-popup` 除外）
4. 顶层 tab 与 `loadTabData` case 映射一致性检查：通过

## 2.2 UI 重构一致性

1. 顶层 tab 已统一为：`概览/模型/渠道/配置/系统`
2. 主流程去 emoji 扫描：通过（`management.html` / `management.js` / `management.css`）
3. `Ctrl+S` 仅在“配置”tab 生效：通过代码检查
4. Tab 无障碍基础属性：
   - `tablist/tab/tabpanel`
   - `aria-selected`
   - `tabindex`
   - 键盘方向键/Home/End 导航
   均已接入

## 2.3 API 烟测（当前环境）

在本地临时端口启动 management-api 后：

1. `GET /api/status`：200
2. `GET /api/config`：200
3. `GET /api/console/url`：200
4. `POST /api/config/validate`：200

### 受限项（非代码缺陷）

1. `POST /api/config`：500
2. `POST /api/config/reset`：500

日志显示根因：`EACCES: permission denied, mkdir '/root/.openclaw'`

这属于运行环境权限限制，不是本次 UI 重构引入的功能退化证据。

## 3. 必须在 fnOS 真机补测的项目

以下项必须在目标环境执行后，才能给出“功能全部正常”的结论：

1. Gateway 启动/停止/重启闭环
2. 模型：添加/编辑/删除/激活切换
3. 渠道：添加/编辑/删除（Telegram/Feishu/Discord）
4. 配置编辑器：保存、复制、恢复原始配置
5. 原生控制面板入口：两个入口均可跳转并自动携带 token
6. 版本检查与更新流程

## 4. 当前风险评估

1. 高风险：低（核心逻辑未大改，主要是 UI 架构和交互层）
2. 中风险：中（tab 重排后的加载时机，需真机手测确认）
3. 低风险：低（文案、样式、焦点态）

## 5. 下一步建议

1. 在 fnOS 环境按手册第 11 节执行全量回归并记录结果。
2. 若全部通过，再给出“原有功能全部正常”最终结论。
3. 如发现回归，优先回滚到 checkpoint（1d4629b）对比定位。

