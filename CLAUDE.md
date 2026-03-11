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
│   │   └── management-api.js      # API server + static server + /dashboard proxy + WS bridge
│   └── ui/
│       ├── management.html        # Main UI
│       ├── assets/
│       │   ├── management.js      # Frontend logic
│       │   └── management.css     # Frontend styles
│       ├── config                 # fnOS desktop launch config (JSON)
│       └── images/                # UI images/icons
├── cmd/
│   ├── main                       # start/stop/status/restart
│   ├── install_init              # pre-install
│   ├── install_callback          # post-install
│   ├── upgrade_init              # pre-upgrade backup
│   ├── upgrade_callback          # post-upgrade restore
│   ├── config_init / config_callback
│   └── uninstall_init / uninstall_callback
├── config/
│   ├── privilege
│   └── resource
├── test/
│   ├── smoke.sh                  # lightweight API smoke test
│   ├── local-test.sh
│   ├── setup-test-env.sh
│   └── README.md
├── wizard/
│   └── install                   # install wizard tips + TOS summary
├── manifest
├── README.md
├── TODO.md
└── docs/
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
POST /api/models/add
POST /api/models/delete
POST /api/gateway/start
POST /api/gateway/stop
POST /api/gateway/restart
GET  /api/version/current
GET  /api/version/latest
POST /api/version/update
GET  /api/plugins/qqbot/status
POST /api/plugins/qqbot/install
GET  /api/console/url
GET  /api/logs?lines=100
```

Notes:

- `/api/version/update` currently returns a placeholder (`success: false`, `"还没做"`).
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
  success: true,
  data: {
    gateway: "running" | "offline",
    gatewayPid: number | null,
    system: { cpu: number, memory: number }
  }
}
```

Always read metrics from `status.system.cpu` and `status.system.memory`.

### Config Validation Behavior

- `/api/config/validate` returns warnings/errors; frontend warns but does not force-block save.

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

- Return structured `{ success, ... }` responses
- Use `readJSON()` / `writeJSON()` helpers
- Use `execCommand()` for shell invocation and centralized timeout handling

## Current Focus (from TODO)

Open items currently include:

- Realtime update mechanism beyond polling
- Dark/light UI mode switch
- Offline/online install option strategy
- Save-time "impact hint" before applying config changes
- Primary model UX consistency improvements
- Broader backup coverage (memory/plugins)

## Version Notes

- `manifest` version: `1.0.0`
- GitHub release tag has been published as `v1.1.0`

