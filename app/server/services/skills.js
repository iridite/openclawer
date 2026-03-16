const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { execSync } = require("child_process");

function createSkillsService(options) {
  const { OC_HOME, TRIM_PKGVAR, readJSON, writeJSON } = options;

  const installingSkills = new Set();
  const SKILLS_DIR = path.join(OC_HOME, "skills");
  const BUILTIN_SKILLS_DIR = path.join(TRIM_PKGVAR, "node_modules", "openclaw", "skills");
  const LOCKFILE_PATH = path.join(SKILLS_DIR, ".skills_store_lock.json");
  const SEARCH_API = "https://lightmake.site/api/v1/search";
  const PRIMARY_DOWNLOAD = "https://lightmake.site/api/v1/download";
  const FALLBACK_DOWNLOAD = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills";

  function fetchJSON(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      const request = client.get(url, (res) => {
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
            reject(err);
          }
        });
      });
      
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error("请求超时"));
      });
      
      request.on("error", reject);
    });
  }

  function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      const file = fs.createWriteStream(dest);
      
      const request = client.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          file.close();
          fs.unlinkSync(dest);
          downloadFile(res.headers.location, dest).then(resolve).catch(reject);
          return;
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
      
      request.setTimeout(30000, () => {
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

  function loadLockfile() {
    if (!fs.existsSync(LOCKFILE_PATH)) {
      return { version: 1, skills: {} };
    }
    const data = readJSON(LOCKFILE_PATH);
    return data || { version: 1, skills: {} };
  }

  function saveLockfile(lock) {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
    writeJSON(LOCKFILE_PATH, lock);
  }

  async function search(query, limit = 20) {
    try {
      const url = `${SEARCH_API}?q=${encodeURIComponent(query)}&limit=${limit}`;
      const data = await fetchJSON(url);
      return {
        success: true,
        skills: Array.isArray(data.results) ? data.results : [],
      };
    } catch (err) {
      return {
        success: false,
        error: `搜索失败: ${err.message}`,
      };
    }
  }

  async function install(slug, force = false) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return {
        success: false,
        error: "无效的技能名称格式",
      };
    }

    if (installingSkills.has(slug)) {
      return {
        success: false,
        error: `技能 ${slug} 正在安装中`,
      };
    }

    installingSkills.add(slug);

    const targetDir = path.join(SKILLS_DIR, slug);

    if (fs.existsSync(targetDir) && !force) {
      return {
        success: false,
        error: `技能 ${slug} 已安装，使用 force=true 覆盖安装`,
      };
    }

    const tmpDir = path.join(SKILLS_DIR, `.tmp-${slug}-${Date.now()}`);
    const zipPath = path.join(tmpDir, `${slug}.zip`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      const primaryUrl = `${PRIMARY_DOWNLOAD}?slug=${slug}`;
      const fallbackUrl = `${FALLBACK_DOWNLOAD}/${slug}.zip`;

      let downloadSuccess = false;
      let usedUrl = "";

      try {
        await downloadFile(primaryUrl, zipPath);
        downloadSuccess = true;
        usedUrl = primaryUrl;
      } catch (err) {
        try {
          await downloadFile(fallbackUrl, zipPath);
          downloadSuccess = true;
          usedUrl = fallbackUrl;
        } catch (fallbackErr) {
          throw new Error(`主源和备用源均下载失败: ${err.message}, ${fallbackErr.message}`);
        }
      }

      if (!downloadSuccess) {
        throw new Error("下载失败");
      }

      const stageDir = path.join(tmpDir, "stage");
      fs.mkdirSync(stageDir, { recursive: true });
      execSync(`unzip -q -o "${zipPath}" -d "${stageDir}"`, { stdio: 'inherit' });

      // 智能检测 ZIP 结构：如果只有一个子目录，提取其内容
      const entries = fs.readdirSync(stageDir);
      let sourceDir = stageDir;
      
      if (entries.length === 1) {
        const singleEntry = path.join(stageDir, entries[0]);
        if (fs.statSync(singleEntry).isDirectory()) {
          sourceDir = singleEntry;
        }
      }

      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      fs.renameSync(sourceDir, targetDir);

      const lock = loadLockfile();
      lock.skills[slug] = {
        name: slug,
        zip_url: usedUrl,
        source: "skillhub",
        version: "",
        installed_at: new Date().toISOString(),
      };
      saveLockfile(lock);

      fs.rmSync(tmpDir, { recursive: true, force: true });

      return {
        success: true,
        message: `技能 ${slug} 安装成功`,
        path: targetDir,
      };
    } catch (err) {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      return {
        success: false,
        error: `安装失败: ${err.message}`,
      };
    } finally {
      installingSkills.delete(slug);
    }
  }

  function readSkillMetadata(skillDir) {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      return { description: "", requiresApi: false };
    }

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");

      // Extract first paragraph as description (skip frontmatter if present)
      let description = "";
      const lines = content.split("\n");
      let inFrontmatter = false;
      let foundFirstPara = false;

      for (const line of lines) {
        if (line.trim() === "---") {
          inFrontmatter = !inFrontmatter;
          continue;
        }
        if (inFrontmatter) continue;

        if (line.trim() && !line.startsWith("#")) {
          if (!foundFirstPara) {
            description = line.trim();
            foundFirstPara = true;
            break;
          }
        }
      }

      // Detect API requirements
      const requiresApi = /API[_\s]?key|authentication|credentials|token/i.test(content);

      return { description, requiresApi };
    } catch (err) {
      return { description: "", requiresApi: false };
    }
  }

  function listBuiltinSkills() {
    if (!fs.existsSync(BUILTIN_SKILLS_DIR)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => {
          const skillDir = path.join(BUILTIN_SKILLS_DIR, e.name);
          const metadata = readSkillMetadata(skillDir);

          return {
            slug: e.name,
            name: e.name,
            version: "",
            source: "builtin",
            installed_at: "",
            exists: true,
            location: "builtin",
            description: metadata.description,
            requiresApi: metadata.requiresApi,
            enabled: true
          };
        });
    } catch (err) {
      return [];
    }
  }

  async function list() {
    try {
      const lock = loadLockfile();
      const userSkills = Object.entries(lock.skills || {}).map(([slug, meta]) => ({
        slug,
        name: meta.name || slug,
        version: meta.version || "",
        source: meta.source || "unknown",
        installed_at: meta.installed_at || "",
        exists: fs.existsSync(path.join(SKILLS_DIR, slug)),
        location: "user"
      }));

      const builtinSkills = listBuiltinSkills();

      return {
        success: true,
        skills: [...userSkills, ...builtinSkills],
      };
    } catch (err) {
      return {
        success: false,
        error: `列表获取失败: ${err.message}`,
      };
    }
  }

  async function uninstall(slug) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return {
        success: false,
        error: "无效的技能名称格式",
      };
    }

    const targetDir = path.join(SKILLS_DIR, slug);

    try {
      if (!fs.existsSync(targetDir)) {
        return {
          success: false,
          error: `技能 ${slug} 未安装`,
        };
      }

      fs.rmSync(targetDir, { recursive: true, force: true });

      const lock = loadLockfile();
      delete lock.skills[slug];
      saveLockfile(lock);

      return {
        success: true,
        message: `技能 ${slug} 已卸载`,
      };
    } catch (err) {
      return {
        success: false,
        error: `卸载失败: ${err.message}`,
      };
    }
  }

  return {
    search,
    install,
    list,
    uninstall,
  };
}

module.exports = {
  createSkillsService,
};