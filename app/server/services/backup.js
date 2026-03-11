const fs = require("fs");
const path = require("path");

function createBackupService(options) {
  const {
    OC_HOME,
    TRIM_PKGVAR,
    BACKUP_MANIFEST_FILE,
    USER_BACKUP_ROOT,
    MAX_BACKUP_UPLOAD_BYTES,
    readJSON,
    execCommand,
    restartGateway,
  } = options;

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  function formatBackupStamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function cleanupPathQuietly(targetPath) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (err) {}
  }

  function copyDirectoryContents(sourceDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const names = fs.readdirSync(sourceDir);
    for (const name of names) {
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(targetDir, name);
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        force: true,
        dereference: false,
      });
    }
  }

  function copyFileWithParents(sourceFile, targetFile) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.cpSync(sourceFile, targetFile, { force: true });
  }

  function getBackupPathSpecs() {
    return [
      {
        id: "oc_home",
        targetPath: OC_HOME,
        backupPath: ".openclaw",
        type: "dir",
      },
      {
        id: "pkg_plugins",
        targetPath: path.join(TRIM_PKGVAR, "plugins"),
        backupPath: "var/plugins",
        type: "dir",
      },
      {
        id: "pkg_extensions",
        targetPath: path.join(TRIM_PKGVAR, "extensions"),
        backupPath: "var/extensions",
        type: "dir",
      },
      {
        id: "qqbot_node_modules",
        targetPath: path.join(
          TRIM_PKGVAR,
          "node_modules",
          "@tencent-connect",
          "openclaw-qqbot",
        ),
        backupPath: "var/node_modules/@tencent-connect/openclaw-qqbot",
        type: "dir",
      },
      {
        id: "wecom_node_modules",
        targetPath: path.join(
          TRIM_PKGVAR,
          "node_modules",
          "@wecom",
          "wecom-openclaw-plugin",
        ),
        backupPath: "var/node_modules/@wecom/wecom-openclaw-plugin",
        type: "dir",
      },
      {
        id: "skillhub_node_modules",
        targetPath: path.join(TRIM_PKGVAR, "node_modules", "skillhub"),
        backupPath: "var/node_modules/skillhub",
        type: "dir",
      },
      {
        id: "openclaw_skillhub_node_modules",
        targetPath: path.join(
          TRIM_PKGVAR,
          "node_modules",
          "@openclaw",
          "skillhub",
        ),
        backupPath: "var/node_modules/@openclaw/skillhub",
        type: "dir",
      },
    ];
  }

  async function createBackupArchive(mode = "manual-export") {
    const workDir = fs.mkdtempSync(path.join("/tmp", "oc-deploy-backup-"));
    const payloadDir = path.join(workDir, "payload");
    fs.mkdirSync(payloadDir, { recursive: true });

    const now = new Date();
    const stamp = formatBackupStamp(now);
    const specs = getBackupPathSpecs();
    const includedEntries = [];

    for (const spec of specs) {
      if (!fs.existsSync(spec.targetPath)) {
        continue;
      }
      const backupTarget = path.join(payloadDir, spec.backupPath);
      if (spec.type === "file") {
        copyFileWithParents(spec.targetPath, backupTarget);
      } else {
        copyDirectoryContents(spec.targetPath, backupTarget);
      }
      includedEntries.push({
        id: spec.id,
        sourcePath: spec.targetPath,
        backupPath: spec.backupPath,
        type: spec.type,
      });
    }

    if (includedEntries.length === 0) {
      cleanupPathQuietly(workDir);
      throw new Error("没有可导出的备份内容");
    }

    const manifest = {
      schemaVersion: 1,
      app: process.env.TRIM_APPNAME || "oc-deploy",
      mode,
      createdAt: now.toISOString(),
      entries: includedEntries,
    };
    fs.writeFileSync(
      path.join(payloadDir, BACKUP_MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    const fileName = `oc-deploy-backup-${mode}-${stamp}.tar.gz`;
    const archivePath = path.join(workDir, fileName);
    const tarCmd = `tar -czf ${shellQuote(archivePath)} -C ${shellQuote(payloadDir)} .`;
    await execCommand(tarCmd, { timeout: 600000 });

    return {
      workDir,
      archivePath,
      fileName,
      entriesCount: includedEntries.length,
    };
  }

  async function createPersistentBackupArchive(mode = "manual") {
    const backup = await createBackupArchive(mode);
    try {
      fs.mkdirSync(USER_BACKUP_ROOT, { recursive: true });
      const persistedPath = path.join(USER_BACKUP_ROOT, backup.fileName);
      fs.cpSync(backup.archivePath, persistedPath, { force: true });
      return persistedPath;
    } finally {
      cleanupPathQuietly(backup.workDir);
    }
  }

  function restoreBackupPayload(extractDir) {
    const specs = getBackupPathSpecs();
    const specById = new Map(specs.map((spec) => [spec.id, spec]));
    const specByBackupPath = new Map(
      specs.map((spec) => [spec.backupPath, spec]),
    );
    const manifestPath = path.join(extractDir, BACKUP_MANIFEST_FILE);
    const restored = [];

    const restoreSpec = (spec, sourcePath, itemType) => {
      if (itemType === "file") {
        copyFileWithParents(sourcePath, spec.targetPath);
      } else {
        copyDirectoryContents(sourcePath, spec.targetPath);
      }
      restored.push({
        id: spec.id,
        sourcePath,
        targetPath: spec.targetPath,
        type: itemType,
      });
    };

    if (fs.existsSync(manifestPath)) {
      const manifest = readJSON(manifestPath);
      const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
      for (const entry of entries) {
        const spec =
          (entry?.id && specById.get(entry.id)) ||
          (entry?.backupPath && specByBackupPath.get(entry.backupPath));
        if (!spec) {
          continue;
        }
        const sourcePath = path.join(
          extractDir,
          entry.backupPath || spec.backupPath,
        );
        if (!fs.existsSync(sourcePath)) {
          continue;
        }
        restoreSpec(spec, sourcePath, entry.type || spec.type || "dir");
      }
    }

    if (restored.length === 0) {
      for (const spec of specs) {
        const sourcePath = path.join(extractDir, spec.backupPath);
        if (!fs.existsSync(sourcePath)) {
          continue;
        }
        restoreSpec(spec, sourcePath, spec.type || "dir");
      }
    }

    if (restored.length === 0) {
      throw new Error("备份包中未找到可恢复的内容");
    }

    return restored;
  }

  function readBodyBuffer(req, maxBytes = MAX_BACKUP_UPLOAD_BYTES) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let finished = false;

      req.on("data", (chunk) => {
        if (finished) return;
        size += chunk.length;
        if (size > maxBytes) {
          finished = true;
          reject(
            new Error(
              `上传文件过大，已超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 限制`,
            ),
          );
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (finished) return;
        finished = true;
        resolve(Buffer.concat(chunks));
      });

      req.on("error", (err) => {
        if (finished) return;
        finished = true;
        reject(err);
      });
    });
  }

  function parseMultipartUpload(contentType, bodyBuffer) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      throw new Error("上传请求缺少 multipart boundary");
    }
    const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");
    const delimiter = Buffer.from(`--${boundary}`);
    const nextPartDelimiter = Buffer.from(`\r\n--${boundary}`);
    const headerSeparator = Buffer.from("\r\n\r\n");
    let cursor = 0;

    while (true) {
      const boundaryPos = bodyBuffer.indexOf(delimiter, cursor);
      if (boundaryPos === -1) {
        break;
      }
      cursor = boundaryPos + delimiter.length;

      if (
        cursor + 1 < bodyBuffer.length &&
        bodyBuffer[cursor] === 45 &&
        bodyBuffer[cursor + 1] === 45
      ) {
        break;
      }

      if (
        cursor + 1 < bodyBuffer.length &&
        bodyBuffer[cursor] === 13 &&
        bodyBuffer[cursor + 1] === 10
      ) {
        cursor += 2;
      }

      const headerEnd = bodyBuffer.indexOf(headerSeparator, cursor);
      if (headerEnd === -1) {
        break;
      }

      const headersText = bodyBuffer.slice(cursor, headerEnd).toString("utf8");
      const dataStart = headerEnd + headerSeparator.length;
      const nextBoundaryPos = bodyBuffer.indexOf(nextPartDelimiter, dataStart);
      if (nextBoundaryPos === -1) {
        break;
      }

      const data = bodyBuffer.slice(dataStart, nextBoundaryPos);
      const dispositionLine = headersText
        .split("\r\n")
        .find((line) => line.toLowerCase().startsWith("content-disposition:"));
      const nameMatch = dispositionLine?.match(/name="([^"]+)"/i);
      const filenameMatch = dispositionLine?.match(/filename="([^"]*)"/i);

      if (filenameMatch && filenameMatch[1]) {
        return {
          fieldName: nameMatch ? nameMatch[1] : "file",
          filename: path.basename(filenameMatch[1]),
          data,
        };
      }

      cursor = nextBoundaryPos + 2;
    }

    throw new Error("未在上传请求中找到备份文件");
  }

  async function importBackupArchiveFromRequest(req) {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      throw new Error("请使用 multipart/form-data 上传备份文件");
    }

    const bodyBuffer = await readBodyBuffer(req);
    const upload = parseMultipartUpload(contentType, bodyBuffer);
    if (!upload.data || upload.data.length === 0) {
      throw new Error("上传的备份文件为空");
    }
    if (
      upload.data.length < 2 ||
      upload.data[0] !== 0x1f ||
      upload.data[1] !== 0x8b
    ) {
      throw new Error("备份文件格式错误，请上传 .tar.gz 文件");
    }

    const uploadWorkDir = fs.mkdtempSync(
      path.join("/tmp", "oc-deploy-import-"),
    );
    const archiveName =
      upload.filename && upload.filename.trim()
        ? upload.filename.trim().replace(/[^\w.@-]+/g, "_")
        : `oc-deploy-backup-upload-${Date.now()}.tar.gz`;
    const archivePath = path.join(uploadWorkDir, archiveName);
    const extractDir = path.join(uploadWorkDir, "extract");

    try {
      fs.writeFileSync(archivePath, upload.data);
      fs.mkdirSync(extractDir, { recursive: true });

      const extractCmd = `tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(extractDir)}`;
      await execCommand(extractCmd, { timeout: 600000 });

      let preBackupPath = "";
      let preBackupWarning = "";
      try {
        preBackupPath = await createPersistentBackupArchive("pre-import");
      } catch (err) {
        preBackupWarning =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "创建导入前备份失败";
        console.warn("[backup-import] pre-backup failed:", preBackupWarning);
      }

      const restoredEntries = restoreBackupPayload(extractDir);

      let restarted = false;
      let restartError = "";
      try {
        const restartResult = await restartGateway();
        restarted = !!restartResult?.success;
      } catch (err) {
        restartError =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "未知错误";
      }

      return {
        success: true,
        restoredCount: restoredEntries.length,
        preBackupPath: preBackupPath || undefined,
        preBackupWarning: preBackupWarning || undefined,
        restarted,
        restartError: restartError || undefined,
      };
    } finally {
      cleanupPathQuietly(uploadWorkDir);
    }
  }

  return {
    createBackupArchive,
    importBackupArchiveFromRequest,
    cleanupPathQuietly,
  };
}

module.exports = {
  createBackupService,
};
