# OpenClaw 本地测试指南

本目录包含用于本地测试 WebUI 和 OpenClaw 交互的脚本。

## 🚀 快速开始

### 1. 准备测试环境

```bash
cd oc-deploy
bash test/setup-test-env.sh
```

> 如果本地依赖较新或缺少构建工具，`setup-test-env.sh` 可能因为 OpenClaw 依赖安装失败（例如 sharp 需要编译）。
> 推荐先运行下方的“轻量 smoke 测试”，它不依赖 OpenClaw 安装。

这会：
- 创建 `test/test-data/` 目录模拟 fnOS 的 `TRIM_PKGVAR`
- 安装 OpenClaw 到 `test/test-data/node_modules/`
- 生成测试 token
- 创建默认配置文件
- 生成 `.env.test` 环境变量文件

### 2. 启动测试

```bash
bash test/local-test.sh
```

选择操作：
- `1` - 只启动 Management API (Web 管理界面)
- `2` - 只启动 OpenClaw Gateway
- `3` - 同时启动两者 (推荐)
- `4` - 测试 API 连接
- `5` - 查看日志
- `6` - 停止所有服务

## ✅ 轻量 smoke 测试（推荐）

不依赖 OpenClaw 安装，启动 Management API 并检查关键 API：

```bash
bash test/smoke.sh
```

## 🧪 全量冗余回归（复杂改动必跑）

当涉及安装流程、插件链路、访问策略、配置写回等复杂改动时，建议直接跑：

```bash
bash test/full-regression.sh
```

该脚本会串行执行：语法检查、PATH 注入守卫、核心 API 回归、访问策略回归、配置版本冲突回归、备份边界回归、备份导入回归、技能本地安装回归。

可选加速参数（在本机资源稳定时建议开启）：

```bash
SMOKE_READY_MAX_ATTEMPTS=10 SMOKE_READY_INTERVAL_SECONDS=0.05 SMOKE_HTTP_MAX_TIME_SECONDS=1 bash test/smoke.sh
```

检查项包含：
- Management API 启动就绪
- `/` 静态首页可访问
- `/assets/management.js` 的 `ETag / 304` 缓存协商
- `/dashboard/` 在 Gateway 未启动时返回 fallback 页面
- `/api/status`
- `/api/config`
- `/api/config/validate`
- `/api/console/url`
- `/api/logs`

说明：
- 这条 smoke 的目标是验证“管理面板主链路仍可工作”，不是覆盖升级、插件安装、技能下载或真实 Gateway 运行时能力。
- 若后续改动涉及高风险流程，请同时参考 [`docs/MINIMAL_REGRESSION_CHECKLIST.md`](../docs/MINIMAL_REGRESSION_CHECKLIST.md)。

## 🔁 备份/升级边界回归

用于验证升级前备份和升级后恢复是否仍然覆盖同一份共享备份清单：

```bash
bash test/backup-boundary.sh
```

检查项包含：
- 共享备份规格清单可被升级脚本正确读取
- `upgrade_init` 生成的 manifest 条目数与规格清单一致
- `upgrade_callback` 可以按 manifest 将所有备份项恢复回来

## 📦 备份导入回归

用于验证完整备份导入链路仍可工作，并且 multipart 上传按流式方式落盘，不再整包读入内存：

```bash
bash test/backup-import-regression.sh
```

检查项包含：
- `/api/backup/export` 可生成有效备份包
- `/api/backup/import` 可通过 `multipart/form-data` 导入备份
- 导入后 `.openclaw` 与 `plugins` 中的样例内容可恢复
- 大文件样例可恢复，覆盖流式上传与解包链路

## 🔗 关键能力链路回归

用于验证高风险但不依赖外网的核心能力链路：

```bash
bash test/capability-regression.sh
```

检查项包含：
- 模型添加、编辑、主模型切换、删除
- 渠道添加、编辑、删除
- API Key 防护切换与 `managed-file` SecretRef 写入
- QQ / WeCom 插件状态识别与 `plugins.allow` 自动修正
- user / builtin 技能列表识别与启用/禁用写入
- 常见 `400 / 404` 错误语义返回

## 🧩 本地技能安装回归

用于验证技能安装/更新/卸载链路在本地 zip 包场景下仍可工作，重点覆盖异步解压与锁文件更新：

```bash
bash test/skills-install-local.sh
```

检查项包含：
- 本地 zip 技能包可成功安装到 `OC_HOME/skills`
- `list()` 可识别已安装技能
- `update()` 可复用安装链路完成覆盖更新
- `uninstall()` 可清理技能目录与锁文件记录

## 🌐 前端请求入口约束回归

用于验证前端网络请求仍然通过统一 helper 进入，而不是在各模块中散落裸 `fetch`：

```bash
bash test/frontend-request-entry.sh
```

检查项包含：
- `management.js` 中存在 `apiRequest` / `apiFormRequest` / `apiDownloadRequest`
- 其他前端模块不允许直接使用 `fetch`
- 不允许引入 `XMLHttpRequest` 或 `navigator.sendBeacon` 等额外入口

## 🧭 高优先错误语义回归

用于验证版本升级和插件安装两条高优先链路在失败时返回非 `200` 且语义化错误码：

```bash
bash test/priority-error-semantics.sh
```

检查项包含：
- `/api/version/update` 对 npm/registry 失败归类为 `502 bad_gateway`
- `/api/version/update` 对网关重启失败归类为 `409 conflict`
- 插件安装并发冲突归类为 `409 conflict`
- 插件安装命令失败、运行时校验失败归类为 `502 bad_gateway`

## 🛡️ 管理访问策略回归

用于验证“默认允许公网来源、可收敛为拒绝公网、允许 LAN、开关可即时生效”的访问边界：

```bash
bash test/access-policy-regression.sh
```

