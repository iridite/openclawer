const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { badRequestError, conflictError } = require("../core/http-errors");
const { resolveBackupPathSpecs } = require("../core/backup-specs");

const MULTIPART_HEADER_LIMIT_BYTES = 64 * 1024;

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

  async function cleanupPathQuietly(targetPath) {
    try {
      await fsp.rm(targetPath, { recursive: true, force: true });
    } catch (err) {}
  }

  async function copyDirectoryContents(sourceDir, targetDir) {
    await fsp.mkdir(targetDir, { recursive: true });
    const names = await fsp.readdir(sourceDir);
    for (const name of names) {
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(targetDir, name);
      await fsp.cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
        dereference: false,
      });
    }
  }

  async function copyFileWithParents(sourceFile, targetFile) {
    await fsp.mkdir(path.dirname(targetFile), { recursive: true });
    await fsp.cp(sourceFile, targetFile, { force: true });
  }

  function getBackupPathSpecs() {
    return resolveBackupPathSpecs({
      OC_HOME,
      TRIM_PKGVAR,
    });
  }

  async function createBackupArchive(mode = "manual-export") {
    const workDir = await fsp.mkdtemp(path.join("/tmp", "oc-deploy-backup-"));
    const payloadDir = path.join(workDir, "payload");
    await fsp.mkdir(payloadDir, { recursive: true });

    const now = new Date();
    const stamp = formatBackupStamp(now);
    const specs = getBackupPathSpecs();
    const includedEntries = [];

    for (const spec of specs) {
      try {
        await fsp.access(spec.targetPath);
      } catch (err) {
        continue;
      }
      const backupTarget = path.join(payloadDir, spec.backupPath);
      if (spec.type === "file") {
        await copyFileWithParents(spec.targetPath, backupTarget);
      } else {
        await copyDirectoryContents(spec.targetPath, backupTarget);
      }
      includedEntries.push({
        id: spec.id,
        sourcePath: spec.targetPath,
        backupPath: spec.backupPath,
        type: spec.type,
      });
    }

    if (includedEntries.length === 0) {
      await cleanupPathQuietly(workDir);
      throw conflictError("没有可导出的备份内容");
    }

    const manifest = {
      schemaVersion: 1,
      app: process.env.TRIM_APPNAME || "oc-deploy",
      mode,
      createdAt: now.toISOString(),
      entries: includedEntries,
    };
    await fsp.writeFile(
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
      await fsp.mkdir(USER_BACKUP_ROOT, { recursive: true });
      const persistedPath = path.join(USER_BACKUP_ROOT, backup.fileName);
      await fsp.cp(backup.archivePath, persistedPath, { force: true });
      return persistedPath;
    } finally {
      await cleanupPathQuietly(backup.workDir);
    }
  }

  async function restoreBackupPayload(extractDir) {
    const specs = getBackupPathSpecs();
    const specById = new Map(specs.map((spec) => [spec.id, spec]));
    const specByBackupPath = new Map(
      specs.map((spec) => [spec.backupPath, spec]),
    );
    const manifestPath = path.join(extractDir, BACKUP_MANIFEST_FILE);
    const restored = [];

    const restoreSpec = async (spec, sourcePath, itemType) => {
      if (itemType === "file") {
        await copyFileWithParents(sourcePath, spec.targetPath);
      } else {
        await copyDirectoryContents(sourcePath, spec.targetPath);
      }
      restored.push({
        id: spec.id,
        sourcePath,
        targetPath: spec.targetPath,
        type: itemType,
      });
    };

    try {
      await fsp.access(manifestPath);
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
        try {
          await fsp.access(sourcePath);
        } catch (err) {
          continue;
        }
        await restoreSpec(spec, sourcePath, entry.type || spec.type || "dir");
      }
    } catch (err) {}

    if (restored.length === 0) {
      for (const spec of specs) {
        const sourcePath = path.join(extractDir, spec.backupPath);
        try {
          await fsp.access(sourcePath);
        } catch (err) {
          continue;
        }
        await restoreSpec(spec, sourcePath, spec.type || "dir");
      }
    }

    if (restored.length === 0) {
      throw conflictError("备份包中未找到可恢复的内容");
    }

    return restored;
  }

  function extractMultipartBoundary(contentType) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      throw badRequestError("上传请求缺少 multipart boundary");
    }
    return boundaryMatch[1].trim().replace(/^"|"$/g, "");
  }

  function sanitizeArchiveName(fileName) {
    const normalized = String(fileName || "").trim();
    if (!normalized) {
      return `oc-deploy-backup-upload-${Date.now()}.tar.gz`;
    }
    return normalized.replace(/[^\w.@-]+/g, "_");
  }

  async function isGzipFile(filePath) {
    const fd = await fsp.open(filePath, "r");
    try {
      const header = Buffer.alloc(2);
      const { bytesRead } = await fd.read(header, 0, 2, 0);
      return bytesRead === 2 && header[0] === 0x1f && header[1] === 0x8b;
    } finally {
      await fd.close();
    }
  }

  function parseMultipartUploadToFile(req, contentType, maxBytes = MAX_BACKUP_UPLOAD_BYTES) {
    const boundary = extractMultipartBoundary(contentType);
    const initialBoundary = Buffer.from(`--${boundary}`);
    const partBoundary = Buffer.from(`\r\n--${boundary}`);
    const headerSeparator = Buffer.from("\r\n\r\n");
    const keepTailBytes = partBoundary.length + 4;
    const uploadWorkDir = fs.mkdtempSync(
      path.join("/tmp", "oc-deploy-upload-"),
    );
    const tempArchivePath = path.join(uploadWorkDir, "upload.bin");

    return new Promise((resolve, reject) => {
      let state = "seek-boundary";
      let pending = Buffer.alloc(0);
      let totalBytes = 0;
      let currentPartIsFile = false;
      let fileDescriptor = null;
      let fileSize = 0;
      let uploadMeta = null;
      let settled = false;

      const cleanupResources = (removeDir) => {
        if (fileDescriptor !== null) {
          try {
            fs.closeSync(fileDescriptor);
          } catch (err) {}
          fileDescriptor = null;
        }
        if (removeDir) {
          cleanupPathQuietly(uploadWorkDir);
        }
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanupResources(true);
        reject(error);
      };

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        cleanupResources(false);
        resolve({
          fieldName: uploadMeta?.fieldName || "file",
          filename: uploadMeta?.filename || "",
          archivePath: tempArchivePath,
          workDir: uploadWorkDir,
          size: fileSize,
        });
      };

      const writePartChunk = (chunk) => {
        if (!currentPartIsFile || !chunk || chunk.length === 0) {
          return;
        }
        fs.writeSync(fileDescriptor, chunk, 0, chunk.length);
        fileSize += chunk.length;
      };

      const finalizeCurrentPart = () => {
        if (fileDescriptor !== null) {
          try {
            fs.closeSync(fileDescriptor);
          } catch (err) {}
          fileDescriptor = null;
        }
        currentPartIsFile = false;
      };

      const processPending = () => {
        while (!settled) {
          if (state === "seek-boundary") {
            const boundaryPos = pending.indexOf(initialBoundary);
            if (boundaryPos === -1) {
              if (pending.length > keepTailBytes) {
                pending = pending.slice(pending.length - keepTailBytes);
              }
              return;
            }

            pending = pending.slice(boundaryPos + initialBoundary.length);
            if (pending.length < 2) {
              return;
            }

            if (pending[0] === 45 && pending[1] === 45) {
              state = "done";
              pending = pending.slice(2);
              continue;
            }

            if (pending[0] !== 13 || pending[1] !== 10) {
              finishReject(badRequestError("上传请求格式错误"));
              return;
            }

            pending = pending.slice(2);
            state = "headers";
            continue;
          }

          if (state === "headers") {
            const headerEnd = pending.indexOf(headerSeparator);
            if (headerEnd === -1) {
              if (pending.length > MULTIPART_HEADER_LIMIT_BYTES) {
                finishReject(badRequestError("上传请求头过大"));
              }
              return;
            }

            const headersText = pending.slice(0, headerEnd).toString("utf8");
            pending = pending.slice(headerEnd + headerSeparator.length);
            const dispositionLine = headersText
              .split("\r\n")
              .find((line) =>
                line.toLowerCase().startsWith("content-disposition:"),
              );
            const nameMatch = dispositionLine?.match(/name="([^"]+)"/i);
            const filenameMatch = dispositionLine?.match(/filename="([^"]*)"/i);
            const fileName = filenameMatch?.[1]
              ? path.basename(filenameMatch[1])
              : "";

            currentPartIsFile = !!fileName && !uploadMeta;
            if (currentPartIsFile) {
              fileDescriptor = fs.openSync(tempArchivePath, "w");
              uploadMeta = {
                fieldName: nameMatch ? nameMatch[1] : "file",
                filename: fileName,
              };
            }

            state = "part-data";
            continue;
          }

          if (state === "part-data") {
            const nextBoundaryPos = pending.indexOf(partBoundary);
            if (nextBoundaryPos === -1) {
              if (pending.length <= keepTailBytes) {
                return;
              }

              const chunk = pending.slice(0, pending.length - keepTailBytes);
              writePartChunk(chunk);
              pending = pending.slice(pending.length - keepTailBytes);
              return;
            }

            writePartChunk(pending.slice(0, nextBoundaryPos));
            pending = pending.slice(nextBoundaryPos + 2);
            finalizeCurrentPart();
            state = "seek-boundary";
            continue;
          }

          if (state === "done") {
            if (!uploadMeta) {
              finishReject(badRequestError("未在上传请求中找到备份文件"));
              return;
            }
            finishResolve();
            return;
          }

          finishReject(badRequestError("上传请求格式错误"));
          return;
        }
      };

      req.on("data", (chunk) => {
        if (settled) {
          return;
        }

        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          finishReject(
            badRequestError(
              `上传文件过大，已超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 限制`,
            ),
          );
          req.resume();
          return;
        }

        pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
        processPending();
      });

      req.on("end", () => {
        if (settled) {
          return;
        }

        if (state === "done") {
          finishResolve();
          return;
        }

        finalizeCurrentPart();
        if (!uploadMeta) {
          finishReject(badRequestError("未在上传请求中找到备份文件"));
          return;
        }
        finishReject(badRequestError("上传请求格式错误"));
      });

      req.on("error", (err) => {
        if (settled) {
          return;
        }
        finishReject(err);
      });
    });
  }

  async function listArchiveEntries(archivePath) {
    const cmd = `tar -tzf ${shellQuote(archivePath)}`;
    const output = await execCommand(cmd, { timeout: 600000 });
    return String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function validateArchiveEntryPath(entry) {
    const raw = String(entry || "").trim();
    if (!raw) {
      return { ok: false, reason: "empty entry" };
    }

    const normalized = raw.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
      return { ok: false, reason: "absolute path" };
    }

    const cleaned = path.posix.normalize(normalized);
    if (
      cleaned === ".." ||
      cleaned.startsWith("../") ||
      cleaned.includes("/../")
    ) {
      return { ok: false, reason: "path traversal" };
    }

    return { ok: true };
  }

  async function assertArchiveSafe(archivePath) {
    const entries = await listArchiveEntries(archivePath);
    for (const entry of entries) {
      const check = validateArchiveEntryPath(entry);
      if (!check.ok) {
        throw badRequestError(
          `备份包包含非法路径条目，已拒绝导入: ${entry} (${check.reason})`,
        );
      }
    }
  }

  async function importBackupArchiveFromRequest(req) {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      throw badRequestError("请使用 multipart/form-data 上传备份文件");
    }

    const upload = await parseMultipartUploadToFile(req, contentType);
    if (!upload.archivePath || upload.size === 0) {
      throw badRequestError("上传的备份文件为空");
    }
    if (!(await isGzipFile(upload.archivePath))) {
      throw badRequestError("备份文件格式错误，请上传 .tar.gz 文件");
    }

    const uploadWorkDir = upload.workDir;
    const archiveName = sanitizeArchiveName(upload.filename);
    const archivePath = path.join(uploadWorkDir, archiveName);
    const extractDir = path.join(uploadWorkDir, "extract");

    try {
      if (archivePath !== upload.archivePath) {
        await fsp.rename(upload.archivePath, archivePath);
      }
      await assertArchiveSafe(archivePath);
      await fsp.mkdir(extractDir, { recursive: true });

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

      const restoredEntries = await restoreBackupPayload(extractDir);

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
      await cleanupPathQuietly(uploadWorkDir);
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
