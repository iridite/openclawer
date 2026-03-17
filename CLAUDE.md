# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

OC-Deploy is an fnOS (飞牛 NAS) FPK package for deploying and managing OpenClaw Gateway with a web UI.

Architecture:

`User -> fnOS App Center -> Management Console (18790) -> /dashboard proxy -> OpenClaw Gateway (18789)`

Core responsibility split:

- OC-Deploy panel: gateway lifecycle, config editing, model/channel management, plugin installation
- Native OpenClaw dashboard: agent/session/runtime usage

## Key Technologies

- Backend: Node.js native HTTP module (no framework)
- Frontend: Vanilla JS + HTML + CSS (no build tool)
- Packaging: fnOS FPK + Bash lifecycle scripts
- Runtime dependency: `nodejs_v22` (fnOS app dependency)

## Project Structure

```text
oc-deploy/
├── app/
│   ├── server/
│   │   ├── management-api.js      # Main entry point
│   │   ├── core/
│   │   │   ├── env.js            # Environment variables and paths
│   │   │   └── io.js             # File I/O and command execution utilities
│   │   ├── services/
│   │   │   ├── backup.js         # Backup/restore operations
│   │   │   ├── config.js         # Config read/write/validate/reset
│   │   │   ├── gateway.js        # Gateway start/stop/restart/status
│   │   │   ├── model-test.js     # Model connection testing
│   │   │   └── plugins.js        # Plugin detection and installation
│   │   └── http/
│   │       ├── router.js         # API route definitions
│   │       ├── static.js         # Static file serving
│   │       └── dashboard-proxy.js # HTTP/WS proxy to native dashboard
│   └── ui/
│       ├── management.html        # Main UI
│       ├── assets/
│       │   ├── management.js      # Frontend logic (main UI controller)
│       │   ├── management.state.js   # Shared state/constants
│       │   ├── management.editor.js  # Config editor logic
│       │   └── management.css     # Frontend styles
│       ├── config                 # fnOS desktop launch config (JSON)
│       └── images/                # UI images/icons
├── cmd/                           # fnOS lifecycle scripts (Bash)
│   ├── main                       # start/stop/status/restart
│   ├── install_init              # pre-install
│   ├── install_callback          # post-install (npm install openclaw)
│   ├── upgrade_init              # pre-upgrade backup
│   ├── upgrade_callback          # post-upgrade restore
│   ├── config_init / config_callback
│   └── uninstall_init / uninstall_callback
├── config/                        # fnOS app permissions
│   ├── privilege
│   └── resource
├── test/
│   ├── smoke.sh                  # lightweight API smoke test
│   ├── local-test.sh             # manual local testing helper
│   ├── setup-test-env.sh         # test environment setup
│   └── README.md                 # test documentation
├── wizard/
│   └── install                   # install wizard tips + TOS summary
├── docs/                          # design and optimization notes
│   ├── FRONTEND_DESIGN_OPTIMIZATION.md
│   ├── OPTIMIZATION_RECOMMENDATIONS.md
│   └── beta/
├── manifest                       # fnOS package metadata (v1.2.1)
├── README.md
├── CLAUDE.md
└── TODO.md
```

## Development Workflow

### Local API Run

```bash
export TRIM_PKGVAR="/tmp/oc-deploy-test"
export TRIM_APPDEST="/tmp/oc-deploy-test"
export MANAGEMENT_PORT="18790"
export GATEWAY_PORT="18789"
node app/server/management-api.js
```

Open `http://localhost:18790/`.

### Lightweight Smoke Test

```bash
bash test/smoke.sh
```

This script starts `management-api.js` with temp dirs and checks key endpoints:

- `/api/status`
- `/api/config`
- `/api/config/validate`
- `/api/console/url`
- `/api/logs`

### Interactive Local Test

```bash
bash test/local-test.sh
```

Interactive menu for starting Management API, Gateway, or both. See `test/README.md` for details.

### Build FPK

```bash
chmod +x cmd/main cmd/install_callback cmd/install_init cmd/uninstall_init cmd/upgrade_init cmd/upgrade_callback
chmod +x app/server/management-api.js
tar -czf oc-deploy.fpk app/ cmd/ config/ manifest wizard/
```

### Test On fnOS

1. Upload FPK in App Center
2. Install and start app (40%/55% pauses are usually npm installation)
3. Open app from App Center
4. Check logs: `/var/apps/oc-deploy/var/info.log`

## Runtime and Paths

- Config file: `/root/.openclaw/openclaw.json`
- Initial snapshot (optional): `/root/.openclaw/openclaw.json.initial`
- Runtime var dir: `${TRIM_PKGVAR}` (default `/var/apps/oc-deploy/var`)
- App target dir: `${TRIM_APPDEST}` (default `/var/apps/oc-deploy/target`)
- OpenClaw binary: `${TRIM_PKGVAR}/node_modules/.bin/openclaw`
- OpenClaw JS entry: `${TRIM_PKGVAR}/node_modules/openclaw/dist/index.js`
- Logs:
  - lifecycle / app script log: `${TRIM_PKGVAR}/info.log`
  - gateway / api runtime log: `${TRIM_PKGVAR}/openclaw.log`