检查项包含：
- 默认 `allowRemote=true` 时，公网来源可访问
- 关闭 `allowRemote` 后，公网来源（`X-Forwarded-For`/`X-Real-IP`）返回 `403 forbidden`
- 静态页面与 API 都遵循同一访问策略
- LAN 来源默认允许
- 切换 `allowRemote` 后，公网来源放行/拦截行为即时变化

## 🔐 配置版本冲突回归

用于验证 `/api/config` 的乐观锁写回语义（`If-Match` 版本校验）：

```bash
bash test/config-version-conflict.sh
```

检查项包含：
- `GET /api/config` 返回 `X-Config-Version` / `ETag`
- 携带正确 `If-Match` 保存返回 `200`
- 携带过期/错误 `If-Match` 保存返回 `409`
- 冲突响应 `code` 为 `config_version_conflict`

### 3. 访问测试界面

启动后访问：
- **Management API**: http://localhost:18790
- **OpenClaw Gateway**: http://localhost:18789

## 📂 测试目录结构

```
test/
├── setup-test-env.sh      # 环境准备脚本
├── local-test.sh          # 测试启动脚本
├── .env.test             # 环境变量 (自动生成)
├── test-data/            # 测试数据目录 (自动生成)
│   ├── node_modules/     # OpenClaw 安装目录
│   ├── data/.openclaw/   # 配置文件
│   ├── gateway_token     # 测试 token
│   ├── gateway.pid       # Gateway PID
│   └── logs/            # 日志目录
└── README.md            # 本文件
```

## 🔧 手动启动 (高级)

```bash
# 加载环境变量
source test/.env.test

# 启动 Management API
node app/server/management-api.js

# 启动 Gateway (另一个终端)
openclaw gateway --port 18789 --token $(cat test/test-data/gateway_token)
```

## 🧪 测试清单

- [ ] WebUI 能正常访问
- [ ] 仪表板显示正确的状态
- [ ] 配置编辑功能正常
- [ ] 版本检查不超时
- [ ] Gateway 控制 (启动/停止/重启)
- [ ] 日志查看功能
- [ ] Toast 错误提示显示正常
- [ ] 前后端 API 通信正常

## 🧹 清理测试环境

```bash
# 停止所有服务
bash test/local-test.sh  # 选择 6

# 删除测试数据 (可选)
rm -rf test/test-data
rm test/.env.test
```

## 💡 常见问题

### Q: OpenClaw 命令找不到？
A: 确保运行了 `setup-test-env.sh`，它会将 openclaw 添加到 PATH。
或者手动添加：
```bash
export PATH="$(pwd)/test/test-data/node_modules/.bin:$PATH"
```

### Q: 端口被占用？
A: 修改 `.env.test` 中的端口号，或停止占用端口的进程：
```bash
lsof -ti:18790 | xargs kill
lsof -ti:18789 | xargs kill
```

### Q: npm 命令超时？
A: 配置 npm 镜像：
```bash
npm config set registry https://registry.npmmirror.com
```

### Q: 想使用不同版本的 OpenClaw？
A: 删除 `test/test-data/node_modules` 后重新运行 `setup-test-env.sh`，
或手动安装：
```bash
cd test/test-data
npm install openclaw@版本号
```

### Q: Management API 启动失败？
A: 检查环境变量是否正确加载：
```bash
source test/.env.test
echo $TRIM_PKGVAR
echo $TRIM_APPDEST
```

### Q: 前端页面访问 404？
A: 确认 `TRIM_APPDEST` 指向项目根目录，静态文件在 `app/ui/` 下。

## 🔍 调试技巧

### 查看实时日志

```bash
# Terminal 1: Management API
source test/.env.test
node app/server/management-api.js

# Terminal 2: Gateway 日志
tail -f test/test-data/logs/gateway.log

# Terminal 3: 测试 API
curl http://localhost:18790/api/status | python3 -m json.tool
```

### 检查进程状态

```bash
# 查看运行中的进程
ps aux | grep -E "management-api|openclaw.*gateway"

# 查看端口占用
lsof -i:18790
lsof -i:18789
```

### 测试 API 端点

```bash
source test/.env.test

# 获取状态
curl -s http://localhost:18790/api/status

# 获取配置
curl -s http://localhost:18790/api/config

# 获取版本
curl -s http://localhost:18790/api/version/current

# 获取日志
curl -s http://localhost:18790/api/logs?lines=50
```

## 📝 开发建议

1. **修改前端代码** - 直接编辑 `app/ui/` 下的文件，刷新浏览器即可
2. **修改后端代码** - 编辑 `app/server/management-api.js` 后需重启服务
3. **测试配置变更** - 直接编辑 `test/test-data/data/.openclaw/openclaw.json`
4. **添加测试数据** - 在 `test/test-data/` 下创建测试文件

## 🎯 与 fnOS 环境的差异

| 项目 | fnOS 环境 | 本地测试环境 |
|------|-----------|-------------|
| Node.js | `/var/apps/nodejs_v22/target/bin/node` | 系统 Node.js |
| 数据目录 | `/vol1/@appdata/oc-deploy/` | `test/test-data/` |
| 应用目录 | `/var/apps/oc-deploy/target/` | 项目根目录 |
| 配置文件 | `/root/.openclaw/` | `test/test-data/data/.openclaw/` |
| 权限 | 专用用户 (oc-deploy) | 当前用户 |
| 进程管理 | fnOS 框架 | 手动/脚本 |

## 📚 相关文档

- [fnOS 开发指南](../docs/FNOS_DEVELOPMENT_GUIDE.md)
- [Wrapper 架构说明](../docs/WRAPPER_ARCHITECTURE.md)
- [OpenClaw 官方文档](https://openclaw.ai/docs)
