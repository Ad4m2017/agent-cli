(function () {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem("agent-docs-theme") || "dark";
  root.setAttribute("data-theme", storedTheme);

  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      const current = root.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("agent-docs-theme", next);
    });
  }

  const navBtn = document.getElementById("nav-toggle");
  if (navBtn) {
    navBtn.addEventListener("click", function () {
      const next = !document.body.classList.contains("nav-open");
      document.body.classList.toggle("nav-open", next);
      navBtn.setAttribute("aria-expanded", String(next));
    });
  }

  const langSwitch = document.getElementById("lang-switch");
  if (langSwitch) {
    langSwitch.addEventListener("change", function (event) {
      const href = event.target.value;
      if (href) {
        window.location.href = href;
      }
    });
  }

  document.addEventListener("click", function (event) {
    if (!document.body.classList.contains("nav-open")) return;
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    const withinSidebar = sidebar.contains(event.target);
    const clickedToggle = navBtn && navBtn.contains(event.target);
    if (!withinSidebar && !clickedToggle) {
      document.body.classList.remove("nav-open");
      if (navBtn) navBtn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
      document.body.classList.remove("nav-open");
      if (navBtn) navBtn.setAttribute("aria-expanded", "false");
    }
  });

  const sidebarLinks = document.querySelectorAll(".sidebar .nav a");
  sidebarLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      document.body.classList.remove("nav-open");
      if (navBtn) navBtn.setAttribute("aria-expanded", "false");
    });
  });
})();
