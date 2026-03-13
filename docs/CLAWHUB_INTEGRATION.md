# ClawHub 整合设计方案

## 背景

ClawHub 是 OpenClaw 的官方 skill 注册中心，提供 5,400+ 可用 skills。Skills 是为 AI Agent 提供特定能力的文本技能包（包含 `SKILL.md` 文件）。

## 目标

在 OC-Deploy WebUI 中整合 ClawHub，提供：
- 搜索和浏览可用 skills
- 一键安装 skills
- 管理已安装 skills

## 技术架构

### Skills vs Plugins 区别

| 特性 | Skills | Plugins |
|------|--------|---------|
| 安装工具 | `clawhub` CLI | `openclaw plugins install` |
| 格式 | 文本文件（SKILL.md） | npm 包 |
| 安装位置 | `~/.openclaw/skills/` | `OC_HOME/plugins/` |
| 数量 | 5,400+ | 少量官方插件 |
| 用途 | AI Agent 能力扩展 | 核心功能扩展（消息渠道等） |

### ClawHub CLI 命令

```bash
# 搜索和发现
clawhub search <query>          # 搜索 skills
clawhub explore                 # 浏览 skills
clawhub inspect <slug>          # 查看 skill 详情（不安装）

# 安装和管理
clawhub install <slug>          # 安装 skill
clawhub uninstall <slug>        # 卸载 skill
clawhub list                    # 列出已安装 skills
clawhub update --all            # 更新所有 skills
clawhub sync                    # 同步安装状态

# 认证
clawhub login                   # 登录
clawhub whoami                  # 查看当前用户
```

## 实现方案

### 1. 后端服务（app/server/services/clawhub.js）

```javascript
function createClawHubService(options) {
  const { execCommand, OC_HOME } = options;

  // 检测 clawhub CLI 是否已安装
  async function checkClawHubInstalled() {
    try {
      await execCommand('which clawhub');
      return { installed: true };
    } catch {
      return { installed: false, message: '需要安装 clawhub CLI' };
    }
  }

  // 搜索 skills
  async function searchSkills(query) {
    const result = await execCommand(`clawhub search "${query}"`, { timeout: 30000 });
    // 解析输出并返回 JSON
    return parseSearchResults(result);
  }

  // 列出已安装 skills
  async function listInstalledSkills() {
    const result = await execCommand('clawhub list');
    return parseListResults(result);
  }

  // 安装 skill
  async function installSkill(slug) {
    await execCommand(`clawhub install ${slug}`, { timeout: 300000 });
    return { success: true, message: `Skill ${slug} 安装成功` };
  }

  // 卸载 skill
  async function uninstallSkill(slug) {
    await execCommand(`clawhub uninstall ${slug}`);
    return { success: true, message: `Skill ${slug} 已卸载` };
  }

  // 查看 skill 详情
  async function inspectSkill(slug) {
    const result = await execCommand(`clawhub inspect ${slug}`);
    return parseInspectResults(result);
  }

  return {
    checkClawHubInstalled,
    searchSkills,
    listInstalledSkills,
    installSkill,
    uninstallSkill,
    inspectSkill,
  };
}
```

### 2. API 端点（app/server/http/router.js）

```javascript
// ClawHub 相关端点
GET  /api/clawhub/status           # 检查 clawhub CLI 是否已安装
GET  /api/clawhub/search?q=xxx     # 搜索 skills
GET  /api/clawhub/list             # 列出已安装 skills
GET  /api/clawhub/:slug/inspect    # 查看 skill 详情
POST /api/clawhub/:slug/install    # 安装 skill
POST /api/clawhub/:slug/uninstall  # 卸载 skill
POST /api/clawhub/update-all       # 更���所有 skills
```

### 3. 前端 UI（新增 "扩展市场" 标签页）

#### 页面结构

```html
<section class="tab-content" id="tab-clawhub">
  <!-- ClawHub 状态检查 -->
  <div class="card" id="clawhub-status-card">
    <h2>ClawHub 状态</h2>
    <div id="clawhub-status">检查中...</div>
    <!-- 如果未安装，显示安装指南 -->
  </div>

  <!-- 搜索区域 -->
  <div class="card">
    <h2>搜索 Skills</h2>
    <input type="text" id="skill-search-input" placeholder="搜索 skills...">
    <button onclick="searchSkills()">搜索</button>
  </div>

  <!-- 搜索结果 -->
  <div class="card">
    <h2>搜索结果</h2>
    <div id="skill-search-results"></div>
  </div>

  <!-- 已安装 skills -->
  <div class="card">
    <h2>已安装 Skills</h2>
    <button onclick="updateAllSkills()">全部更新</button>
    <div id="installed-skills-list"></div>
  </div>
</section>
```

#### Skill 卡片设计

```html
<div class="skill-card">
  <div class="skill-header">
    <h3 class="skill-name">{skill-slug}</h3>
    <span class="skill-status">{installed/not-installed}</span>
  </div>
  <p class="skill-description">{description}</p>
  <div class="skill-meta">
    <span>作者: {author}</span>
    <span>下载量: {downloads}</span>
  </div>
  <div class="skill-actions">
    <button onclick="inspectSkill('{slug}')">查看详情</button>
    <button onclick="installSkill('{slug}')" class="btn-primary">安装</button>
    <!-- 或 -->
    <button onclick="uninstallSkill('{slug}')" class="btn-danger">卸载</button>
  </div>
</div>
```

