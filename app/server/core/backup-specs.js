const path = require("path");

const DEFAULT_BACKUP_SPECS_FILE = path.resolve(
  __dirname,
  "../../../config/backup-path-specs.tsv",
);
const EMBEDDED_BACKUP_SPECS = Object.freeze([
  {
    id: "oc_home",
    type: "dir",
    backupPath: ".openclaw",
    targetTemplate: "${OC_HOME}",
  },
  {
    id: "pkg_plugins",
    type: "dir",
    backupPath: "var/plugins",
    targetTemplate: "${TRIM_PKGVAR}/plugins",
  },
  {
    id: "pkg_extensions",
    type: "dir",
    backupPath: "var/extensions",
    targetTemplate: "${TRIM_PKGVAR}/extensions",
  },
  {
    id: "qqbot_node_modules",
    type: "dir",
    backupPath: "var/node_modules/@tencent-connect/openclaw-qqbot",
    targetTemplate:
      "${TRIM_PKGVAR}/node_modules/@tencent-connect/openclaw-qqbot",
  },
  {
    id: "wecom_node_modules",
    type: "dir",
    backupPath: "var/node_modules/@wecom/wecom-openclaw-plugin",
    targetTemplate: "${TRIM_PKGVAR}/node_modules/@wecom/wecom-openclaw-plugin",
  },
  {
    id: "skillhub_node_modules",
    type: "dir",
    backupPath: "var/node_modules/skillhub",
    targetTemplate: "${TRIM_PKGVAR}/node_modules/skillhub",
  },
  {
    id: "openclaw_skillhub_node_modules",
    type: "dir",
    backupPath: "var/node_modules/@openclaw/skillhub",
    targetTemplate: "${TRIM_PKGVAR}/node_modules/@openclaw/skillhub",
  },
  {
    id: "management_access",
    type: "file",
    backupPath: "var/management-access.json",
    targetTemplate: "${TRIM_PKGVAR}/management-access.json",
  },
  {
    id: "api_key_protection",
    type: "file",
    backupPath: "var/api-key-protection.json",
    targetTemplate: "${TRIM_PKGVAR}/api-key-protection.json",
  },
]);

function resolveTemplate(template, variables) {
  return String(template || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Unknown backup spec variable: ${name}`);
    }
    return String(variables[name] || "");
  });
}

function cloneSpecs(specs) {
  return specs.map((spec) => ({
    id: String(spec.id || "").trim(),
    type: String(spec.type || "").trim(),
    backupPath: String(spec.backupPath || "").trim(),
    targetTemplate: String(spec.targetTemplate || "").trim(),
  }));
}

function loadBackupSpecs() {
  return cloneSpecs(EMBEDDED_BACKUP_SPECS);
}

function resolveBackupPathSpecs(options = {}) {
  const specs = loadBackupSpecs(options);
  const variables = {
    OC_HOME: options.OC_HOME || process.env.OC_HOME || "",
    TRIM_PKGVAR: options.TRIM_PKGVAR || process.env.TRIM_PKGVAR || "",
  };

  return specs.map((spec) => ({
    id: spec.id,
    type: spec.type,
    backupPath: spec.backupPath,
    targetPath: path.normalize(resolveTemplate(spec.targetTemplate, variables)),
  }));
}

module.exports = {
  DEFAULT_BACKUP_SPECS_FILE,
  loadBackupSpecs,
  resolveBackupPathSpecs,
};
