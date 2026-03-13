# API Key 安全存储设计方案

## 背景

当前 OC-Deploy 将 API keys 以明文形式直接写入 `openclaw.json`，存在安全风险。OpenClaw 本体支持 **SecretRef** 机制来引用外部存储的密钥，避免明文存储。

## OpenClaw SecretRef 机制

### 支持的存储方式

1. **环境变量** (`source: "env"`)
   ```json
   {
     "apiKey": {
       "source": "env",
       "provider": "openai",
       "id": "OPENAI_API_KEY"
     }
   }
   ```

2. **文件引用** (`source: "file"`)
   ```json
   {
     "apiKey": {
       "source": "file",
       "provider": "anthropic",
       "id": "/root/.secrets/anthropic_key"
     }
   }
   ```

3. **命令执行** (`source: "exec"`)
   ```json
   {
     "apiKey": {
       "source": "exec",
       "provider": "openai",
       "id": "cat /root/.secrets/openai_key"
     }
   }
   ```

### 安全审计

OpenClaw 提供 `openclaw secrets audit` 命令检测明文密钥：
- `PLAINTEXT_FOUND`: 明文 API keys
- `REF_UNRESOLVED`: 无法解析的 SecretRef
- `REF_SHADOWED`: 被覆盖的引用

## OC-Deploy 实现方案

### UI 改进

在模型配置表单中添加"API Key 存储方式"选项：

```
┌─────────────────────────────────────┐
│ API Key 存储方式                     │
│ ○ 明文存储（不推荐）                 │
│ ● 环境变量（推荐）                   │
│ ○ 文件引用                          │
└─────────────────────────────────────┘

[环境变量名称]
OPENAI_API_KEY
```

### 后端逻辑

**config.js 修改**：

```javascript
function addModel(modelData) {
  const { storageType, apiKey, envVarName, filePath } = modelData;

  let apiKeyValue;
  if (storageType === 'env') {
    apiKeyValue = {
      source: 'env',
      provider: providerName,
      id: envVarName || `${providerName.toUpperCase()}_API_KEY`
    };
  } else if (storageType === 'file') {
    apiKeyValue = {
      source: 'file',
      provider: providerName,
      id: filePath
    };
  } else {
    // 明文存储
    apiKeyValue = apiKey;
  }

  config.models.providers[providerName] = {
    baseUrl,
    apiKey: apiKeyValue,
    api: apiType,
    models: []
  };
}
```

### 环境变量管理

创建 `/root/.openclaw/.env` 文件存储密钥：

```bash
# OpenClaw API Keys
OPENAI_API_KEY=sk-xxx...
ANTHROPIC_API_KEY=sk-ant-xxx...
```

**install_callback 初始化**：

```bash
setup_env_file() {
    local ENV_FILE="/root/.openclaw/.env"

    if [ ! -f "${ENV_FILE}" ]; then
        cat > "${ENV_FILE}" << 'EOF'
# OpenClaw API Keys
# Add your API keys here
EOF
        chmod 600 "${ENV_FILE}"
        log_msg "Created .env file at ${ENV_FILE}"
    fi
}
```

### 迁移工具

添加"迁移到安全存储"按钮，调用后端 API：

```javascript
async function migrateToSecureStorage() {
  const response = await fetch('/api/config/migrate-secrets', {
    method: 'POST',
    body: JSON.stringify({ storageType: 'env' })
  });
  // 自动将明文 API keys 转换为 SecretRef
}
```

## 实施步骤

1. **Phase 1**: UI 添加存储方式选项（默认明文，保持兼容）
2. **Phase 2**: 后端支持 SecretRef 对象生成
3. **Phase 3**: 添加 .env 文件管理功能
4. **Phase 4**: 提供一键迁移工具
5. **Phase 5**: 默认改为环境变量存储

## 安全考虑

- `.env` 文件权限设为 600（仅 root 可读写）
- 在 UI 中显示 API key 时始终脱敏（仅显示前8位）
- 提供"测试连接"功能验证 SecretRef 是否正确配置
- 备份功能需要处理 SecretRef（导出时提示用户手动备份密钥）

## 兼容性

- 保持向后兼容：现有明文配置继续工作
- 新用户默认使用环境变量存储
- 提供迁移向导引导老用户升级