### 4. 前端 JavaScript（app/ui/assets/management.clawhub.js）

```javascript
// 检查 ClawHub 状态
async function checkClawHubStatus() {
  const res = await fetch('/api/clawhub/status');
  const data = await res.json();

  if (!data.installed) {
    showClawHubInstallGuide();
  }
  return data;
}

// 搜索 skills
async function searchSkills() {
  const query = document.getElementById('skill-search-input').value;
  const res = await fetch(`/api/clawhub/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  renderSearchResults(data.skills);
}

// 列出已安装 skills
async function loadInstalledSkills() {
  const res = await fetch('/api/clawhub/list');
  const data = await res.json();
  renderInstalledSkills(data.skills);
}

// 安装 skill
async function installSkill(slug) {
  showToast('正在安装...', 'info');
  const res = await fetch(`/api/clawhub/${slug}/install`, { method: 'POST' });
  const data = await res.json();

  if (data.success) {
    showToast(data.message, 'success');
    loadInstalledSkills();
  } else {
    showToast(data.error, 'error');
  }
}

// 卸载 skill
async function uninstallSkill(slug) {
  if (!confirm(`确定要卸载 ${slug}?`)) return;

  const res = await fetch(`/api/clawhub/${slug}/uninstall`, { method: 'POST' });
  const data = await res.json();

  if (data.success) {
    showToast(data.message, 'success');
    loadInstalledSkills();
  }
}

// 查看 skill 详情
async function inspectSkill(slug) {
  const res = await fetch(`/api/clawhub/${slug}/inspect`);
  const data = await res.json();
  showSkillDetailModal(data);
}
```

## 运行时依赖处理

### 问题
Skills 可能需要特定运行时（Node.js, Python, Go 等）。

### 解决方案（最小化）
1. **不强制检查运行时**（避免复杂度）
2. **安装失败时提示用户**检查运行时依赖
3. **在 skill 详情中显示运行时要求**（如果 clawhub inspect 提供此信息）

### 实现
```javascript
async function installSkill(slug) {
  try {
    await fetch(`/api/clawhub/${slug}/install`, { method: 'POST' });
    showToast('安装成功', 'success');
  } catch (err) {
    // 错误信息中可能包含运行时依赖提示
    showToast(`安装失败: ${err.message}`, 'error');
    showRuntimeRequirementsHint(slug);
  }
}
```

## ClawHub CLI 安装

### 检测逻辑
```javascript
async function checkClawHubInstalled() {
  try {
    await execCommand('which clawhub');
    return { installed: true };
  } catch {
    return {
      installed: false,
      message: '需要安装 clawhub CLI',
      installGuide: 'https://github.com/openclaw/clawhub#installation'
    };
  }
}
```

### UI 提示
如果 clawhub 未安装，显示安装指南：
```html
<div class="alert warning">
  <h3>ClawHub CLI 未安装</h3>
  <p>需要安装 clawhub CLI 才能使用扩展市场功能。</p>
  <a href="https://github.com/openclaw/clawhub#installation" target="_blank">
    查看安装指南
  </a>
</div>
```

## 实施步骤

### Phase 1: 后端基础（最小可用版本）
1. 创建 `app/server/services/clawhub.js`
2. 实现基础功能：
   - `checkClawHubInstalled()`
   - `searchSkills(query)`
   - `listInstalledSkills()`
   - `installSkill(slug)`
3. 添加 API 端点到 `router.js`
4. 测试后端功能

### Phase 2: 前端 UI
1. 在 `management.html` 添加 "扩展市场" 标签页
2. 创建 `app/ui/assets/management.clawhub.js`
3. 实现搜索和安装 UI
4. 测试完整流程

### Phase 3: 增强功能（可选）
1. 添加 skill 详情查看（`inspectSkill`）
2. 添加批量更新功能（`updateAllSkills`）
3. 添加卸载功能
4. 优化 UI 和用户体验

## 风险与限制

### 风险
1. **clawhub CLI 未安装**：用户需要手动安装
2. **运行时依赖**：某些 skills 可能需要 Python/Go 等运行时
3. **网络依赖**：搜索和安装需要网络连接
4. **命令输出解析**：clawhub CLI 输出格式可能变化

### 限制
1. 依赖 clawhub CLI 的可用性和稳定性
2. 无法直接控制 skill 的安装位置（由 clawhub 决定）
3. 搜索功能依赖 clawhub 的向量搜索能力

## 测试计划

### 单元测试
- clawhub CLI 检测
- 命令输出解析
- 错误处理

### 集成测试
- 搜索 skills
- 安装/卸载 skills
- 列出已安装 skills

### 手动测试
- 在 fnOS 环境中测试完整流程
- 测试 clawhub 未安装的情况
- 测试网络异常情况

## 未来优化

1. **离线支持**：缓存 skill 列表，支持离线浏览
2. **推荐系统**：根据用户配置推荐相关 skills
3. **分类浏览**：按类别浏览 skills
4. **评分和评论**：如果 clawhub 支持，显示用户评分
5. **自动更新**：定期检查并提示 skill 更新

## 参考资料

- ClawHub GitHub: https://github.com/openclaw/clawhub
- Awesome OpenClaw Skills: https://github.com/VoltAgent/awesome-openclaw-skills
- ClawHub.ai: https://clawhub.ai
