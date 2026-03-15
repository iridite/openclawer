const fs = require("fs");
const path = require("path");

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

  function serveStaticFile(filePath, res) {
    const resolvedPath = path.resolve(filePath);
    const resolvedUIDir = path.resolve(UI_DIR);

    if (!resolvedPath.startsWith(resolvedUIDir)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("400 Bad Request");
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    try {
      const mimeType = getMimeType(resolvedPath);
      const content = fs.readFileSync(resolvedPath);
      res.writeHead(200, { "Content-Type": mimeType });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 Internal Server Error");
    }
  }

  function handleStaticRequest(pathname, res) {
    let filePath;

    if (pathname === "/" || pathname === "") {
      filePath = path.join(UI_DIR, "management.html");
    } else {
      filePath = path.join(UI_DIR, pathname);
    }

    serveStaticFile(filePath, res);
  }

  return { handleStaticRequest };
}

module.exports = { createStaticFileService };
