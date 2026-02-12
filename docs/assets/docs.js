(function () {
  'use strict';

  // Theme Management
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('agent-docs-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = storedTheme || (prefersDark ? 'dark' : 'light');
  root.setAttribute('data-theme', initialTheme);

  // Theme Toggle
  const themeBtn = document.getElementById('theme-toggle');
  const iconLight = document.querySelector('.theme-icon-light');
  const iconDark = document.querySelector('.theme-icon-dark');

  function updateThemeIcons(theme) {
    if (iconLight && iconDark) {
      if (theme === 'dark') {
        iconLight.style.display = 'block';
        iconDark.style.display = 'none';
      } else {
        iconLight.style.display = 'none';
        iconDark.style.display = 'block';
      }
    }
  }

  // Set initial icons
  updateThemeIcons(initialTheme);

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const current = root.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('agent-docs-theme', next);
      updateThemeIcons(next);
    });
  }

  // Listen for system theme changes (if no manual preference set)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem('agent-docs-theme')) {
      const newTheme = e.matches ? 'dark' : 'light';
      root.setAttribute('data-theme', newTheme);
      updateThemeIcons(newTheme);
    }
  });

  // Mobile Navigation
  const navBtn = document.getElementById('nav-toggle');
  const sidebar = document.querySelector('.sidebar');
  const closeBtn = document.querySelector('.sidebar-close');

  if (navBtn) {
    navBtn.addEventListener('click', function () {
      const isOpen = document.body.classList.toggle('nav-open');
      navBtn.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // Close button functionality
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
      if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Close sidebar when clicking outside
  document.addEventListener('click', function (event) {
    if (!document.body.classList.contains('nav-open')) return;
    if (!sidebar) return;
    const withinSidebar = sidebar.contains(event.target);
    const clickedToggle = navBtn && navBtn.contains(event.target);
    if (!withinSidebar && !clickedToggle) {
      document.body.classList.remove('nav-open');
      if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Close sidebar on Escape
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      document.body.classList.remove('nav-open');
      if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Close sidebar when clicking nav links (mobile)
  const sidebarLinks = document.querySelectorAll('.sidebar .nav a');
  sidebarLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
      if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    });
  });

  // Language Switch
  const langSwitch = document.getElementById('lang-switch');
  if (langSwitch) {
    langSwitch.addEventListener('change', function (event) {
      const href = event.target.value;
      if (href) {
        window.location.href = href;
      }
    });
  }

  // Copy to Clipboard for Code Blocks
  function addCopyButtons() {
    const codeBlocks = document.querySelectorAll('pre');

    codeBlocks.forEach(function (pre) {
      // Skip if already has copy button
      if (pre.querySelector('.copy-btn')) return;

      const button = document.createElement('button');
      button.className = 'copy-btn';
      button.setAttribute('aria-label', 'Copy code to clipboard');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy</span>
      `;

      button.addEventListener('click', async function () {
        const code = pre.querySelector('code');
        const text = code ? code.textContent : pre.textContent;

        try {
          await navigator.clipboard.writeText(text);

          // Visual feedback
          button.classList.add('copied');
          button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Copied!</span>
          `;

          setTimeout(function () {
            button.classList.remove('copied');
            button.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
          button.textContent = 'Failed';
          setTimeout(function () {
            button.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            `;
          }, 2000);
        }
      });

      pre.appendChild(button);
    });
  }

  // Scroll Spy for Table of Contents
  function initScrollSpy() {
    const toc = document.querySelector('.toc');
    if (!toc) return;

    const tocLinks = toc.querySelectorAll('a');
    const headings = document.querySelectorAll('.article h1, .article h2, .article h3, .article h4');

    if (headings.length === 0 || tocLinks.length === 0) return;

    // Create intersection observer
    const observerOptions = {
      root: null,
      rootMargin: '-20% 0px -70% 0px',
      threshold: 0
    };

    let activeHeading = null;

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          activeHeading = entry.target;
          updateActiveLink(activeHeading.id);
        }
      });
    }, observerOptions);

    headings.forEach(function (heading) {
      if (heading.id) {
        observer.observe(heading);
      }
    });

    function updateActiveLink(id) {
      tocLinks.forEach(function (link) {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + id) {
          link.classList.add('active');
        }
      });
    }

    // Fallback: Update on scroll for browsers without IntersectionObserver
    if (!window.IntersectionObserver) {
      window.addEventListener('scroll', function () {
        const scrollPos = window.scrollY + window.innerHeight / 3;

        headings.forEach(function (heading) {
          if (heading.id) {
            const top = heading.offsetTop;
            const bottom = top + heading.offsetHeight;

            if (scrollPos >= top && scrollPos < bottom) {
              updateActiveLink(heading.id);
            }
          }
        });
      });
    }

    // Smooth scroll for TOC links
    tocLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          const target = document.querySelector(href);
          if (target) {
            target.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
            // Update URL without jumping
            history.pushState(null, null, href);
          }
        }
      });
    });
  }

  // Initialize everything
  addCopyButtons();
  initScrollSpy();

  // Re-initialize copy buttons if content changes (for dynamic content)
  window.addCopyButtons = addCopyButtons;
})();
