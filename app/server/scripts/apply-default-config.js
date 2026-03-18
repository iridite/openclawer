#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { applyManagedConfigPatch } = require("../core/default-config");

const configPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  process.env.CONFIG_FILE ||
  "/root/.openclaw/openclaw.json";
const ocHome = process.env.OC_HOME || path.dirname(configPath);

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    config = {};
  }
}

const nextConfig = applyManagedConfigPatch(config, {
  gatewayPort: process.env.GATEWAY_PORT,
  ocHome,
  allowedPlugins: [],
  preservedToken: config?.gateway?.auth?.token || "",
});

fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
