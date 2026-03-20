// Skills tab actions and rendering

(function attachSkillsModule(global) {
  const installedSkillSlugs = new Set();

  function toast(message, type = "info") {
    if (typeof global.showToast === "function") {
      global.showToast(message, type);
    }
  }

  function request(endpoint, options) {
    if (typeof global.apiRequest !== "function") {
      throw new Error("apiRequest is not ready");
    }
    return global.apiRequest(endpoint, options);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function normalizeSkillSlug(slug) {
    return String(slug || "").trim().toLowerCase();
  }

  function normalizeSkillLabel(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  function isSkillInstalled(slug) {
    return installedSkillSlugs.has(normalizeSkillSlug(slug));
  }

  function syncInstalledSkillSlugs(skills = []) {
    installedSkillSlugs.clear();
    for (const skill of skills) {
      if (skill?.location !== "user" || skill?.exists !== true) {
        continue;
      }
      const normalized = normalizeSkillSlug(skill.slug);
      if (normalized) {
        installedSkillSlugs.add(normalized);
      }
    }
  }

  async function refreshInstalledSkillSlugs() {
    try {
      const result = await request("/skills/list");
      if (result?.success && Array.isArray(result.skills)) {
        syncInstalledSkillSlugs(result.skills);
      }
    } catch (err) {
      console.warn("获取已安装技能列表失败:", err);
    }
  }

  function updateSearchInstallButtons() {
    const container = document.getElementById("skills-search-results");
    if (!container) return;

    container.querySelectorAll('button[data-action="install"]').forEach((btn) => {
      const installed = isSkillInstalled(btn.dataset.slug);
      btn.disabled = installed;
      btn.textContent = installed ? "已安装" : "安装";
      btn.classList.toggle("btn-primary", !installed);
      btn.classList.toggle("btn-ghost", installed);
      btn.setAttribute("aria-disabled", installed ? "true" : "false");
    });
  }

  function renderSkillCard(skill) {
    const isBuiltin = skill.location === "builtin";
    const requiresApi = skill.requiresApi || false;
    const enabled = skill.enabled !== false;
    const entryKey = skill.entryKey || skill.name || skill.slug;
    const showsEntryKey = entryKey && entryKey !== skill.slug;
    const showsSlug =
      !!skill.slug &&
      normalizeSkillLabel(skill.slug) !== normalizeSkillLabel(skill.name);

    return `
      <div class="skill-card" data-slug="${escapeHtml(skill.slug)}">
          <div class="skill-card-header">
            <h4 class="skill-card-title">${escapeHtml(skill.name)}</h4>
            <div class="skill-badges">
              ${isBuiltin ? '<span class="skill-badge builtin">内置</span>' : '<span class="skill-badge user">用户</span>'}
              ${requiresApi ? '<span class="skill-badge api-required">需要 API</span>' : ""}
              ${!skill.exists ? '<span class="skill-badge missing">缺失</span>' : ""}
            </div>
          </div>

        <div class="skill-card-meta">
          ${showsSlug ? `<div class="skill-card-slug">${escapeHtml(skill.slug)}</div>` : ""}
          ${showsEntryKey ? `<div class="card-meta-line">skillKey: <code>${escapeHtml(entryKey)}</code></div>` : ""}
          ${skill.description ? `<p class="skill-card-description">${escapeHtml(skill.description)}</p>` : ""}
          ${skill.version ? `<div class="card-meta-line">版本: ${escapeHtml(skill.version)}</div>` : ""}
          ${skill.installed_at ? `<div class="card-meta-line">安装时间: ${new Date(skill.installed_at).toLocaleDateString("zh-CN")}</div>` : ""}
        </div>

        <div class="skill-card-footer">
          <div class="skill-toggle">
            <span class="skill-toggle-status ${enabled ? "enabled" : "disabled"}">
              ${enabled ? "已启用" : "已禁用"}
            </span>
            <button
              class="toggle-switch ${enabled ? "active" : ""}"
              data-action="toggle-skill"
              data-slug="${escapeHtml(skill.slug)}"
              data-entry-key="${escapeHtml(entryKey)}"
              data-location="${escapeHtml(skill.location || "")}"
              data-enabled="${enabled ? "true" : "false"}"
              title="${enabled ? "点击禁用技能" : "点击启用技能"}"
              aria-label="${enabled ? "禁用技能" : "启用技能"}"
              aria-pressed="${enabled ? "true" : "false"}"
              type="button"
            ></button>
          </div>
          ${isBuiltin
      ? '<span style="font-size: 0.85rem; color: var(--text-light);">内置技能</span>'
      : `
            <div class="skill-actions">
              <button class="btn btn-secondary btn-sm" data-action="update-skill" data-slug="${escapeHtml(skill.slug)}">更新</button>
              <button class="btn btn-danger btn-sm" data-action="uninstall" data-slug="${escapeHtml(skill.slug)}">卸载</button>
            </div>
          `}
        </div>
      </div>
    `;
  }

  async function toggleSkillStatus(slug, enabled, entryKey, location) {
    try {
      const result = await request("/skills/toggle", {
        method: "POST",
        body: JSON.stringify({
          slug,
          enabled,
          entryKey,
          location,
        }),
      });
      if (result.success) {
        toast(result.message || `技能 ${slug} 状态已更新`, "success");
        await loadInstalledSkills();
      } else {
        toast(result.error || "更新技能状态失败", "error");
      }
    } catch (err) {
      toast(`更新技能状态失败: ${err.message}`, "error");
    }
  }

  async function updateSkill(slug) {
    try {
      toast(`正在更新技能 ${slug}...`, "info");
      const result = await request("/skills/update", {
        method: "POST",
        body: JSON.stringify({ slug }),
      });
      if (result.success) {
        toast(result.message || `技能 ${slug} 更新成功`, "success");
        await loadInstalledSkills();
      } else {
        toast(result.error || `技能 ${slug} 更新失败`, "error");
      }
    } catch (err) {
      toast(`更新失败: ${err.message}`, "error");
    }
  }

  async function updateAllSkills() {
    if (!confirm("确定要更新全部用户技能吗？")) {
      return;
    }

    try {
      toast("正在更新全部用户技能...", "info");
      const result = await request("/skills/update", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });

      if (result.success) {
        toast(result.message || "全部用户技能更新完成", "success");
      } else {
        toast(result.message || result.error || "部分技能更新失败", "warning");
      }
      await loadInstalledSkills();
    } catch (err) {
      toast(`批量更新失败: ${err.message}`, "error");
    }
  }

  async function uninstallSkill(slug) {
    if (!confirm(`确定要卸载技能 ${slug} 吗？`)) return;

    try {
      const result = await request("/skills/uninstall", {
        method: "POST",
        body: JSON.stringify({ slug }),
      });
      if (result.success) {
        toast(result.message || `技能 ${slug} 已卸载`, "success");
        await loadInstalledSkills();
      } else {
        toast(result.error || "卸载失败", "error");
      }
    } catch (err) {
      toast(`卸载失败: ${err.message}`, "error");
    }
  }

  function bindSkillCardEvents() {
    const updateAllBtn = document.getElementById("skills-update-all-btn");
    if (updateAllBtn) {
      updateAllBtn.addEventListener("click", updateAllSkills);
    }

    document.querySelectorAll('[data-action="toggle-skill"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.disabled) {
          return;
        }
        const currentlyEnabled = btn.dataset.enabled === "true";
        btn.disabled = true;
        try {
          await toggleSkillStatus(
            btn.dataset.slug,
            !currentlyEnabled,
            btn.dataset.entryKey,
            btn.dataset.location,
          );
        } finally {
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-action="update-skill"]').forEach((btn) => {
      btn.addEventListener("click", () => updateSkill(btn.dataset.slug));
    });

    document.querySelectorAll('[data-action="uninstall"]').forEach((btn) => {
      btn.addEventListener("click", () => uninstallSkill(btn.dataset.slug));
    });
  }

  async function loadInstalledSkills() {
    try {
      const result = await request("/skills/list");
      const container = document.getElementById("skills-installed-list");
      const skillsList = Array.isArray(result?.skills) ? result.skills : [];
      syncInstalledSkillSlugs(skillsList);
      updateSearchInstallButtons();

      if (!result.success || skillsList.length === 0) {
        container.innerHTML = '<p class="empty-state">暂无已安装技能</p>';
        return;
      }

      const userSkills = skillsList.filter((s) => s.location === "user");
      const builtinSkills = skillsList.filter((s) => s.location === "builtin");

      let html = "";

      if (userSkills.length > 0) {
        html += `
          <div class="skills-section-header">
            <h3>用户安装的技能</h3>
            <button id="skills-update-all-btn" class="btn btn-secondary btn-sm">更新全部用户技能</button>
          </div>
        `;
        html += '<div class="skills-grid">';
        html += userSkills.map((skill) => renderSkillCard(skill)).join("");
        html += "</div>";
      }

      if (builtinSkills.length > 0) {
        html += `
          <div class="skills-section-header skills-section-header-spaced">
            <h3>内置技能</h3>
          </div>
        `;
        html += '<div class="skills-grid">';
        html += builtinSkills.map((skill) => renderSkillCard(skill)).join("");
        html += "</div>";
      }

      container.innerHTML = html;
      bindSkillCardEvents();
    } catch (err) {
      toast(`加载失败: ${err.message}`, "error");
    }
  }

  async function installSkill(slug, force = false) {
    try {
      const result = await request("/skills/install", {
        method: "POST",
        body: JSON.stringify({ slug, force }),
      });
      if (result.success) {
        installedSkillSlugs.add(normalizeSkillSlug(slug));
        updateSearchInstallButtons();
        toast(result.message || `技能 ${slug} 安装成功`, "success");
        await loadInstalledSkills();
      } else {
        if (String(result.error || "").includes("已安装")) {
          installedSkillSlugs.add(normalizeSkillSlug(slug));
          updateSearchInstallButtons();
        }
        toast(result.error || "安装失败", "error");
      }
    } catch (err) {
      toast(`安装失败: ${err.message}`, "error");
    }
  }

  async function searchSkills() {
    const query = document.getElementById("skills-search-input").value.trim();
    if (!query) {
      toast("请输入搜索关键词", "warning");
      return;
    }

    try {
      const [result] = await Promise.all([
        request(`/skills/search?q=${encodeURIComponent(query)}`),
        refreshInstalledSkillSlugs(),
      ]);
      const container = document.getElementById("skills-search-results");

      if (!result.success || !result.skills || result.skills.length === 0) {
        container.innerHTML = '<p class="empty-state">未找到相关技能</p>';
        return;
      }

      container.innerHTML = `<div class="skills-grid">${result.skills
        .map((skill) => {
          const displayName = skill.displayName || skill.name || skill.slug;
          const summary = skill.summary || skill.description || "";
          const version = skill.version || "";
          const updatedAt = skill.updatedAt
            ? new Date(skill.updatedAt).toLocaleDateString("zh-CN")
            : "";
          const score = skill.score ? Math.min(100, Math.round(skill.score * 500)) : 0;
          const installed = isSkillInstalled(skill.slug);

          return `
            <div class="skill-card">
              <div class="skill-card-header">
                <h4 class="skill-card-title">${escapeHtml(displayName)}</h4>
                ${score > 0 ? `<div class="skill-badges"><span class="skill-badge" style="background: var(--success); color: white;">${score}% 匹配</span></div>` : ""}
              </div>

              <div class="skill-card-meta">
                <div class="skill-card-slug">${escapeHtml(skill.slug)}</div>
                ${summary ? `<p class="skill-card-description">${escapeHtml(summary)}</p>` : ""}
                <div class="skill-card-stats">
                  ${version ? `<span class="skill-card-stat">v${escapeHtml(version)}</span>` : ""}
                  ${updatedAt ? `<span class="skill-card-stat">更新于 ${updatedAt}</span>` : ""}
                </div>
              </div>

              <div class="skill-card-footer">
                <button class="btn ${installed ? "btn-ghost" : "btn-primary"} btn-sm" data-slug="${escapeHtml(skill.slug)}" data-action="install" style="width: 100%;" ${installed ? "disabled aria-disabled=\"true\"" : ""}>${installed ? "已安装" : "安装"}</button>
              </div>
            </div>
          `;
        })
        .join("")}</div>`;

      container.querySelectorAll('button[data-action="install"]').forEach((btn) => {
        btn.addEventListener("click", () => installSkill(btn.dataset.slug));
      });
    } catch (err) {
      toast(`搜索失败: ${err.message}`, "error");
    }
  }

  global.skillsManager = {
    searchSkills,
    loadInstalledSkills,
    refreshInstalledSkillSlugs,
    updateSearchInstallButtons,
  };
})(window);