## API Endpoints

```text
GET  /api/status
GET  /api/config
POST /api/config
POST /api/config/reset
POST /api/config/validate
POST /api/config/analyze-impact
POST /api/models/add
POST /api/models/delete
POST /api/models/test
POST /api/gateway/start
POST /api/gateway/stop
POST /api/gateway/restart
GET  /api/version/current
GET  /api/version/latest
POST /api/version/update
GET  /api/plugins/qqbot/status
POST /api/plugins/qqbot/install
GET  /api/plugins/wecom/status
POST /api/plugins/wecom/install
GET  /api/backup/export
POST /api/backup/import
GET  /api/skills/search
GET  /api/skills/list
POST /api/skills/install
POST /api/skills/uninstall
POST /api/skills/toggle
POST /api/skills/update
GET  /api/management/access
POST /api/management/access
GET  /api/security/api-key-protection
POST /api/security/api-key-protection
GET  /api/console/url
GET  /api/logs?lines=100
```

Notes:

- `/api/version/update` performs stop -> npm install latest -> start flow for OpenClaw.
- `/api/config/reset` restores from `.initial` when present, otherwise uses built-in fallback template, then restarts gateway.

## Notable UI Behaviors

- Model form split: `推荐配置` + `高级配置`
- Channel form split: `推荐配置` + `高级配置`
- Channel guide card with Telegram/Discord/Feishu/QQ minimal examples
- Config editor supports reload/import/export/copy/reset + optional Ace editor (CDN)
- Native dashboard entry uses `/dashboard` proxy and token injection
- Console entry text explicitly warns about responsibility split vs OC-Deploy
- QQ plugin status button supports detect/install/retry flow

## Validation and Data Rules

### Status Response Shape

`/api/status` returns:

```js
{
  gateway: "running" | "offline",
  gatewayPid: number | null,
  proxy: "running",
  proxyPid: number,
  system: {
    cpuUsage: number,
    memoryMB: number,
    memoryPercent: number,
    totalMemoryMB: number
  },
  version: string,
  configExists: boolean,
  token: string,
  uptime: number | null
}
```

Always read metrics from `status.system.cpuUsage` and `status.system.memoryPercent`.

### Config Validation Behavior

- `/api/config/validate` returns hard validation errors; frontend blocks save/import when invalid.

### Model Rules

- Model ID regex: `^[a-zA-Z0-9./:-]+$`
- Provider regex: `^[a-z]+$` (lowercase only)
- Primary model key path: `agents.defaults.model.primary`
- Primary model is highlighted in model cards.

### Channel Rules

- Channel type is the key in `channels` (one config per type; no custom channel name key)
- Built-in channel templates:
  - Telegram: `botToken`, `dmPolicy`, `allowFrom`, `groups`
  - Feishu: `accounts.main`, `dmPolicy`
  - Discord: `token`
  - QQ: `appId`, `clientSecret`, `allowFrom`

## Dashboard Proxy Notes

- HTTP proxy for `/dashboard/*`
- WebSocket upgrade bridge for `/dashboard` path
- Response header rewrite to relax frame restrictions for embedded/native panel flow

## Lifecycle Script Notes (fnOS)

- `cmd/main`: starts/stops API process and performs port/process cleanup
- `cmd/install_callback`: installs and initializes OpenClaw runtime deps
- `cmd/upgrade_init`: backs up `/root/.openclaw` into `/root/oc-deploy/<timestamp>-backup/`
- `cmd/upgrade_callback`: restores backup back into `/root/.openclaw/` with append/overwrite copy semantics
- `wizard/install`: includes install tips and TOS summary; proceeding means acceptance

## Troubleshooting

### Management API fails to start

```bash
ss -ltn | grep 18790
lsof -ti:18790 | xargs kill -9
tail -n 100 /var/apps/oc-deploy/var/info.log
```

### Gateway fails to start

```bash
ls -la /var/apps/oc-deploy/var/node_modules/.bin/openclaw
node /var/apps/oc-deploy/var/node_modules/openclaw/dist/index.js --version
tail -n 100 /var/apps/oc-deploy/var/openclaw.log
```

### QQ plugin install fails

If error contains `plugins.allow is empty`, set:

```json
{
  "plugins": {
    "allow": ["openclaw-qqbot"]
  }
}
```

### Model call returns `400 no body`

Usually means upstream got mismatched model config and returned no usable body. Check:

- Model ID
- Base URL
- API protocol/type

against provider docs.

## Security Notes

