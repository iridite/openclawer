// ===========================================================================
// HTTP Client Utilities
// Shared HTTP client functions for making requests and downloading files
// ===========================================================================

const https = require('https');
const http = require('http');
const fs = require('fs');

/**
 * Fetch JSON from a URL with timeout and redirect handling
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Object>} - Parsed JSON response
 */
function fetchJSON(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': 'oc-deploy' } }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        request.destroy();
        return resolve(fetchJSON(res.headers.location, timeout));
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    request.setTimeout(timeout, () => {
      request.destroy();
      reject(new Error("请求超时"));
    });

    request.on("error", reject);
  });
}

/**
 * Download a file from URL with timeout and redirect handling
 * @param {string} url - URL to download from
 * @param {string} dest - Destination file path
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<void>}
 */
function downloadFile(url, dest, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);

    const request = client.get(url, { headers: { 'User-Agent': 'oc-deploy' } }, (res) => {
      // Handle redirects
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest, timeout).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });

    request.setTimeout(timeout, () => {
      request.destroy();
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(new Error("下载超时"));
    });

    request.on("error", (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

module.exports = {
  fetchJSON,
  downloadFile,
};
