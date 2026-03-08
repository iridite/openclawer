# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OC-Deploy is a fnOS (飞牛 NAS) FPK package that wraps OpenClaw AI Gateway with a web-based management console. The project provides a user-friendly interface for configuring and managing OpenClaw Gateway on fnOS systems.

**Architecture**: User → fnOS App Center → Management Console (port 18790) → OpenClaw Gateway (port 18789)

## Key Technologies

- **Backend**: Node.js native HTTP module (no frameworks)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (no build tools)
- **Deployment**: fnOS FPK format, Bash lifecycle scripts
- **Dependencies**: nodejs_v22 (provided by fnOS)

## Project Structure

```
oc-deploy/
├── app/
│   ├── server/
│   │   ├── management-api.js      # RESTful API server (port 18790)
│   │   └── iframe-proxy.js        # Proxy for iframe embedding
│   └── ui/
│       ├── management.html        # Main management interface
│       ├── index.cgi              # CGI gateway for fnOS routing
│       └── assets/
│           ├── management.js      # Frontend logic
│           └── management.css     # Styles
├── cmd/
│   ├── main                       # Lifecycle script (start/stop/status)
│   ├── install_callback           # Post-install initialization
│   ├── install_init               # Pre-install setup
│   └── uninstall_init             # Cleanup script
├── config/
│   ├── privilege                  # fnOS permission config
│   └── resource                   # fnOS resource config
├── manifest                       # FPK metadata
└── wizard/                        # Installation wizard
```

## Development Workflow

### Testing Locally

The project is designed to run on fnOS, but you can test the Management API locally:

```bash
# Set environment variables
export TRIM_PKGVAR="/tmp/oc-deploy-test"
export TRIM_APPDEST="/tmp/oc-deploy-test"
export MANAGEMENT_PORT="18790"
export GATEWAY_PORT="18789"

# Run the Management API
node app/server/management-api.js

# Access the interface
# Open http://localhost:18790/ in browser
```

### Building FPK Package

```bash
# Ensure executable permissions
chmod +x cmd/main
chmod +x app/ui/index.cgi
chmod +x app/server/management-api.js

# Package into FPK (from project root)
tar -czf oc-deploy.fpk app/ cmd/ config/ manifest wizard/
```

### Testing on fnOS

1. Upload the FPK to fnOS App Center
2. Install and start the application
3. Access via the "Open" button in App Center
4. Check logs at `/var/apps/oc-deploy/var/info.log`

## Architecture Details

### Request Flow

1. **User Access**: User opens app from fnOS App Center
2. **CGI Gateway**: `index.cgi` routes requests:
   - `/api/*` → proxies to Management API (port 18790)
   - Static files → serves from `app/ui/`
3. **Management API**: Node.js server handles:
   - Gateway control (start/stop/restart)
   - Config management (read/write `openclaw.json`)
   - Status monitoring (process info, CPU, memory)
4. **OpenClaw Gateway**: Runs on port 18789 (managed by Management API)

### Process Management

- **Management API**: Managed by `cmd/main` script (PID stored in `${TRIM_PKGVAR}/app.pid`)
- **OpenClaw Gateway**: Started via `nohup` by Management API, controlled via `pkill -f "openclaw.*gateway"`

### Configuration Files

- **OpenClaw Config**: `/root/.openclaw/openclaw.json` (managed by Management API)
- **Environment Variables**:
  - `TRIM_PKGVAR`: `/var/apps/oc-deploy/var` (runtime data)
  - `TRIM_APPDEST`: `/var/apps/oc-deploy/target` (application files)
  - `HOME`: `/root` (locked for OpenClaw)
  - `OPENCLAW_CONFIG_PATH`: `/root/.openclaw/openclaw.json`

## API Endpoints

```
GET  /api/status              # Gateway status (running/offline, PID, CPU, memory)
GET  /api/config              # Get openclaw.json
POST /api/config              # Save openclaw.json (auto-backup)
POST /api/config/validate     # Validate JSON config
POST /api/models/add          # Quick add model
POST /api/gateway/start       # Start gateway
POST /api/gateway/stop        # Stop gateway (pkill -9)
POST /api/gateway/restart     # Restart gateway (stop + 2s delay + start)
GET  /api/version/current     # Get OpenClaw version
GET  /api/console/url         # Get console URL with token
GET  /api/logs?lines=100      # Get recent logs
```

## Code Conventions

### Commit Messages

Follow conventional commits format (see git log for examples):

```
feat: add new feature
fix: fix bug description
refactor: refactor code
docs: update documentation
```

Always include co-author line:
```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

### Frontend Code

- **No frameworks**: Pure vanilla JavaScript
- **No build tools**: Direct deployment
- **API calls**: Use `apiRequest()` helper function
- **Toast notifications**: Use `showToast(message, type)` for user feedback
- **Tooltips**: Use `class="tooltip-icon" data-tooltip="..."` for help text

### Backend Code

- **Error handling**: Always wrap in try-catch, return `{ success, error }` objects
- **Process control**: Use `execCommand()` helper for shell commands
- **Config operations**: Use `readJSON()` and `writeJSON()` helpers
- **Backup**: Auto-backup config files before modification (`.backup.timestamp`)

## Important Patterns

### Safe DOM Access

Always check element existence before accessing properties:

```javascript
const element = document.getElementById("some-id");
if (element) {
  element.value = "...";
}
```

### Gateway Status Check

When displaying gateway-related info, always verify both PID and status:

```javascript
status.gatewayPid && status.gateway === "running" ? status.gatewayPid : "(未运行)"
```

### Process Detection

Use consistent process matching pattern:

```bash
pgrep -f "openclaw.*gateway" | head -n 1
```

## fnOS Specifics

### Lifecycle Scripts

- `cmd/main`: Handles start/stop/status/restart commands
- `cmd/install_callback`: Runs after installation (installs OpenClaw via npm, runs setup)
- `cmd/uninstall_init`: Cleanup before uninstall (kills processes)

### Environment Variables

fnOS provides these variables to lifecycle scripts:
- `TRIM_APPNAME`: Application name (oc-deploy)
- `TRIM_PKGVAR`: Variable data directory
- `TRIM_APPDEST`: Application destination directory
- `TRIM_TEMP_LOGFILE`: Temporary log file for error reporting

### CGI Gateway

The `index.cgi` script is the entry point for all web requests. It:
- Routes `/api/*` to Management API via curl
- Serves static files from `app/ui/`
- Prevents directory traversal attacks
- Sets appropriate MIME types

## Troubleshooting

### Management API Won't Start

Check port 18790 availability:
```bash
ss -ltn | grep 18790
lsof -ti:18790 | xargs kill -9  # Force kill if occupied
```

### Gateway Won't Start

Check OpenClaw installation:
```bash
ls -la /var/apps/oc-deploy/var/node_modules/.bin/openclaw
node /var/apps/oc-deploy/var/node_modules/.bin/openclaw --version
```

### Config Not Saving

Verify file permissions and path:
```bash
ls -la /root/.openclaw/openclaw.json
cat /var/apps/oc-deploy/var/info.log | tail -50
```

## Security Considerations

- Config files auto-backup before modification
- Path traversal prevention in CGI gateway
- Process isolation (runs as openclaw:openclaw user)
- No sensitive data in git repository
- CORS configured for local access only

## Current Development Focus

See `TODO.md` for active development tasks. Key areas:
- Quick model addition interface (partially implemented)
- Real-time config updates (planned)
- Dark mode UI toggle (planned)