- Auto backup before config write
- Static file path traversal guard (`..` check)
- Process isolation through fnOS app runtime
- Token-based access for gateway/dashboard flows

## Code Conventions

### Commits

Use conventional commit prefixes:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`

Include:

`Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

### Frontend

- Use `apiRequest()` for API calls
- Use `showToast(message, type)` for user feedback
- Tooltips use `class="tooltip-icon" data-tooltip="..."`
- No framework/build pipeline

### Backend

- Return JSON responses and throw explicit errors from service layer
- Use `readJSON()` / `writeJSON()` helpers
- Use `execCommand()` for shell invocation and centralized timeout handling

## Design Documents

Key design docs in `docs/`:

- `FRONTEND_DESIGN_OPTIMIZATION.md`: Frontend visual/UX optimization notes
- `OPTIMIZATION_RECOMMENDATIONS.md`: Performance and maintainability follow-ups

## Current Focus (from TODO)

Open items:

- Realtime update mechanism beyond polling

## Backend Architecture

The backend was refactored from a single 2199-line file into focused modules:

**Core layer** (`app/server/core/`):
- `env.js`: Environment variables, paths, port configuration
- `io.js`: File I/O (`readJSON`, `writeJSON`) and command execution (`execCommand`)

**Service layer** (`app/server/services/`):
- `backup.js`: Backup/restore operations for config files
- `config.js`: Config read/write/validate/reset operations
- `gateway.js`: Gateway lifecycle (start/stop/restart/status)
- `model-test.js`: Model connection testing with streaming output
- `plugins.js`: Plugin detection and installation

**HTTP layer** (`app/server/http/`):
- `router.js`: API route definitions and request routing
- `static.js`: Static file serving with path traversal protection
- `dashboard-proxy.js`: HTTP/WebSocket proxy to native OpenClaw dashboard

**Key patterns**:
- Services export factory functions: `createXxxService(deps)`
- Router maps endpoint handlers to service methods
- Use `execCommand()` from `core/io.js` for shell invocation with timeout handling
- Use `readJSON()` / `writeJSON()` from `core/io.js` for config file operations

## Frontend Architecture

Partially modularized from a monolithic file:

- `management.state.js`: Shared constants and UI state
- `management.editor.js`: Config editor logic (Ace integration, import/export, validation)
- `management.js`: Main UI controller (still large, further modularization pending)

## Skills vs Plugins (Critical Distinction)

**IMPORTANT**: Skills and Plugins are completely different systems with different installation mechanisms.

**Skills** (installed via `clawhub` CLI):
- Text-based capability packages for AI agents
- Installed to `~/.openclaw/skills/` or `<project>/skills/`
- 5,400+ skills available from ClawHub registry (github.com/openclaw/skills)
- Commands: `clawhub install/uninstall/list/search/update`
- Example: `clawhub install code-review`

**Plugins** (installed via `openclaw plugins install`):
- npm packages extending OpenClaw core (e.g., message channels)
- Installed to `OC_HOME/plugins/` or `OC_HOME/extensions/`
- Must be listed in `openclaw.json` → `plugins.allow`
- Example: `openclaw plugins install @tencent-connect/openclaw-qqbot`

**WebUI Integration**:
- Current: QQ/WeCom plugin detection and installation via `/api/plugins/*`
- Current: Skills search/install/list/toggle/update via `/api/skills/*`

## Skills Management (New Feature)

**IMPORTANT**: Skills are now manageable via WebUI (implemented in v1.2.x).

**Skills Service** (`app/server/services/skills.js`):
- Search skills via ClawHub API: `https://lightmake.site/api/v1/search`
- Download from primary source with fallback to COS backup
- Install to `~/.openclaw/skills/` with lockfile tracking
- Smart ZIP extraction (handles nested directory structures)

**API Endpoints**:
```text
GET  /api/skills/search?q=query&limit=20
POST /api/skills/install (body: { slug, force })
GET  /api/skills/list
POST /api/skills/uninstall (body: { slug })
POST /api/skills/toggle (body: { slug, enabled, entryKey, location })
POST /api/skills/update (body: { slug } or { all: true })
```

**Installation Flow**:
1. Search returns skill metadata from ClawHub registry
2. Install downloads ZIP from primary/fallback sources
3. Extracts to `~/.openclaw/skills/<slug>/`
4. Updates `.skills_store_lock.json` with metadata
5. Concurrent installs blocked per slug

**Key Implementation Details**:
- Slug validation: `^[a-z0-9][a-z0-9._-]*$` (case-insensitive)
- 30s timeout for downloads and API calls
- Automatic redirect following for downloads
- Lockfile format: `{ version: 1, skills: { [slug]: { name, zip_url, source, version, installed_at } } }`

## Version Notes

- `manifest` version: `1.2.1`
- Keep release tag aligned with `manifest` before publishing
