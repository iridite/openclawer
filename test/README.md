# OpenClaw 本地测试指南

本目录包含用于本地测试 WebUI 和 OpenClaw 交互的脚本。

## 🚀 快速开始

### 1. 准备测试环境

```bash
cd oc-deploy
bash test/setup-test-env.sh
```

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