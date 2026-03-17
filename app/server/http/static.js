const fs = require("fs");
const path = require("path");

const NO_BODY_STATUS_CODES = new Set([204, 304]);
const IMMUTABLE_ASSET_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".ico",
]);

function createStaticFileService(deps) {
  const { UI_DIR } = deps;

  function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  function sendText(req, res, statusCode, body, extraHeaders = {}) {
    res.writeHead(statusCode, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    if (req.method === "HEAD" || NO_BODY_STATUS_CODES.has(statusCode)) {
      res.end();
      return;
    }
    res.end(body);
  }

  function isPathInsideUiDir(resolvedPath, resolvedUIDir) {
    return (
      resolvedPath === resolvedUIDir ||
      resolvedPath.startsWith(`${resolvedUIDir}${path.sep}`)
    );
  }

  function buildEtag(stat) {
    return `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  }

  function getCacheControl(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") {
      return "no-cache, must-revalidate";
    }
    if (IMMUTABLE_ASSET_EXTENSIONS.has(ext)) {
      return "public, max-age=300, must-revalidate";
    }
    return "no-cache";
  }

  function isNotModified(req, etag, stat) {
    const ifNoneMatch = String(req.headers["if-none-match"] || "").trim();
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === "*")) {
      return true;
    }

    const ifModifiedSince = req.headers["if-modified-since"];
    if (!ifModifiedSince) {
      return false;
    }

    const modifiedSinceTime = Date.parse(ifModifiedSince);
    if (Number.isNaN(modifiedSinceTime)) {
      return false;
    }

    return Math.trunc(stat.mtimeMs) <= modifiedSinceTime;
  }

  function serveStaticFile(req, filePath, res) {
    const resolvedPath = path.resolve(filePath);
    const resolvedUIDir = path.resolve(UI_DIR);

    if (!isPathInsideUiDir(resolvedPath, resolvedUIDir)) {
      sendText(req, res, 400, "400 Bad Request");
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(req, res, 405, "405 Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }

    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        sendText(req, res, 404, "404 Not Found");
        return;
      }
      sendText(req, res, 500, "500 Internal Server Error");
      return;
    }

    if (!stat.isFile()) {
      sendText(req, res, 404, "404 Not Found");
      return;
    }

    const etag = buildEtag(stat);
    const headers = {
      "Content-Type": getMimeType(resolvedPath),
      "Content-Length": String(stat.size),
      "Cache-Control": getCacheControl(resolvedPath),
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    };

    if (isNotModified(req, etag, stat)) {
      const notModifiedHeaders = { ...headers };
      delete notModifiedHeaders["Content-Length"];
      res.writeHead(304, notModifiedHeaders);
      res.end();
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    try {
      const stream = fs.createReadStream(resolvedPath);
      const destroyStream = () => {
        if (!stream.destroyed) {
          stream.destroy();
        }
      };

      req.on("aborted", destroyStream);
      res.on("close", destroyStream);

      stream.on("error", () => {
        destroyStream();
        if (!res.headersSent) {
          sendText(req, res, 500, "500 Internal Server Error");
          return;
        }
        res.destroy();
      });

      res.writeHead(200, headers);
      stream.pipe(res);
    } catch (err) {
      sendText(req, res, 500, "500 Internal Server Error");
    }
  }

  function handleStaticRequest(req, pathname, res) {
    let filePath;

    if (pathname === "/" || pathname === "") {
      filePath = path.join(UI_DIR, "management.html");
    } else {
      filePath = path.join(UI_DIR, pathname.replace(/^\/+/, ""));
    }

    serveStaticFile(req, filePath, res);
  }

  return { handleStaticRequest };
}

module.exports = { createStaticFileService };
