#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const docsDir = path.join(root, "docs");
const contentDir = path.join(docsDir, "content");

const pages = [
  { slug: "index", source: "get-started.md", titles: { en: "Get Started", de: "Einstieg" } },
  { slug: "api-examples", source: "api-examples.md", titles: { en: "Scripts", de: "Skripte" } },
  { slug: "config-reference", source: "config-reference.md", titles: { en: "Config", de: "Konfiguration" } },
];

const languages = [
  { code: "en", label: "English", flag: "🇺🇸", dir: "", default: true },
  { code: "de", label: "Deutsch", flag: "🇩🇪", dir: "de", default: false },
];

function escapeHtml(input) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function inlineFormat(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const toc = [];
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.replace(/```/, "").trim();
      i += 1;
      const block = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      html.push(`<pre><code class="language-${escapeHtml(lang || "text")}">${escapeHtml(block.join("\n"))}</code></pre>`);
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      if (level >= 2) toc.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inlineFormat(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${inlineFormat(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${inlineFormat(item)}</li>`).join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "") {
      if (/^(#{1,3})\s+/.test(lines[i]) || /^```/.test(lines[i]) || /^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i])) {
        break;
      }
      para.push(lines[i]);
      i += 1;
    }
    html.push(`<p>${inlineFormat(para.join(" "))}</p>`);
  }

  return { html: html.join("\n"), toc };
}

function localizedPageTitle(page, langCode) {
  return page.titles[langCode] || page.titles.en || page.slug;
}

function pageHref(currentLang, page) {
  const fileName = page.slug === "index" ? "index.html" : `${page.slug}.html`;
  return currentLang.default ? `./${fileName}` : `./${fileName}`;
}

function languageHref(currentLang, targetLang, page) {
  const fileName = page.slug === "index" ? "index.html" : `${page.slug}.html`;
  if (currentLang.default) {
    if (targetLang.default) return `./${fileName}`;
    return `./${targetLang.dir}/${fileName}`;
  }

  if (targetLang.default) return `../${fileName}`;
  if (targetLang.code === currentLang.code) return `./${fileName}`;
  return `../${targetLang.dir}/${fileName}`;
}

function renderPage({ page, bodyHtml, pageToc, lang }) {
  const nav = pages
    .map((p) => {
      const href = pageHref(lang, p);
      const cls = p.slug === page.slug ? "active" : "";
      return `<a class="${cls}" href="${href}">${escapeHtml(localizedPageTitle(p, lang.code))}</a>`;
    })
    .join("\n");

  const tocHtml = pageToc
    .map((item) => {
      const cls = item.level === 3 ? ' class="sub-item"' : "";
      return `<a${cls} href="#${item.id}">${escapeHtml(item.text)}</a>`;
    })
    .join("\n");

  const langOptions = languages
    .map((l) => {
      const href = languageHref(lang, l, page);
      const selected = l.code === lang.code ? " selected" : "";
      return `<option value="${href}"${selected}>${escapeHtml(`${l.flag} ${l.label}`)}</option>`;
    })
    .join("\n");

  const title = localizedPageTitle(page, lang.code);
  const subtitle =
    lang.code === "de"
      ? "Dokumentation im modernen Layout fuer CLI-Workflows."
      : "Documentation in a modern docs layout for CLI workflows.";

  const cssHref = lang.default ? "./assets/docs.css" : "../assets/docs.css";
  const jsHref = lang.default ? "./assets/docs.js" : "../assets/docs.js";

  return `<!doctype html>
<html lang="${lang.code}" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Agent CLI Docs</title>
    <link rel="stylesheet" href="${cssHref}" />
  </head>
  <body>
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">Agent CLI Docs</div>
        <p class="hint">Minimal + professional terminal agent</p>
        <nav class="nav">${nav}</nav>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <h1 class="title">${escapeHtml(title)}</h1>
            <p class="subtitle">${escapeHtml(subtitle)}</p>
          </div>
          <div class="controls">
            <button id="nav-toggle" class="mobile-toggle">Menu</button>
            <button id="theme-toggle" aria-label="Toggle Theme"><svg id="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg id="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg></button>
            <select id="lang-switch" class="lang-select" aria-label="Select language">
              ${langOptions}
            </select>
          </div>
        </div>
        <article class="article">
${bodyHtml}
        </article>
      </main>
      <aside class="right">
        <div class="toc-title">On This Page</div>
        <nav class="toc">${tocHtml}</nav>
      </aside>
    </div>
    <script src="${jsHref}"></script>
  </body>
</html>`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildLanguage(lang) {
  const langContentDir = path.join(contentDir, lang.code);
  const outputDir = lang.default ? docsDir : path.join(docsDir, lang.dir);
  ensureDir(outputDir);

  for (const page of pages) {
    const sourcePath = path.join(langContentDir, page.source);
    const raw = fs.readFileSync(sourcePath, "utf8");
    const rendered = renderMarkdown(raw);
    const output = renderPage({ page, bodyHtml: rendered.html, pageToc: rendered.toc, lang });
    const outPath = path.join(outputDir, page.slug === "index" ? "index.html" : `${page.slug}.html`);
    fs.writeFileSync(outPath, output, "utf8");
  }
}

function build() {
  for (const lang of languages) {
    buildLanguage(lang);
  }
}

build();
process.stdout.write("Docs built: EN + DE pages generated.\n");
