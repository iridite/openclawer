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
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
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
          reject({ error: err, stderr: stderr || err.message });
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
