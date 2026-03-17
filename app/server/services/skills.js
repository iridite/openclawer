const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { fetchJSON, downloadFile } = require("../core/http-client");

function createSkillsService(options) {
  const { OC_HOME, TRIM_PKGVAR, CONFIG_FILE, readJSON, writeJSON } = options;

  const installingSkills = new Set();
  const SKILLS_DIR = path.join(OC_HOME, "skills");
  const BUILTIN_SKILLS_DIR = path.join(TRIM_PKGVAR, "node_modules", "openclaw", "skills");
  const LOCKFILE_PATH = path.join(SKILLS_DIR, ".skills_store_lock.json");
  const SEARCH_API = "https://lightmake.site/api/v1/search";
  const PRIMARY_DOWNLOAD = "https://lightmake.site/api/v1/download";
  const FALLBACK_DOWNLOAD = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills";
  const SKILL_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

  function loadLockfile() {
    if (!fs.existsSync(LOCKFILE_PATH)) {
      return { version: 1, skills: {} };
    }
    const data = readJSON(LOCKFILE_PATH);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { version: 1, skills: {} };
    }
    if (!data.skills || typeof data.skills !== "object" || Array.isArray(data.skills)) {
      data.skills = {};
    }
    if (!data.version) {
      data.version = 1;
    }
    return data;
  }

  function saveLockfile(lock) {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
    const ok = writeJSON(LOCKFILE_PATH, lock);
    if (!ok) {
      throw new Error("写入技能锁文件失败");
    }
  }

  function isValidSkillSlug(slug) {
    return SKILL_SLUG_PATTERN.test(String(slug || "").trim());
  }

  function isValidSkillEntryKey(entryKey) {
    const value = String(entryKey || "").trim();
    if (!value) return false;
    if (value.length > 128) return false;
    return !/[\u0000-\u001f]/.test(value);
  }

  function parseFrontmatter(content) {
    const lines = String(content || "").split("\n");
    if (lines[0]?.trim() !== "---") {
      return "";
    }

    const frontmatterLines = [];
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        return frontmatterLines.join("\n");
      }
      frontmatterLines.push(lines[i]);
    }
    return "";
  }

  function extractFrontmatterValue(frontmatter, key) {
    const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.+)\\s*$`, "im");
    const match = frontmatter.match(pattern);
    if (!match) return "";
    let value = match[1].trim();
    if (!value || value === "|" || value === ">") return "";
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }

  function extractSkillEntryKey(frontmatter) {
    const direct = extractFrontmatterValue(frontmatter, "skillKey");
    if (direct) return direct;

    const metadataJsonSkillKey = frontmatter.match(
      /["']skillKey["']\s*:\s*["']([^"']+)["']/i,
    );
    return metadataJsonSkillKey ? metadataJsonSkillKey[1].trim() : "";
  }

  function loadConfigForWrite() {
    if (!CONFIG_FILE) {
      throw new Error("未配置 openclaw.json 路径");
    }
    if (!fs.existsSync(CONFIG_FILE)) {
      throw new Error("openclaw.json 不存在，请先完成初始化");
    }

    const config = readJSON(CONFIG_FILE);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("openclaw.json 解析失败");
    }
    return config;
  }

  function loadSkillEntriesConfigSafe() {
    if (!CONFIG_FILE || !fs.existsSync(CONFIG_FILE)) {
      return {};
    }

    const config = readJSON(CONFIG_FILE);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return {};
    }
    const entries = config?.skills?.entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return {};
    }
    return entries;
  }

  function ensureSkillsEntries(config) {
    if (!config.skills || typeof config.skills !== "object" || Array.isArray(config.skills)) {
      config.skills = {};
    }
    if (
      !config.skills.entries ||
      typeof config.skills.entries !== "object" ||
      Array.isArray(config.skills.entries)
    ) {
      config.skills.entries = {};
    }
    return config.skills.entries;
  }

  function getSkillEnabledState(entries, entryKey) {
    if (!entryKey) {
      return true;
    }
    const entry = entries?.[entryKey];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return true;
    }
    return entry.enabled !== false;
  }

  function saveConfig(config) {
    const ok = writeJSON(CONFIG_FILE, config);
    if (!ok) {
      throw new Error("写入 openclaw.json 失败");
    }
  }

  function resolveSkillRecord(slug, location) {
    const normalizedSlug = String(slug || "").trim();
    if (!normalizedSlug) {
      return null;
    }

    const lock = loadLockfile();
    const userSkillDir = path.join(SKILLS_DIR, normalizedSlug);
    const hasUserSkill = !!lock.skills[normalizedSlug] || fs.existsSync(userSkillDir);

    if (location !== "builtin" && hasUserSkill) {
      const metadata = readSkillMetadata(userSkillDir, normalizedSlug);
      return {
        slug: normalizedSlug,
        location: "user",
        entryKey: metadata.entryKey || normalizedSlug,
      };
    }

    const builtinSkillDir = path.join(BUILTIN_SKILLS_DIR, normalizedSlug);
    if (location !== "user" && fs.existsSync(builtinSkillDir)) {
      const metadata = readSkillMetadata(builtinSkillDir, normalizedSlug);
      return {
        slug: normalizedSlug,
        location: "builtin",
        entryKey: metadata.entryKey || normalizedSlug,
      };
    }

    return null;
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
    const normalizedSlug = String(slug || "").trim();
    if (!isValidSkillSlug(normalizedSlug)) {
      return {
        success: false,
        error: "无效的技能名称格式",
      };
    }

    if (installingSkills.has(normalizedSlug)) {
      return {
        success: false,
        error: `技能 ${normalizedSlug} 正在安装中`,
      };
    }
    const targetDir = path.join(SKILLS_DIR, normalizedSlug);

    if (fs.existsSync(targetDir) && !force) {
      return {
        success: false,
        error: `技能 ${normalizedSlug} 已安装，使用 force=true 覆盖安装`,
      };
    }

    installingSkills.add(normalizedSlug);

    const tmpDir = path.join(SKILLS_DIR, `.tmp-${normalizedSlug}-${Date.now()}`);
    const zipPath = path.join(tmpDir, `${normalizedSlug}.zip`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      const primaryUrl = `${PRIMARY_DOWNLOAD}?slug=${normalizedSlug}`;
      const fallbackUrl = `${FALLBACK_DOWNLOAD}/${normalizedSlug}.zip`;

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
      lock.skills[normalizedSlug] = {
        name: normalizedSlug,
        zip_url: usedUrl,
        source: "skillhub",
        version: "",
        installed_at: new Date().toISOString(),
      };
      saveLockfile(lock);

      fs.rmSync(tmpDir, { recursive: true, force: true });

      return {
        success: true,
        message: `技能 ${normalizedSlug} 安装成功`,
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
      installingSkills.delete(normalizedSlug);
    }
  }

  function readSkillMetadata(skillDir, fallbackSlug = "") {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      return {
        description: "",
        requiresApi: false,
        skillName: fallbackSlug,
        entryKey: fallbackSlug,
      };
    }

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const skillName = extractFrontmatterValue(frontmatter, "name") || fallbackSlug;
      const entryKey = extractSkillEntryKey(frontmatter) || skillName || fallbackSlug;

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

      return {
        description,
        requiresApi,
        skillName,
        entryKey,
      };
    } catch (err) {
      return {
        description: "",
        requiresApi: false,
        skillName: fallbackSlug,
        entryKey: fallbackSlug,
      };
    }
  }

  function listBuiltinSkills(entryConfigMap) {
    if (!fs.existsSync(BUILTIN_SKILLS_DIR)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => {
          const skillDir = path.join(BUILTIN_SKILLS_DIR, e.name);
          const metadata = readSkillMetadata(skillDir, e.name);
          const entryKey = metadata.entryKey || e.name;

          return {
            slug: e.name,
            name: metadata.skillName || e.name,
            version: "",
            source: "builtin",
            installed_at: "",
            exists: true,
            location: "builtin",
            description: metadata.description,
            requiresApi: metadata.requiresApi,
            entryKey,
            enabled: getSkillEnabledState(entryConfigMap, entryKey),
          };
        });
    } catch (err) {
      return [];
    }
  }

  async function list() {
    try {
      const lock = loadLockfile();
      const entryConfigMap = loadSkillEntriesConfigSafe();
      const userSkills = Object.entries(lock.skills || {}).map(([slug, meta]) => {
        const safeMeta =
          meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
        const skillDir = path.join(SKILLS_DIR, slug);
        const exists = fs.existsSync(skillDir);
        const metadata = exists
          ? readSkillMetadata(skillDir, safeMeta.name || slug)
          : {
              description: "",
              requiresApi: false,
              skillName: safeMeta.name || slug,
              entryKey: safeMeta.name || slug,
            };
        const entryKey = metadata.entryKey || safeMeta.name || slug;

        return {
          slug,
          name: metadata.skillName || safeMeta.name || slug,
          version: safeMeta.version || "",
          source: safeMeta.source || "unknown",
          installed_at: safeMeta.installed_at || "",
          exists,
          location: "user",
          description: metadata.description,
          requiresApi: metadata.requiresApi,
          entryKey,
          enabled: getSkillEnabledState(entryConfigMap, entryKey),
        };
      });

      const builtinSkills = listBuiltinSkills(entryConfigMap);

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
    const normalizedSlug = String(slug || "").trim();
    if (!isValidSkillSlug(normalizedSlug)) {
      return {
        success: false,
        error: "无效的技能名称格式",
      };
    }

    const targetDir = path.join(SKILLS_DIR, normalizedSlug);

    try {
      if (!fs.existsSync(targetDir)) {
        return {
          success: false,
          error: `技能 ${normalizedSlug} 未安装`,
        };
      }

      fs.rmSync(targetDir, { recursive: true, force: true });

      const lock = loadLockfile();
      delete lock.skills[normalizedSlug];
      saveLockfile(lock);

      return {
        success: true,
        message: `技能 ${normalizedSlug} 已卸载`,
      };
    } catch (err) {
      return {
        success: false,
        error: `卸载失败: ${err.message}`,
      };
    }
  }

  async function toggle(slug, enabled, options = {}) {
    const normalizedSlug = String(slug || "").trim();
    const normalizedEntryKey = String(options.entryKey || "").trim();
    const normalizedLocation = String(options.location || "").trim();

    if (!isValidSkillSlug(normalizedSlug)) {
      return {
        success: false,
        error: "无效的技能名称格式",
      };
    }

    if (typeof enabled !== "boolean") {
      return {
        success: false,
        error: "enabled 必须是布尔值",
      };
    }

    const skillRecord = resolveSkillRecord(normalizedSlug, normalizedLocation);
    if (!skillRecord) {
      return {
        success: false,
        error: `未找到技能 ${normalizedSlug}`,
      };
    }

    const entryKey = normalizedEntryKey || skillRecord.entryKey || normalizedSlug;
    if (!isValidSkillEntryKey(entryKey)) {
      return {
        success: false,
        error: "无效的技能配置键（skillKey）",
      };
    }

    try {
      const config = loadConfigForWrite();
      const entries = ensureSkillsEntries(config);

      const existingEntry =
        entries[entryKey] &&
        typeof entries[entryKey] === "object" &&
        !Array.isArray(entries[entryKey])
          ? { ...entries[entryKey] }
          : {};

      if (enabled) {
        delete existingEntry.enabled;
        if (Object.keys(existingEntry).length === 0) {
          delete entries[entryKey];
        } else {
          entries[entryKey] = existingEntry;
        }
      } else {
        existingEntry.enabled = false;
        entries[entryKey] = existingEntry;
      }

      saveConfig(config);

      return {
        success: true,
        message: enabled
          ? `技能 ${normalizedSlug} 已启用`
          : `技能 ${normalizedSlug} 已禁用`,
        slug: normalizedSlug,
        entryKey,
        enabled,
      };
    } catch (err) {
      return {
        success: false,
        error: `更新技能状态失败: ${err.message}`,
      };
    }
  }

  async function update(slug) {
    const normalizedSlug = String(slug || "").trim();
    if (!isValidSkillSlug(normalizedSlug)) {
      return {
        success: false,
        error: "无效的技能名称格式",
      };
    }

    const lock = loadLockfile();
    if (!lock.skills[normalizedSlug]) {
      return {
        success: false,
        error: `技能 ${normalizedSlug} 不是用户安装技能，无法更新`,
      };
    }

    return install(normalizedSlug, true);
  }

  async function updateAll() {
    const lock = loadLockfile();
    const userSkillSlugs = Object.keys(lock.skills || {});

    if (userSkillSlugs.length === 0) {
      return {
        success: true,
        message: "暂无可更新的用户技能",
        updated: 0,
        failed: 0,
        results: [],
      };
    }

    const results = [];
    for (const slug of userSkillSlugs) {
      // 顺序更新可避免并发安装争用 unzip / 目录覆盖。
      // eslint-disable-next-line no-await-in-loop
      const result = await install(slug, true);
      results.push({
        slug,
        success: !!result?.success,
        error: result?.success ? "" : (result?.error || "未知错误"),
      });
    }

    const failed = results.filter(item => !item.success);
    const updated = results.length - failed.length;

    return {
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `已完成更新，共 ${updated} 个技能`
          : `更新完成：成功 ${updated} 个，失败 ${failed.length} 个`,
      updated,
      failed: failed.length,
      results,
    };
  }

  return {
    search,
    install,
    list,
    uninstall,
    toggle,
    update,
    updateAll,
  };
}

module.exports = {
  createSkillsService,
};
