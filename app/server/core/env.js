const path = require("path");

const PORT = parseInt(process.env.MANAGEMENT_PORT || "18790", 10);
const BIND_ADDR = process.env.BIND_ADDR || "0.0.0.0";

const TRIM_PKGVAR = process.env.TRIM_PKGVAR || "/var/apps/oc-deploy/var";
const TRIM_APPDEST = process.env.TRIM_APPDEST || "/var/apps/oc-deploy/target";
const CONFIG_FILE =
  process.env.CONFIG_FILE ||
  process.env.OPENCLAW_CONFIG_PATH ||
  "/root/.openclaw/openclaw.json";
const INITIAL_CONFIG_FILE =
  process.env.INITIAL_CONFIG_FILE ||
  path.join(path.dirname(CONFIG_FILE), "openclaw.json.initial");

const OC_HOME = process.env.OC_HOME || path.dirname(CONFIG_FILE);
const OC_BIN_PATH =
  process.env.OC_BIN_PATH ||
  path.join(TRIM_PKGVAR, "node_modules", ".bin", "openclaw");
const OC_JS_PATH =
  process.env.OC_JS_PATH ||
  path.join(TRIM_PKGVAR, "node_modules", "openclaw", "dist", "index.js");
const OC_PKG_JSON_PATH = path.join(
  TRIM_PKGVAR,
  "node_modules",
  "openclaw",
  "package.json",
);
const TOKEN_FILE = path.join(TRIM_PKGVAR, "gateway_token");
const DASHBOARD_PID_FILE = path.join(TRIM_PKGVAR, "app.pid");
const GATEWAY_PID_FILE = path.join(TRIM_PKGVAR, "gateway.pid");
const LOG_FILE = path.join(TRIM_PKGVAR, "openclaw.log");

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "18789", 10);

const NODE_BIN = process.env.NODE_BIN || "/var/apps/nodejs_v22/target/bin/node";
const NODE_BIN_DIR = path.dirname(NODE_BIN);
const PKG_NODE_BIN_DIR = path.join(TRIM_PKGVAR, "node_modules", ".bin");

const DEFAULT_ALLOWED_PLUGINS = [];
const BACKUP_MANIFEST_FILE = "oc-deploy-backup-manifest.json";
const USER_BACKUP_ROOT =
  process.env.USER_BACKUP_ROOT || "/root/oc-deploy/user-backups";
const MAX_BACKUP_UPLOAD_BYTES = parseInt(
  process.env.MAX_BACKUP_UPLOAD_BYTES || String(512 * 1024 * 1024),
  10,
);

process.env.CONFIG_FILE = process.env.CONFIG_FILE || CONFIG_FILE;
process.env.OPENCLAW_CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH || CONFIG_FILE;
process.env.NODE_BIN = process.env.NODE_BIN || NODE_BIN;
process.env.OC_BIN_PATH = process.env.OC_BIN_PATH || OC_BIN_PATH;
process.env.PATH = `${NODE_BIN_DIR}:${PKG_NODE_BIN_DIR}:${process.env.PATH}`;

module.exports = {
  PORT,
  BIND_ADDR,
  TRIM_PKGVAR,
  TRIM_APPDEST,
  CONFIG_FILE,
  INITIAL_CONFIG_FILE,
  OC_HOME,
  OC_BIN_PATH,
  OC_JS_PATH,
  OC_PKG_JSON_PATH,
  TOKEN_FILE,
  DASHBOARD_PID_FILE,
  GATEWAY_PID_FILE,
  LOG_FILE,
  GATEWAY_PORT,
  NODE_BIN,
  NODE_BIN_DIR,
  PKG_NODE_BIN_DIR,
  DEFAULT_ALLOWED_PLUGINS,
  BACKUP_MANIFEST_FILE,
  USER_BACKUP_ROOT,
  MAX_BACKUP_UPLOAD_BYTES,
};
