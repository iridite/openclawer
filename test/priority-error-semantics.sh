#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/oc-deploy-priority-errors-XXXXXX)"
export TMP_DIR

cleanup() {
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

cd "${PROJECT_ROOT}"

node - <<'NODE'
const fs = require("fs");
const path = require("path");
const { createGatewayService } = require("./app/server/services/gateway");
const { createPluginService } = require("./app/server/services/plugins");
const { isAppError } = require("./app/server/core/http-errors");

const tmpDir = process.env.TMP_DIR;

function assertAppError(err, expectedStatus, expectedCode, label) {
  if (!isAppError(err)) {
    throw new Error(`[priority-errors] ${label}: expected AppError, got ${String(err)}`);
  }
  if (err.statusCode !== expectedStatus) {
    throw new Error(
      `[priority-errors] ${label}: expected status ${expectedStatus}, got ${err.statusCode}`,
    );
  }
  if (err.code !== expectedCode) {
    throw new Error(
      `[priority-errors] ${label}: expected code ${expectedCode}, got ${err.code}`,
    );
  }
}

async function expectAppError(run, expectedStatus, expectedCode, label) {
  try {
    await run();
  } catch (err) {
    assertAppError(err, expectedStatus, expectedCode, label);
    return;
  }
  throw new Error(`[priority-errors] ${label}: expected throw but resolved`);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return null;
  }
}

async function runGatewayChecks() {
  const gatewayConfigFile = path.join(tmpDir, "gateway", "openclaw.json");
  const gatewayPkgJson = path.join(tmpDir, "gateway", "package.json");
  writeJson(gatewayConfigFile, {});
  writeJson(gatewayPkgJson, { version: "0.0.0-test" });

  const commonOptions = {
    CONFIG_FILE: gatewayConfigFile,
    GATEWAY_PORT: 18789,
    LOG_FILE: path.join(tmpDir, "gateway", "openclaw.log"),
    NODE_BIN: process.execPath,
    OC_JS_PATH: path.join(tmpDir, "gateway", "openclaw.js"),
    OC_PKG_JSON_PATH: gatewayPkgJson,
    GATEWAY_PID_FILE: path.join(tmpDir, "gateway", "gateway.pid"),
    TRIM_PKGVAR: path.join(tmpDir, "gateway", "pkgvar"),
    GATEWAY_RESTART_DELAY: 1,
    NPM_VIEW_TIMEOUT: 1000,
    NPM_INSTALL_TIMEOUT: 1000,
    STATUS_CACHE_TTL: 10,
    readJSON: readJson,
    writeJSON: (filePath, data) => {
      writeJson(filePath, data);
      return true;
    },
    isProcessRunning: () => false,
    getTokenFromConfig: () => "",
  };

  const npmFailureService = createGatewayService({
    ...commonOptions,
    execCommand: async (cmd) => {
      if (cmd.includes("npm install openclaw@latest")) {
        const err = new Error("registry unavailable");
        err.stderr = "EAI_AGAIN";
        throw err;
      }
      return "";
    },
  });

  await expectAppError(
    () => npmFailureService.updateVersion(),
    502,
    "bad_gateway",
    "gateway update npm failure",
  );

  const restartFailureService = createGatewayService({
    ...commonOptions,
    execCommand: async (cmd) => {
      if (cmd.includes('nohup env HOME="/root"')) {
        throw new Error("gateway start failed");
      }
      return "";
    },
  });

  await expectAppError(
    () => restartFailureService.updateVersion(),
    409,
    "conflict",
    "gateway restart failure",
  );
}

function seedInstalledQqPlugin(ocHome) {
  const pluginDir = path.join(ocHome, "plugins", "openclaw-qqbot");
  fs.mkdirSync(pluginDir, { recursive: true });
  writeJson(path.join(pluginDir, "package.json"), {
    name: "@tencent-connect/openclaw-qqbot",
    version: "1.0.0-test",
    openclaw: { channels: ["qqbot"] },
  });
  writeJson(path.join(pluginDir, "openclaw.plugin.json"), {
    id: "openclaw-qqbot",
    version: "1.0.0-test",
    channels: ["qqbot"],
  });
}

async function runPluginChecks() {
  const ocHome = path.join(tmpDir, "plugin", "oc-home");
  const pkgVar = path.join(tmpDir, "plugin", "pkgvar");
  const configFile = path.join(ocHome, "openclaw.json");
  writeJson(configFile, {});
  fs.mkdirSync(pkgVar, { recursive: true });

  const concurrentService = createPluginService({
    OC_HOME: ocHome,
    TRIM_PKGVAR: pkgVar,
    CONFIG_FILE: configFile,
    OC_BIN_PATH: "",
    NODE_BIN: process.execPath,
    NODE_BIN_DIR: path.dirname(process.execPath),
    PKG_NODE_BIN_DIR: path.dirname(process.execPath),
    readJSON: readJson,
    writeJSON: (filePath, data) => {
      writeJson(filePath, data);
      return true;
    },
    execCommand: async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return "";
    },
    restartGateway: async () => ({ success: true }),
  });

  const firstInstall = concurrentService.installQqbotPlugin();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await expectAppError(
    () => concurrentService.installQqbotPlugin(),
    409,
    "conflict",
    "plugin install in-progress conflict",
  );
  await expectAppError(
    () => firstInstall,
    502,
    "bad_gateway",
    "plugin runtime verification failure",
  );

  const installFailureService = createPluginService({
    OC_HOME: ocHome,
    TRIM_PKGVAR: pkgVar,
    CONFIG_FILE: configFile,
    OC_BIN_PATH: "",
    NODE_BIN: process.execPath,
    NODE_BIN_DIR: path.dirname(process.execPath),
    PKG_NODE_BIN_DIR: path.dirname(process.execPath),
    readJSON: readJson,
    writeJSON: (filePath, data) => {
      writeJson(filePath, data);
      return true;
    },
    execCommand: async () => {
      const err = new Error("install command failed");
      err.stderr = "npm ERR! network";
      throw err;
    },
    restartGateway: async () => ({ success: true }),
  });

  await expectAppError(
    () => installFailureService.installQqbotPlugin(),
    502,
    "bad_gateway",
    "plugin install command failure",
  );

  seedInstalledQqPlugin(ocHome);
  writeJson(configFile, {
    plugins: {
      enabled: true,
      allow: [],
    },
  });

  const enableConflictService = createPluginService({
    OC_HOME: ocHome,
    TRIM_PKGVAR: pkgVar,
    CONFIG_FILE: configFile,
    OC_BIN_PATH: "",
    NODE_BIN: process.execPath,
    NODE_BIN_DIR: path.dirname(process.execPath),
    PKG_NODE_BIN_DIR: path.dirname(process.execPath),
    readJSON: readJson,
    writeJSON: () => false,
    execCommand: async () => "",
    restartGateway: async () => ({ success: true }),
  });

  await expectAppError(
    () => enableConflictService.installQqbotPlugin(),
    409,
    "conflict",
    "plugin enable config write failure",
  );
}

(async () => {
  await runGatewayChecks();
  await runPluginChecks();
  console.log("[priority-errors] all checks passed");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
NODE
