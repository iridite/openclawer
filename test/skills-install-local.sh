#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${TEST_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/oc-deploy-skills-install-XXXXXX)"
export TMP_DIR

cleanup() {
  rm -rf "${TMP_DIR}" || true
}
trap cleanup EXIT

export OC_HOME="${TMP_DIR}/oc-home"
export TRIM_PKGVAR="${TMP_DIR}/pkgvar"
export CONFIG_FILE="${OC_HOME}/openclaw.json"
export SKILL_ZIP_SOURCE="${TMP_DIR}/demo-skill.zip"

mkdir -p "${OC_HOME}" "${TRIM_PKGVAR}/node_modules/openclaw/skills" "${TMP_DIR}/src/demo-skill"

cat > "${CONFIG_FILE}" <<'EOF'
{}
EOF

cat > "${TMP_DIR}/src/demo-skill/SKILL.md" <<'EOF'
---
name: Demo Skill
skillKey: demo-skill-key
---

Local install regression skill.
EOF

cat > "${TMP_DIR}/src/demo-skill/README.md" <<'EOF'
demo skill content
EOF

python3 - <<'PY'
import os
import zipfile

source_dir = os.path.join(os.environ["TMP_DIR"], "src", "demo-skill")
zip_path = os.environ["SKILL_ZIP_SOURCE"]

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(source_dir):
        for name in files:
            full_path = os.path.join(root, name)
            rel_path = os.path.relpath(full_path, os.path.join(os.environ["TMP_DIR"], "src"))
            zf.write(full_path, rel_path)
PY

TMP_DIR="${TMP_DIR}" node - <<'NODE'
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { createSkillsService } = require("./app/server/services/skills");

const tmpDir = process.env.TMP_DIR;
const ocHome = process.env.OC_HOME;
const pkgVar = process.env.TRIM_PKGVAR;
const configFile = process.env.CONFIG_FILE;
const zipSource = process.env.SKILL_ZIP_SOURCE;

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return null;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    return false;
  }
}

function execCommand(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: options.timeout || 120000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout || "");
    });
  });
}

async function copyDownload(_url, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(zipSource, dest);
}

(async () => {
  const service = createSkillsService({
    OC_HOME: ocHome,
    TRIM_PKGVAR: pkgVar,
    CONFIG_FILE: configFile,
    readJSON,
    writeJSON,
    execCommand,
    downloadFile: copyDownload,
    fetchJSON: async () => ({ results: [] }),
  });

  const installResult = await service.install("demo-skill", false);
  if (!installResult?.success) {
    throw new Error(`install failed: ${JSON.stringify(installResult)}`);
  }

  const installedSkillDir = path.join(ocHome, "skills", "demo-skill");
  if (!fs.existsSync(path.join(installedSkillDir, "SKILL.md"))) {
    throw new Error("installed skill missing SKILL.md");
  }

  const listResult = await service.list();
  if (!listResult?.success || !Array.isArray(listResult.skills)) {
    throw new Error("list failed after install");
  }
  const installed = listResult.skills.find((skill) => skill.slug === "demo-skill");
  if (!installed || installed.location !== "user" || installed.exists !== true) {
    throw new Error("installed skill not found in list");
  }

  const updateResult = await service.update("demo-skill");
  if (!updateResult?.success) {
    throw new Error(`update failed: ${JSON.stringify(updateResult)}`);
  }

  const uninstallResult = await service.uninstall("demo-skill");
  if (!uninstallResult?.success) {
    throw new Error(`uninstall failed: ${JSON.stringify(uninstallResult)}`);
  }

  if (fs.existsSync(installedSkillDir)) {
    throw new Error("skill dir still exists after uninstall");
  }

  const lockfilePath = path.join(ocHome, "skills", ".skills_store_lock.json");
  const lockfile = readJSON(lockfilePath) || {};
  if (lockfile.skills && lockfile.skills["demo-skill"]) {
    throw new Error("lockfile still contains demo-skill after uninstall");
  }

  console.log("[skills-install-local] all checks passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE
