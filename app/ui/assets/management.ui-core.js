// UI core interactions: tabs, view switching, tooltip behavior

(function attachManagementUiCore(global) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getOrCreateTooltipPopup() {
    let popup = document.getElementById("tooltip-popup");
    if (popup) {
      return popup;
    }

    popup = document.createElement("div");
    popup.id = "tooltip-popup";
    popup.className = "tooltip-popup";
    popup.setAttribute("role", "tooltip");
    popup.dataset.placement = "top";
    document.body.appendChild(popup);
    return popup;
  }

  function positionTooltipPopup(target, popup) {
    if (!target || !popup) return;

    const margin = 8;
    const gap = 10;
    const rect = target.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = rect.left;
    left = clamp(
      left,
      margin,
      Math.max(margin, viewportWidth - popupRect.width - margin),
    );

    let top = rect.top - popupRect.height - gap;
    let placement = "top";

    if (top < margin) {
      top = rect.bottom + gap;
      placement = "bottom";
    }

    if (top + popupRect.height > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - popupRect.height - margin);
    }

    const anchorX = clamp(
      rect.left + rect.width / 2,
      left + 12,
      left + popupRect.width - 12,
    );

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
    popup.dataset.placement = placement;
    popup.style.setProperty(
      "--tooltip-arrow-left",
      `${Math.round(anchorX - left)}px`,
    );
  }

  function showTooltip(target) {
    const text = target?.getAttribute("data-tooltip")?.trim();
    if (!text) return;

    const popup = getOrCreateTooltipPopup();
    popup.textContent = text;
    popup.style.left = "0px";
    popup.style.top = "-9999px";
    popup.classList.add("visible");
    activeTooltipTarget = target;

    requestAnimationFrame(() => {
      positionTooltipPopup(target, popup);
    });
  }

  function hideTooltip(target = null) {
    if (target && activeTooltipTarget && target !== activeTooltipTarget) {
      return;
    }

    const popup = document.getElementById("tooltip-popup");
    if (popup) {
      popup.classList.remove("visible");
    }
    activeTooltipTarget = null;
  }

  function refreshTooltipPosition() {
    if (!activeTooltipTarget) return;
    const popup = document.getElementById("tooltip-popup");
    if (!popup || !popup.classList.contains("visible")) return;
    positionTooltipPopup(activeTooltipTarget, popup);
  }

  function initTooltips() {
    const icons = document.querySelectorAll(".tooltip-icon[data-tooltip]");

    icons.forEach((icon) => {
      if (!icon.hasAttribute("tabindex")) {
        icon.setAttribute("tabindex", "0");
      }
      if (!icon.hasAttribute("aria-label")) {
        icon.setAttribute("aria-label", "查看说明");
      }

      icon.addEventListener("mouseenter", () => showTooltip(icon));
      icon.addEventListener("mouseleave", () => hideTooltip(icon));
      icon.addEventListener("focus", () => showTooltip(icon));
      icon.addEventListener("blur", () => hideTooltip(icon));
      icon.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTooltipTarget === icon) {
          hideTooltip(icon);
        } else {
          showTooltip(icon);
        }
      });
      icon.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (activeTooltipTarget === icon) {
          hideTooltip(icon);
        } else {
          showTooltip(icon);
        }
      });
    });

    window.addEventListener("resize", refreshTooltipPosition);
    document.addEventListener("scroll", refreshTooltipPosition, true);
    document.addEventListener("pointerdown", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        hideTooltip();
        return;
      }

      if (target.closest(".tooltip-icon")) {
        return;
      }

      const popup = document.getElementById("tooltip-popup");
      if (popup && popup.contains(target)) {
        return;
      }

      hideTooltip();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideTooltip();
      }
    });
  }

  function setConfigViewMode(mode) {
    const splitView = document.getElementById("config-split-view");
    const modelPanel = document.getElementById("config-model-panel");
    const channelPanel = document.getElementById("config-channel-panel");
    const editorCard = document.getElementById("config-editor-card");
    const templateCard = document.getElementById("config-template-card");

    if (
      !splitView ||
      !modelPanel ||
      !channelPanel ||
      !editorCard ||
      !templateCard
    ) {
      return;
    }

    if (mode === "models") {
      splitView.style.display = "block";
      modelPanel.style.display = "flex";
      channelPanel.style.display = "none";
      editorCard.style.display = "none";
      templateCard.style.display = "none";
      return;
    }

    if (mode === "channels") {
      splitView.style.display = "block";
      modelPanel.style.display = "none";
      channelPanel.style.display = "flex";
      editorCard.style.display = "none";
      templateCard.style.display = "none";
      return;
    }

    splitView.style.display = "none";
    modelPanel.style.display = "flex";
    channelPanel.style.display = "flex";
    editorCard.style.display = "block";
    templateCard.style.display = "block";
  }

  function loadTabData(tabName) {
    switch (tabName) {
      case "overview":
        global.refreshDashboard();
        global.refreshLogs();
        break;
      case "models":
        setConfigViewMode("models");
        global.renderQuickAddButtons();
        global.loadModelsList();
        break;
      case "channels":
        setConfigViewMode("channels");
        global.loadChannelsList();
        break;
      case "config":
        setConfigViewMode("config");
        global.loadConfig();
        break;
      case "skills":
        global.skillsManager?.loadInstalledSkills();
        break;
      case "system":
        global.loadToolProfiles();
        global.loadManagementAccessSettings();
        global.loadApiKeyProtectionSettings();
        global.loadVersionInfo();
        global.loadConsoleInfo();
        break;
    }
  }

  function initTabs() {
    const tabsNav = document.querySelector(".tabs");
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    const tabSectionMap = {
      overview: ["tab-dashboard"],
      models: ["tab-config"],
      channels: ["tab-config"],
      config: ["tab-config"],
      skills: ["tab-skills"],
      system: ["tab-version", "tab-console"],
    };

    if (tabsNav) {
      tabsNav.setAttribute("role", "tablist");
      tabsNav.setAttribute("aria-label", "主导航标签");
    }

    tabContents.forEach((content) => {
      content.setAttribute("role", "tabpanel");
      content.setAttribute("hidden", "hidden");
    });

    const switchTab = (tabName, activeBtn) => {
      currentTabName = tabName;

      tabBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
        b.setAttribute("tabindex", "-1");
      });
      if (activeBtn) {
        activeBtn.classList.add("active");
        activeBtn.setAttribute("aria-selected", "true");
        activeBtn.setAttribute("tabindex", "0");
      }

      tabContents.forEach((content) => {
        content.classList.remove("active");
        content.setAttribute("hidden", "hidden");
      });

      const targetSectionIds = tabSectionMap[tabName] || [];
      targetSectionIds.forEach((sectionId) => {
        const section = document.getElementById(sectionId);
        if (section) {
          section.classList.add("active");
          section.removeAttribute("hidden");
          if (activeBtn?.id) {
            section.setAttribute("aria-labelledby", activeBtn.id);
          }
        }
      });

      loadTabData(tabName);
    };

    tabBtns.forEach((btn, index) => {
      const tabName = btn.dataset.tab || `tab-${index}`;
      const controls = tabSectionMap[tabName]?.[0] || "tab-dashboard";

      btn.setAttribute("role", "tab");
      btn.setAttribute("id", `main-tab-${tabName}`);
      btn.setAttribute("aria-controls", controls);
      btn.setAttribute("aria-selected", "false");
      btn.setAttribute("tabindex", "-1");

      btn.addEventListener("click", () => {
        const clickedTabName = btn.dataset.tab;
        switchTab(clickedTabName, btn);
      });

      btn.addEventListener("keydown", (e) => {
        const key = e.key;
        const isPrev = key === "ArrowLeft" || key === "ArrowUp";
        const isNext = key === "ArrowRight" || key === "ArrowDown";

        if (!isPrev && !isNext && key !== "Home" && key !== "End") {
          return;
        }

        e.preventDefault();

        const list = Array.from(tabBtns);
        const currentIndex = list.indexOf(btn);
        if (currentIndex < 0) return;

        let nextIndex = currentIndex;
        if (key === "Home") {
          nextIndex = 0;
        } else if (key === "End") {
          nextIndex = list.length - 1;
        } else if (isPrev) {
          nextIndex = (currentIndex - 1 + list.length) % list.length;
        } else if (isNext) {
          nextIndex = (currentIndex + 1) % list.length;
        }

        const targetBtn = list[nextIndex];
        if (!targetBtn) return;
        const targetTabName = targetBtn.dataset.tab;
        switchTab(targetTabName, targetBtn);
        targetBtn.focus();
      });
    });

    const initialActiveBtn = document.querySelector(".tab-btn.active");
    const initialTabName = initialActiveBtn?.dataset.tab || "overview";
    switchTab(initialTabName, initialActiveBtn);
  }

  global.managementUiCore = {
    initTabs,
    initTooltips,
  };
})(window);
