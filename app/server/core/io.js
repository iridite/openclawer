const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

function readJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

function writeJSON(filePath, data) {
  let tempFilePath = "";
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload = JSON.stringify(data, null, 2);
    tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const fd = fs.openSync(tempFilePath, "w", 0o600);
    try {
      fs.writeFileSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(tempFilePath, filePath);

    try {
      const dirFd = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch (err) {
      // Some filesystems may not support fsync on directories.
    }

    return true;
  } catch (err) {
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupErr) {}
    }
    console.error("写入文件失败:", err);
    return false;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (err) {
    return "";
  }
}

function formatByteLimit(maxBytes) {
  const bytes = Number(maxBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `${maxBytes}`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function createPayloadTooLargeError(maxBytes) {
  const err = new Error(`请求体过大，超过 ${formatByteLimit(maxBytes)} 限制`);
  err.statusCode = 413;
  err.code = "payload_too_large";
  return err;
}

function readBody(req, options = {}) {
  const maxBytes = Number(options.maxBytes || process.env.API_MAX_BODY_BYTES || 5 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    let body = "";
    let receivedBytes = 0;
    let rejected = false;

    const fail = (err) => {
      if (rejected) return;
      rejected = true;
      reject(err);
    };

    const contentLength = Number(req.headers?.["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > maxBytes) {
      req.resume();
      fail(createPayloadTooLargeError(maxBytes));
      return;
    }

    req.on("data", (chunk) => {
      if (rejected) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        req.pause();
        req.resume();
        fail(createPayloadTooLargeError(maxBytes));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!rejected) {
        resolve(body);
      }
    });
    req.on("error", (err) => fail(err));
  });
}

function execCommand(command, options = {}) {
  const timeout = options.timeout || 30000;
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(new Error(`命令超时 (${timeout}ms)`));
        } else {
          reject(new Error(stderr || err.message));
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

module.exports = {
  readJSON,
  writeJSON,
  readText,
  readBody,
  execCommand,
};
