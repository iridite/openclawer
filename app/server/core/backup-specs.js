const fs = require("fs");
const path = require("path");

const DEFAULT_BACKUP_SPECS_FILE = path.resolve(
  __dirname,
  "../../../config/backup-path-specs.tsv",
);

function parseBackupSpecsFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const specs = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 4) {
      throw new Error(`Invalid backup spec line: ${line}`);
    }

    const [id, type, backupPath, targetTemplate] = parts.map((value) =>
      String(value || "").trim(),
    );

    if (!id || !type || !backupPath || !targetTemplate) {
      throw new Error(`Incomplete backup spec line: ${line}`);
    }

    specs.push({
      id,
      type,
      backupPath,
      targetTemplate,
    });
  }

  return specs;
}

function resolveTemplate(template, variables) {
  return String(template || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Unknown backup spec variable: ${name}`);
    }
    return String(variables[name] || "");
  });
}

function loadBackupSpecs(options = {}) {
  const filePath = path.resolve(
    options.filePath ||
      process.env.BACKUP_SPECS_FILE ||
      DEFAULT_BACKUP_SPECS_FILE,
  );
  return parseBackupSpecsFile(filePath);
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
