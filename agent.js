#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

/**
 * Runtime constants.
 * - AGENT_CONFIG_FILE: local runtime/policy config file in project root.
 * - AUTH_CONFIG_FILE: local provider credential/config file in project root.
 * - COPILOT_REFRESH_BUFFER_MS: refresh Copilot token slightly before expiry.
 * - AGENT_VERSION: CLI version displayed via --version.
 */
const AGENT_CONFIG_FILE = path.resolve(process.cwd(), "agent.json");
const AUTH_CONFIG_FILE = path.resolve(process.cwd(), "agent.auth.json");
const COPILOT_REFRESH_BUFFER_MS = 60 * 1000;
const AGENT_VERSION = "0.6.0";
const MAX_FILE_BYTES = 200 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_IMAGES = 5;
const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Centralized error codes.
 * Every coded error thrown by agent.js references one of these constants.
 */
const ERROR_CODES = {
  AGENT_CONFIG_INVALID: "AGENT_CONFIG_INVALID",
  AGENT_CONFIG_ERROR: "AGENT_CONFIG_ERROR",
  AUTH_CONFIG_INVALID: "AUTH_CONFIG_INVALID",
  AUTH_CONFIG_ERROR: "AUTH_CONFIG_ERROR",
  ATTACHMENT_NOT_FOUND: "ATTACHMENT_NOT_FOUND",
  ATTACHMENT_UNREADABLE: "ATTACHMENT_UNREADABLE",
  ATTACHMENT_TOO_MANY_FILES: "ATTACHMENT_TOO_MANY_FILES",
  ATTACHMENT_TOO_MANY_IMAGES: "ATTACHMENT_TOO_MANY_IMAGES",
  ATTACHMENT_TOO_LARGE: "ATTACHMENT_TOO_LARGE",
  ATTACHMENT_TYPE_UNSUPPORTED: "ATTACHMENT_TYPE_UNSUPPORTED",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  VISION_NOT_SUPPORTED: "VISION_NOT_SUPPORTED",
  INTERACTIVE_APPROVAL_JSON: "INTERACTIVE_APPROVAL_JSON",
  INTERACTIVE_APPROVAL_TTY: "INTERACTIVE_APPROVAL_TTY",
  TOOLS_NOT_SUPPORTED: "TOOLS_NOT_SUPPORTED",
  RUNTIME_ERROR: "RUNTIME_ERROR",
  FETCH_TIMEOUT: "FETCH_TIMEOUT",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
};

const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const CHAT_FETCH_TIMEOUT_MS = 120000;

/**
 * Fetch wrapper with AbortController-based timeout.
 * Throws a coded FETCH_TIMEOUT error when the request exceeds timeoutMs.
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const ms = timeoutMs || DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } catch (err) {
    if (err && err.name === "AbortError") {
      const e = new Error(`Request timed out after ${ms}ms: ${url}`);
      e.code = ERROR_CODES.FETCH_TIMEOUT;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Default retry options for fetchWithRetry. */
const DEFAULT_RETRY_OPTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [500, 502, 503],
};

/**
 * Parse the Retry-After HTTP header into milliseconds.
 * Supports both delta-seconds ("120") and HTTP-date formats.
 * Returns null when the header is missing or unparseable.
 * Result is capped at maxDelayMs (default 30 000 ms).
 */
function parseRetryAfter(headerValue, maxDelayMs) {
  const cap = typeof maxDelayMs === "number" && maxDelayMs > 0 ? maxDelayMs : DEFAULT_RETRY_OPTS.maxDelayMs;
  if (headerValue == null || headerValue === "") return null;
  const str = String(headerValue).trim();
  if (str === "") return null;

  // Try delta-seconds first (e.g. "120")
  if (/^\d+$/.test(str)) {
    const ms = parseInt(str, 10) * 1000;
    return Math.min(ms, cap);
  }

  // Try HTTP-date (e.g. "Fri, 13 Feb 2026 12:00:00 GMT")
  const dateMs = Date.parse(str);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, cap);
  }

  return null;
}

/**
 * Fetch wrapper with automatic retry for transient errors.
 * Builds on top of fetchWithTimeout — retries on configurable HTTP statuses
 * (default 500/502/503), HTTP 429 (rate limit), and FETCH_TIMEOUT errors.
 *
 * Uses exponential backoff: baseDelayMs * 2^attempt (1s → 2s → 4s).
 * For HTTP 429 responses the Retry-After header is respected when present.
 *
 * @param {string} url
 * @param {object} options  - fetch options (method, headers, body, etc.)
 * @param {number} [timeoutMs] - per-attempt timeout (passed to fetchWithTimeout)
 * @param {object} [retryOpts] - { maxRetries, baseDelayMs, maxDelayMs, retryableStatuses }
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, timeoutMs, retryOpts) {
  const cfg = Object.assign({}, DEFAULT_RETRY_OPTS, retryOpts || {});
  let lastError = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);

      // Success or non-retryable status — return immediately
      if (res.ok) return res;

      // HTTP 429 — rate limited
      if (res.status === 429) {
        if (attempt >= cfg.maxRetries) return res;
        const raHeader = res.headers ? res.headers.get("retry-after") : null;
        const raMs = parseRetryAfter(raHeader, cfg.maxDelayMs);
        const delayMs = raMs != null ? raMs : Math.min(cfg.baseDelayMs * Math.pow(2, attempt), cfg.maxDelayMs);
        process.stderr.write(`Retry ${attempt + 1}/${cfg.maxRetries} after ${delayMs}ms (HTTP 429 rate limited)\n`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Retryable server error (500/502/503)
      if (cfg.retryableStatuses.indexOf(res.status) !== -1) {
        if (attempt >= cfg.maxRetries) return res;
        const delayMs = Math.min(cfg.baseDelayMs * Math.pow(2, attempt), cfg.maxDelayMs);
        process.stderr.write(`Retry ${attempt + 1}/${cfg.maxRetries} after ${delayMs}ms (HTTP ${res.status})\n`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Non-retryable HTTP error (4xx etc.) — return as-is
      return res;
    } catch (err) {
      lastError = err;

      // Retry on timeout errors
      if (err && err.code === ERROR_CODES.FETCH_TIMEOUT) {
        if (attempt >= cfg.maxRetries) break;
        const delayMs = Math.min(cfg.baseDelayMs * Math.pow(2, attempt), cfg.maxDelayMs);
        process.stderr.write(`Retry ${attempt + 1}/${cfg.maxRetries} after ${delayMs}ms (timeout)\n`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Non-retryable fetch error (network down, DNS, etc.)
      throw err;
    }
  }

  // All retries exhausted — throw coded error
  if (lastError) {
    const e = new Error(`All ${cfg.maxRetries} retries failed for ${url}: ${lastError.message}`);
    e.code = ERROR_CODES.RETRY_EXHAUSTED;
    e.cause = lastError;
    throw e;
  }

  // Should never reach here, but safety net
  const e = new Error(`All ${cfg.maxRetries} retries failed for ${url}`);
  e.code = ERROR_CODES.RETRY_EXHAUSTED;
  throw e;
}

/**
 * Parse CLI arguments into a simple options object.
 * Unknown flags are ignored to keep the parser intentionally lightweight.
 */
function parseCliArgs(argv) {
  const opts = {
    message: "",
    model: "",
    log: false,
    logFile: "agent.js.log",
    json: false,
    unsafe: false,
    mode: "",
    approval: "",
    tools: "",
    files: [],
    images: [],
    yes: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === "-m" || a === "--message") {
      opts.message = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--model") {
      opts.model = argv[i + 1] || opts.model;
      i += 1;
      continue;
    }

    if (a === "--log") {
      opts.log = true;
      continue;
    }

    if (a === "--log-file") {
      opts.logFile = argv[i + 1] || opts.logFile;
      i += 1;
      continue;
    }

    if (a === "--json") {
      opts.json = true;
      continue;
    }

    if (a === "--unsafe") {
      opts.unsafe = true;
      continue;
    }

    if (a === "--mode") {
      opts.mode = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--approval") {
      opts.approval = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--tools") {
      opts.tools = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--file") {
      const filePath = argv[i + 1] || "";
      if (filePath) opts.files.push(filePath);
      i += 1;
      continue;
    }

    if (a === "--image") {
      const imagePath = argv[i + 1] || "";
      if (imagePath) opts.images.push(imagePath);
      i += 1;
      continue;
    }

    if (a === "--no-tools") {
      opts.tools = "off";
      continue;
    }

    if (a === "--yes") {
      opts.yes = true;
      opts.approval = "auto";
      continue;
    }

    if (a === "-h" || a === "--help") {
      opts.help = true;
      continue;
    }

    if (a === "-V" || a === "--version") {
      opts.version = true;
      continue;
    }
  }

  return opts;
}

/** Print help text for the runner CLI. */
function printHelp() {
  const txt = [
    "Usage:",
    "  node agent.js -m \"your message\" [options]",
    "",
    "Options:",
    "  -m, --message <text>   Model prompt (required)",
    "  --model <name>         Model or provider/model",
    "  --json                 Output JSON with tool details",
    "  --log                  Log errors to file (default off)",
    "  --log-file <path>      Log file path (default: ./agent.js.log)",
    "  --mode <name>          Security mode (plan/build/unsafe)",
    "  --approval <name>      Approval mode (ask/auto/never)",
    "  --tools <name>         Tools mode (auto/on/off)",
    "  --no-tools             Alias for --tools off",
    "  --file <path>          Attach text/code file (repeatable)",
    "  --image <path>         Attach image file (repeatable)",
    "  --yes                  Alias for --approval auto",
    "  --unsafe               Force unsafe mode (critical deny rules still apply)",
    "  -V, --version          Show version",
    "  -h, --help             Show help",
    "",
    "Notes:",
    "  - Auth config is read from ./agent.auth.json",
    "  - Setup wizard: node agent-connect.js",
  ].join("\n");

  process.stdout.write(`${txt}\n`);
}

/**
 * Append errors to a log file when --log is enabled.
 * Logging failures are intentionally swallowed to avoid masking the primary error.
 */
function appendErrorLog(enabled, logFile, err) {
  if (!enabled) return;
  const fullPath = path.resolve(process.cwd(), logFile);
  const timestamp = new Date().toISOString();
  const message = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? err.stack : "(no stack)";
  const line = `[${timestamp}] ERROR: ${message}\n${stack}\n\n`;

  try {
    fs.appendFileSync(fullPath, line, "utf8");
  } catch {
    // ignore logging failure
  }
}

/**
 * Default runtime + security policy config.
 * This keeps behavior predictable even when agent.json does not exist yet.
 */
function defaultAgentConfig() {
  return {
    version: 1,
    runtime: {
      defaultProvider: "",
      defaultModel: "",
      defaultMode: "build",
      defaultApprovalMode: "ask",
      defaultToolsMode: "auto",
    },
    security: {
      mode: "build",
      denyCritical: [
        "rm -rf /",
        "mkfs",
        "shutdown",
        "reboot",
        "poweroff",
        "dd if=",
        "re:curl\\s+.*\\|\\s*(sh|bash)",
        "re:wget\\s+.*\\|\\s*(sh|bash)",
      ],
      modes: {
        plan: {
          allow: [
            "pwd",
            "ls",
            "whoami",
            "date",
            "git status",
            "git branch",
            "git diff",
            "git log",
            "node -v",
            "npm -v",
          ],
          deny: ["rm", "sudo", "chmod", "chown", "mv", "cp", "docker", "npm install", "git push"],
        },
        build: {
          allow: [
            "pwd",
            "ls",
            "whoami",
            "date",
            "git",
            "node",
            "npm",
            "pnpm",
            "yarn",
            "bun",
            "python",
            "pytest",
            "go",
            "cargo",
            "make",
            "docker",
          ],
          deny: ["rm", "sudo", "shutdown", "reboot", "mkfs", "chown"],
        },
        unsafe: {
          allow: ["*"],
          deny: ["rm -rf /", "mkfs", "shutdown", "reboot", "poweroff"],
        },
      },
    },
  };
}

/**
 * Load agent.json (non-secret settings) and merge with defaults.
 */
function loadAgentConfig() {
  const defaults = defaultAgentConfig();
  if (!fs.existsSync(AGENT_CONFIG_FILE)) return defaults;

  const raw = fs.readFileSync(AGENT_CONFIG_FILE, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    const e = new Error(`agent.json contains invalid JSON: ${parseErr.message}`);
    e.code = ERROR_CODES.AGENT_CONFIG_INVALID;
    throw e;
  }
  if (!parsed || typeof parsed !== "object") {
    const e = new Error("agent.json is invalid (JSON format). Please check or recreate the file.");
    e.code = ERROR_CODES.AGENT_CONFIG_INVALID;
    throw e;
  }

  const runtime = Object.assign({}, defaults.runtime, parsed.runtime || {});
  const security = Object.assign({}, defaults.security, parsed.security || {});
  security.modes = Object.assign({}, defaults.security.modes, security.modes || {});

  return {
    version: parsed.version || defaults.version,
    runtime,
    security,
  };
}

/**
 * Load provider configuration from AUTH_CONFIG_FILE.
 * Returns null when file does not exist (supported for first-run UX).
 */
function loadProviderConfig() {
  if (!fs.existsSync(AUTH_CONFIG_FILE)) return null;

  const raw = fs.readFileSync(AUTH_CONFIG_FILE, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    const e = new Error(`agent.auth.json contains invalid JSON: ${parseErr.message}`);
    e.code = ERROR_CODES.AUTH_CONFIG_INVALID;
    throw e;
  }
  if (!parsed || typeof parsed !== "object") {
    const e = new Error("agent.auth.json is invalid (JSON format). Re-run setup: node agent-connect.js");
    e.code = ERROR_CODES.AUTH_CONFIG_INVALID;
    throw e;
  }

  return parsed;
}

/**
 * Persist provider config and enforce restrictive local file permissions.
 * This file contains plaintext secrets by design in this project.
 */
function saveProviderConfig(config) {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(AUTH_CONFIG_FILE, body, { mode: 0o600 });
  try {
    fs.chmodSync(AUTH_CONFIG_FILE, 0o600);
  } catch {
    // skip chmod failure on unsupported platforms
  }
}

function toAbsolutePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return "";
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function ensureReadableFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    const e = new Error(`Attachment file not found: ${filePath}`);
    e.code = ERROR_CODES.ATTACHMENT_NOT_FOUND;
    throw e;
  }

  if (!stat.isFile()) {
    const e = new Error(`Attachment path is not a file: ${filePath}`);
    e.code = ERROR_CODES.ATTACHMENT_UNREADABLE;
    throw e;
  }

  return stat;
}

function detectImageMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || "";
}

function collectAttachments(opts) {
  if (opts.files.length > MAX_FILES) {
    const e = new Error(`Too many files. Maximum is ${MAX_FILES}.`);
    e.code = ERROR_CODES.ATTACHMENT_TOO_MANY_FILES;
    throw e;
  }

  if (opts.images.length > MAX_IMAGES) {
    const e = new Error(`Too many images. Maximum is ${MAX_IMAGES}.`);
    e.code = ERROR_CODES.ATTACHMENT_TOO_MANY_IMAGES;
    throw e;
  }

  const files = opts.files.map((rawPath) => {
    const abs = toAbsolutePath(rawPath);
    const stat = ensureReadableFile(abs);
    if (stat.size > MAX_FILE_BYTES) {
      const e = new Error(`File too large (${stat.size} bytes): ${rawPath}. Max ${MAX_FILE_BYTES} bytes.`);
      e.code = ERROR_CODES.ATTACHMENT_TOO_LARGE;
      throw e;
    }

    let content = "";
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      const e = new Error(`File is not readable as UTF-8 text: ${rawPath}`);
      e.code = ERROR_CODES.ATTACHMENT_UNREADABLE;
      throw e;
    }

    return {
      path: rawPath,
      absolutePath: abs,
      size: stat.size,
      content,
    };
  });

  const images = opts.images.map((rawPath) => {
    const abs = toAbsolutePath(rawPath);
    const stat = ensureReadableFile(abs);
    if (stat.size > MAX_IMAGE_BYTES) {
      const e = new Error(`Image too large (${stat.size} bytes): ${rawPath}. Max ${MAX_IMAGE_BYTES} bytes.`);
      e.code = ERROR_CODES.ATTACHMENT_TOO_LARGE;
      throw e;
    }

    const mime = detectImageMime(abs);
    if (!mime) {
      const e = new Error(`Unsupported image type: ${rawPath}. Allowed: .png, .jpg, .jpeg, .webp`);
      e.code = ERROR_CODES.ATTACHMENT_TYPE_UNSUPPORTED;
      throw e;
    }

    const buffer = fs.readFileSync(abs);
    return {
      path: rawPath,
      absolutePath: abs,
      size: stat.size,
      mime,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    };
  });

  return { files, images };
}

/**
 * Parse "provider/model" form.
 * Returns null when format does not include provider prefix.
 */
function splitProviderModel(value) {
  if (!value || typeof value !== "string") return null;
  const idx = value.indexOf("/");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return {
    provider: value.slice(0, idx),
    model: value.slice(idx + 1),
  };
}

/**
 * Resolve final provider/model selection.
 * Precedence:
 * 1) --model value
 * 2) config.defaultModel
 * 3) hardcoded model fallback
 *
 * If model has no provider prefix, config.defaultProvider is used.
 */
function resolveModelSelection(opts, agentConfig, providerConfig) {
  const configuredDefaultModel =
    agentConfig && agentConfig.runtime && typeof agentConfig.runtime.defaultModel === "string"
      ? agentConfig.runtime.defaultModel
      : providerConfig && typeof providerConfig.defaultModel === "string"
        ? providerConfig.defaultModel
        : "";
  const configuredDefaultProvider =
    agentConfig && agentConfig.runtime && typeof agentConfig.runtime.defaultProvider === "string"
      ? agentConfig.runtime.defaultProvider
      : providerConfig && typeof providerConfig.defaultProvider === "string"
        ? providerConfig.defaultProvider
        : "";

  let modelInput = opts.model || configuredDefaultModel || "gpt-4.1-mini";
  let provider = "";
  let model = "";

  const explicit = splitProviderModel(modelInput);
  if (explicit) {
    provider = explicit.provider;
    model = explicit.model;
    return { provider, model, normalized: `${provider}/${model}` };
  }

  provider = configuredDefaultProvider || "";
  model = modelInput;
  return { provider, model, normalized: `${provider}/${model}` };
}

/** Read a provider entry from config safely. */
function getProviderEntry(config, providerName) {
  if (!config || !config.providers || typeof config.providers !== "object") {
    return null;
  }
  return config.providers[providerName] || null;
}

/**
 * Minimal command tokenizer for safe execFile usage.
 * Supports quoted args and escaped characters.
 */
function tokenizeCommand(input) {
  const tokens = [];
  let cur = "";
  let quote = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }

    cur += ch;
  }

  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

/**
 * Match a policy rule against a command.
 * Rule syntax:
 * - "*"            => match all commands
 * - "re:<regex>"   => regex match (case-insensitive)
 * - plain text      => exact or prefix command match
 */
function matchesPolicyRule(rule, cmd) {
  if (!rule || typeof rule !== "string") return false;
  const normalizedRule = rule.trim().toLowerCase();
  const normalizedCmd = cmd.trim().toLowerCase();

  if (normalizedRule === "*") return true;
  if (normalizedRule.startsWith("re:")) {
    const rx = new RegExp(normalizedRule.slice(3), "i");
    return rx.test(cmd);
  }

  return normalizedCmd === normalizedRule || normalizedCmd.startsWith(`${normalizedRule} `);
}

/**
 * Evaluate command against agent.json security policy.
 */
function evaluateCommandPolicy(cmd, opts, agentConfig) {
  const mode = getEffectiveMode(opts, agentConfig);
  const security = agentConfig && agentConfig.security ? agentConfig.security : defaultAgentConfig().security;
  const modes = security.modes || {};
  const modeConfig = modes[mode] || modes.build || defaultAgentConfig().security.modes.build;

  const denyCritical = Array.isArray(security.denyCritical) ? security.denyCritical : [];
  for (const rule of denyCritical) {
    if (matchesPolicyRule(rule, cmd)) {
      return { allowed: false, mode, source: "denyCritical", rule };
    }
  }

  const deny = Array.isArray(modeConfig.deny) ? modeConfig.deny : [];
  for (const rule of deny) {
    if (matchesPolicyRule(rule, cmd)) {
      return { allowed: false, mode, source: "deny", rule };
    }
  }

  const allow = Array.isArray(modeConfig.allow) ? modeConfig.allow : [];
  const isAllowed = allow.some((rule) => matchesPolicyRule(rule, cmd));
  if (!isAllowed) {
    return { allowed: false, mode, source: "allow", rule: "no allow rule matched" };
  }

  return { allowed: true, mode, source: "allow", rule: "matched" };
}

/** Resolve current security mode from CLI + agent.json settings. */
function getEffectiveMode(opts, agentConfig) {
  const configuredMode =
    opts.mode ||
    (agentConfig && agentConfig.security && typeof agentConfig.security.mode === "string"
      ? agentConfig.security.mode
      : "") ||
    (agentConfig && agentConfig.runtime && typeof agentConfig.runtime.defaultMode === "string"
      ? agentConfig.runtime.defaultMode
      : "build");
  return opts.unsafe ? "unsafe" : configuredMode;
}

/** Resolve approval behavior from CLI + config. */
function getEffectiveApprovalMode(opts, agentConfig) {
  const configured =
    opts.approval ||
    (agentConfig && agentConfig.runtime && typeof agentConfig.runtime.defaultApprovalMode === "string"
      ? agentConfig.runtime.defaultApprovalMode
      : "ask");
  const normalized = configured.toLowerCase();
  if (normalized === "ask" || normalized === "auto" || normalized === "never") {
    return normalized;
  }
  return "ask";
}

/** Resolve tool-calling mode from CLI + config. */
function getEffectiveToolsMode(opts, agentConfig) {
  const configured =
    opts.tools ||
    (agentConfig && agentConfig.runtime && typeof agentConfig.runtime.defaultToolsMode === "string"
      ? agentConfig.runtime.defaultToolsMode
      : "auto");
  const normalized = configured.toLowerCase();
  if (normalized === "on" || normalized === "off" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}

function isToolUnsupportedError(err) {
  const msg = err && err.message ? String(err.message).toLowerCase() : "";
  return (
    msg.includes("tool calling is not supported") ||
    msg.includes("tools are not supported") ||
    msg.includes("tool_choice") ||
    msg.includes("function calling is not supported")
  );
}

function modelLikelySupportsVision(selection) {
  const provider = (selection.provider || "").toLowerCase();
  const model = (selection.model || "").toLowerCase();

  if (provider === "perplexity") return false;
  if (provider === "groq") return false;
  if (provider === "deepseek") return false;

  if (provider === "openai") {
    return model.includes("gpt-4o") || model.includes("gpt-4.1") || model.includes("gpt-5");
  }

  if (provider === "copilot") {
    return model.includes("gpt-4o") || model.includes("gpt-5");
  }

  if (provider === "openrouter") {
    return (
      model.includes("gpt-4o") ||
      model.includes("gpt-4.1") ||
      model.includes("gpt-5") ||
      model.includes("vision") ||
      model.includes("gemini") ||
      model.includes("vl")
    );
  }

  return false;
}

function isVisionUnsupportedError(err) {
  const msg = err && err.message ? String(err.message).toLowerCase() : "";
  return (
    (msg.includes("vision") && msg.includes("not supported")) ||
    (msg.includes("image") && msg.includes("not supported")) ||
    msg.includes("does not support image") ||
    (msg.includes("content type") && msg.includes("image"))
  );
}

function buildUserMessageContent(userText, attachments) {
  const hasImages = attachments.images.length > 0;
  const hasFiles = attachments.files.length > 0;
  if (!hasImages && !hasFiles) return userText;

  const contentParts = [{ type: "text", text: userText }];

  for (const file of attachments.files) {
    const text = [`\nAttached file: ${file.path}`, "```", file.content, "```"].join("\n");
    contentParts.push({ type: "text", text });
  }

  for (const image of attachments.images) {
    contentParts.push({ type: "text", text: `Attached image: ${image.path}` });
    contentParts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }

  return contentParts;
}

function extractAssistantText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const chunks = content
    .map((part) => {
      if (part && typeof part.text === "string") return part.text;
      if (part && typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean);
  return chunks.join("\n");
}

/** Ask user for command execution approval in interactive mode. */
async function promptCommandApproval(cmd, mode, timeoutMs) {
  const readline = require("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  process.stderr.write("\nTool request: run_command\n");
  process.stderr.write(`Mode: ${mode}\n`);
  process.stderr.write(`Command: ${cmd}\n`);

  let timer = null;
  try {
    const questionPromise = rl.question("Approve? [y/N]: ");
    let answer = "";

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      answer = await Promise.race([
        questionPromise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(""), timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
    } else {
      answer = await questionPromise;
    }

    const normalized = String(answer || "").trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    if (timer) clearTimeout(timer);
    rl.close();
  }
}

/**
 * Tool implementation for run_command.
 * Policy is enforced via agent.json using hybrid allow/deny rules.
 */
async function runCommandTool(args, options, agentConfig) {
  const cmd = args && typeof args.cmd === "string" ? args.cmd.trim() : "";
  if (!cmd) {
    return { ok: false, error: "Missing cmd" };
  }

  const decision = evaluateCommandPolicy(cmd, options, agentConfig);
  if (!decision.allowed) {
    return {
      ok: false,
      blocked: true,
      mode: decision.mode,
      policy: {
        source: decision.source,
        rule: decision.rule,
      },
      error: `BLOCKED: Command not allowed in mode '${decision.mode}': ${cmd}`,
    };
  }

  const approvalMode = getEffectiveApprovalMode(options, agentConfig);
  if (approvalMode === "never") {
    return {
      ok: false,
      blocked: true,
      mode: decision.mode,
      approvalMode,
      error: `BLOCKED: Command execution disabled by approval mode 'never': ${cmd}`,
    };
  }

  if (approvalMode === "ask") {
    const timeoutMs =
      agentConfig && agentConfig.runtime && Number.isFinite(Number(agentConfig.runtime.approvalTimeoutMs))
        ? Number(agentConfig.runtime.approvalTimeoutMs)
        : 0;
    const approved = await promptCommandApproval(cmd, decision.mode, timeoutMs);
    if (!approved) {
      return {
        ok: false,
        blocked: true,
        mode: decision.mode,
        approvalMode,
        reason: "user_denied",
        error: `BLOCKED: User denied command: ${cmd}`,
      };
    }
  }

  const parts = tokenizeCommand(cmd);
  if (parts.length === 0) {
    return { ok: false, error: "Empty command" };
  }

  const file = parts[0];
  const execArgs = parts.slice(1);

  try {
    const { stdout, stderr } = await execFileAsync(file, execArgs, {
      cwd: process.cwd(),
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      cmd,
      approvalMode,
      stdout: stdout || "",
      stderr: stderr || "",
    };
  } catch (err) {
    return {
      ok: false,
      cmd,
      error: err && err.message ? err.message : String(err),
      stdout: err && typeof err.stdout === "string" ? err.stdout : "",
      stderr: err && typeof err.stderr === "string" ? err.stderr : "",
      code: typeof err.code === "number" ? err.code : null,
    };
  }
}

/** Small wrapper for easier testing/mocking of current time. */
function nowMs() {
  return Date.now();
}

/** Parse ISO timestamp into milliseconds. Returns 0 on invalid input. */
function parseDateMs(value) {
  if (!value || typeof value !== "string") return 0;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return 0;
  return t;
}

/** Convert seconds-since-epoch to ISO timestamp string. */
function formatIsoFromSeconds(secondsEpoch) {
  if (!Number.isFinite(secondsEpoch)) return "";
  return new Date(secondsEpoch * 1000).toISOString();
}

/**
 * Build centralized Copilot endpoint/header adapter.
 * Keeping this in one place makes future endpoint/header updates easier.
 */
function buildCopilotAdapter(providerName, entry) {
  const oauth = {
    clientId:
      entry.oauth && entry.oauth.clientId
        ? entry.oauth.clientId
        : "Iv1.b507a08c87ecfe98",
    accessTokenUrl:
      entry.oauth && entry.oauth.accessTokenUrl
        ? entry.oauth.accessTokenUrl
        : "https://github.com/login/oauth/access_token",
  };

  const api = {
    copilotTokenUrl:
      entry.api && entry.api.copilotTokenUrl
        ? entry.api.copilotTokenUrl
        : "https://api.github.com/copilot_internal/v2/token",
    baseUrl:
      entry.api && entry.api.baseUrl
        ? entry.api.baseUrl
        : "https://api.githubcopilot.com",
  };

  const extraHeaders = Object.assign(
    {
      "Editor-Version": "vscode/1.85.1",
      "Editor-Plugin-Version": "copilot-chat/0.12.0",
      "User-Agent": "agent.js-copilot",
    },
    entry.extraHeaders && typeof entry.extraHeaders === "object" ? entry.extraHeaders : {}
  );

  return {
    providerName,
    oauth,
    api,
    extraHeaders,
  };
}

/**
 * Refresh GitHub OAuth token using stored refresh token.
 * Updates provider entry in-memory; caller persists config.
 */
async function refreshGithubToken(adapter, entry) {
  if (!entry.githubRefreshToken) {
    throw new Error("No GitHub refresh token available.");
  }

  const payload = new URLSearchParams({
    client_id: adapter.oauth.clientId,
    grant_type: "refresh_token",
    refresh_token: entry.githubRefreshToken,
  });

  const res = await fetchWithTimeout(adapter.oauth.accessTokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`GitHub refresh failed: ${detail}`);
  }

  entry.githubToken = json.access_token || entry.githubToken;
  if (json.refresh_token) entry.githubRefreshToken = json.refresh_token;
  if (json.expires_in) {
    entry.githubTokenExpiresAt = new Date(nowMs() + Number(json.expires_in) * 1000).toISOString();
  }
}

/**
 * Exchange GitHub access token for short-lived Copilot runtime token.
 * Updates provider entry in-memory; caller persists config.
 */
async function fetchCopilotSessionToken(adapter, entry) {
  if (!entry.githubToken) {
    throw new Error("Missing GitHub access token for Copilot.");
  }

  const res = await fetchWithTimeout(adapter.api.copilotTokenUrl, {
    method: "GET",
    headers: Object.assign(
      {
        Accept: "application/json",
        Authorization: `token ${entry.githubToken}`,
      },
      adapter.extraHeaders
    ),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.message || `HTTP ${res.status}`;
    const e = new Error(`Copilot token fetch failed: ${detail}`);
    e.status = res.status;
    throw e;
  }

  if (!json.token) {
    throw new Error("Copilot token response missing token.");
  }

  entry.copilotToken = json.token;
  if (json.expires_at) {
    entry.copilotTokenExpiresAt = formatIsoFromSeconds(Number(json.expires_at));
  } else if (json.expires_at_ms) {
    entry.copilotTokenExpiresAt = new Date(Number(json.expires_at_ms)).toISOString();
  } else {
    entry.copilotTokenExpiresAt = new Date(nowMs() + 25 * 60 * 1000).toISOString();
  }
}

/**
 * Validate token validity with an expiry buffer.
 * Buffer avoids using tokens that are about to expire mid-request.
 */
function isTokenStillValid(expiresAt, bufferMs) {
  const expiry = parseDateMs(expiresAt);
  if (!expiry) return false;
  return expiry - nowMs() > bufferMs;
}

/**
 * Ensure a valid Copilot runtime token exists.
 * Flow:
 * 1) reuse valid cached copilotToken
 * 2) fetch new copilotToken from GitHub token
 * 3) on 401, refresh GitHub token then fetch copilotToken again
 */
async function ensureCopilotRuntimeToken(config, providerName, entry) {
  const adapter = buildCopilotAdapter(providerName, entry);

  if (isTokenStillValid(entry.copilotTokenExpiresAt, COPILOT_REFRESH_BUFFER_MS) && entry.copilotToken) {
    return { token: entry.copilotToken, baseUrl: adapter.api.baseUrl, headers: adapter.extraHeaders };
  }

  try {
    await fetchCopilotSessionToken(adapter, entry);
    saveProviderConfig(config);
    return { token: entry.copilotToken, baseUrl: adapter.api.baseUrl, headers: adapter.extraHeaders };
  } catch (err) {
    const status = err && typeof err.status === "number" ? err.status : 0;
    if (status === 401 && entry.githubRefreshToken) {
      await refreshGithubToken(adapter, entry);
      await fetchCopilotSessionToken(adapter, entry);
      saveProviderConfig(config);
      return { token: entry.copilotToken, baseUrl: adapter.api.baseUrl, headers: adapter.extraHeaders };
    }

    throw new Error(
      `Copilot token refresh failed. Re-auth required: node agent-connect.js --provider copilot (${err.message})`
    );
  }
}

/**
 * Create generic runtime settings for API calls:
 * - apiKey
 * - baseURL
 * - defaultHeaders
 * - model/provider
 *
 * Supports openai-compatible providers and github_copilot provider kind.
 */
async function createProviderRuntime(config, selection) {
  const providerName = selection.provider;
  const entry = getProviderEntry(config, providerName);

  // When no auth config entry exists but AGENT_API_KEY is set,
  // allow env-only runtime creation (useful for CI/CD without agent.auth.json).
  if (!entry) {
    const envApiKey = process.env.AGENT_API_KEY || "";
    if (envApiKey) {
      return {
        apiKey: envApiKey,
        baseURL: "https://api.openai.com/v1",
        defaultHeaders: {},
        model: selection.model,
        provider: providerName,
      };
    }
    const e = new Error(
      `Provider '${providerName}' is not configured. Setup: node agent-connect.js --provider ${providerName}`
    );
    e.code = ERROR_CODES.PROVIDER_NOT_CONFIGURED;
    throw e;
  }

  const kind = entry.kind || "openai_compatible";

  if (kind === "openai_compatible") {
    const envApiKey = process.env.AGENT_API_KEY || "";
    const apiKey = envApiKey || entry.apiKey || "";
    if (!apiKey) {
      throw new Error(`Provider '${providerName}' is missing apiKey. Set AGENT_API_KEY env var or configure via agent-connect.js.`);
    }

    const baseURL = entry.baseUrl || undefined;
    return {
      apiKey,
      baseURL: baseURL || "https://api.openai.com/v1",
      defaultHeaders: {},
      model: selection.model,
      provider: providerName,
    };
  }

  if (kind === "github_copilot") {
    const runtime = await ensureCopilotRuntimeToken(config, providerName, entry);
    return {
      apiKey: runtime.token,
      baseURL: runtime.baseUrl,
      defaultHeaders: runtime.headers,
      model: selection.model,
      provider: providerName,
    };
  }

  throw new Error(`Unsupported provider kind: ${kind}`);
}

/**
 * Send OpenAI-compatible /chat/completions request via fetch.
 * Uses fetchWithRetry for automatic retry on transient server errors and rate limits.
 */
async function createChatCompletion(runtime, payload) {
  const base = (runtime.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/chat/completions`, {
    method: "POST",
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      runtime.defaultHeaders || {}
    ),
    body: JSON.stringify(payload),
  }, CHAT_FETCH_TIMEOUT_MS);

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMessage =
      (json && json.error && (json.error.message || json.error.type)) ||
      json.message ||
      `HTTP ${res.status}`;
    const err = new Error(`Chat completion failed: ${errMessage}`);
    err.status = res.status;
    throw err;
  }

  return json;
}

/**
 * Main execution loop:
 * - resolve provider/model
 * - send chat completion
 * - execute tool calls
 * - continue until final assistant answer or maxTurns reached
 */
/**
 * Apply environment variable overrides to CLI opts.
 * Priority: CLI flag > env var > config file > hardcoded default.
 *
 * Supported environment variables:
 *   AGENT_MODEL    - provider/model (e.g. "openai/gpt-4.1")
 *   AGENT_API_KEY  - API key (overrides agent.auth.json)
 *   AGENT_MODE     - security mode: plan | build | unsafe
 *   AGENT_APPROVAL - approval mode: ask | auto | never
 *
 * Returns a new opts object (does not mutate the input).
 */
function applyEnvOverrides(opts) {
  const out = Object.assign({}, opts);
  const envModel = process.env.AGENT_MODEL || "";
  const envMode = process.env.AGENT_MODE || "";
  const envApproval = process.env.AGENT_APPROVAL || "";

  if (!out.model && envModel) out.model = envModel;
  if (!out.mode && envMode) out.mode = envMode;
  if (!out.approval && envApproval) out.approval = envApproval;

  return out;
}

async function main() {
  const start = Date.now();
  const opts = applyEnvOverrides(parseCliArgs(process.argv.slice(2)));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    process.stdout.write(`${AGENT_VERSION}\n`);
    process.exit(0);
  }

  if (!opts.message) {
    const msg = "Missing required -m/--message. Use --help for usage.";
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: msg }, null, 2)}\n`);
    } else {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  let agentConfig = null;
  let providerConfig = null;
  try {
    agentConfig = loadAgentConfig();
  } catch (err) {
    const e = new Error(`Failed to load agent.json: ${err.message}`);
    e.code = err && err.code ? err.code : ERROR_CODES.AGENT_CONFIG_ERROR;
    throw e;
  }

  try {
    providerConfig = loadProviderConfig();
  } catch (err) {
    const e = new Error(`Failed to load agent.auth.json: ${err.message}`);
    e.code = err && err.code ? err.code : ERROR_CODES.AUTH_CONFIG_ERROR;
    throw e;
  }

  const selection = resolveModelSelection(opts, agentConfig, providerConfig);
  if (!selection.provider) {
    const e = new Error(
      "No provider configured. Start setup: node agent-connect.js | Or use --model <provider/model> (for example --model copilot/gpt-4o)."
    );
    e.code = ERROR_CODES.PROVIDER_NOT_CONFIGURED;
    throw e;
  }
  const approvalMode = getEffectiveApprovalMode(opts, agentConfig);
  const toolsMode = getEffectiveToolsMode(opts, agentConfig);
  const attachments = collectAttachments(opts);

  if (attachments.images.length > 0 && !modelLikelySupportsVision(selection)) {
    const e = new Error(
      `Model '${selection.provider}/${selection.model}' is likely text-only. Image attachments require a vision-capable model.`
    );
    e.code = ERROR_CODES.VISION_NOT_SUPPORTED;
    throw e;
  }

  if (opts.json && approvalMode === "ask") {
    const e = new Error("Interactive approval is not supported with --json. Use --approval auto or --approval never.");
    e.code = ERROR_CODES.INTERACTIVE_APPROVAL_JSON;
    throw e;
  }

  if (approvalMode === "ask" && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    const e = new Error("Interactive approval requires a TTY. Use --approval auto or --approval never.");
    e.code = ERROR_CODES.INTERACTIVE_APPROVAL_TTY;
    throw e;
  }

  const runtime = await createProviderRuntime(providerConfig, selection);

  const tools = [
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Run a shell command on this computer.",
        parameters: {
          type: "object",
          properties: {
            cmd: {
              type: "string",
              description: "Command to run, for example: pwd or ls",
            },
          },
          required: ["cmd"],
          additionalProperties: false,
        },
      },
    },
  ];

  const messages = [
    {
      role: "system",
      content:
        "You are a fast CLI assistant. Use tools only when needed. Keep responses concise.",
    },
    { role: "user", content: buildUserMessageContent(opts.message, attachments) },
  ];

  const toolCalls = [];
  let finalText = "";
  let toolsEnabled = toolsMode !== "off";
  let toolsFallbackUsed = false;
  const maxTurns = 5;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const request = {
      model: runtime.model,
      messages,
      temperature: 0,
    };
    if (toolsEnabled) {
      request.tools = tools;
      request.tool_choice = "auto";
    }

    let completion;
    try {
      completion = await createChatCompletion(runtime, request);
    } catch (err) {
      if (toolsMode === "auto" && toolsEnabled && isToolUnsupportedError(err)) {
        toolsEnabled = false;
        toolsFallbackUsed = true;
        turn -= 1;
        continue;
      }
      if (toolsMode === "on" && toolsEnabled && isToolUnsupportedError(err)) {
        const e = new Error(
          "This model does not support tool calling. Use --tools off, --tools auto, or --no-tools."
        );
        e.code = ERROR_CODES.TOOLS_NOT_SUPPORTED;
        throw e;
      }
      if (attachments.images.length > 0 && isVisionUnsupportedError(err)) {
        const e = new Error(
          `Model '${runtime.provider}/${runtime.model}' rejected image input. Use a vision-capable model or remove --image.`
        );
        e.code = ERROR_CODES.VISION_NOT_SUPPORTED;
        throw e;
      }
      throw err;
    }

    const msg = completion.choices && completion.choices[0] ? completion.choices[0].message : null;
    if (!msg) {
      throw new Error("No assistant message returned.");
    }

    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      finalText = extractAssistantText(msg.content);
      break;
    }

    for (const call of calls) {
      if (!call || !call.function) continue;

      const name = call.function.name;
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      let result;
      if (name === "run_command") {
        result = await runCommandTool(args, opts, agentConfig);
      } else {
        result = { ok: false, error: `Unknown tool: ${name}` };
      }

      toolCalls.push({ name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!finalText && toolCalls.length > 0) {
    process.stderr.write(
      `Warning: Maximum tool-call turns (${maxTurns}) reached without a final answer.\n`
    );
  }

  const payload = {
    ok: true,
    provider: runtime.provider,
    model: `${runtime.provider}/${runtime.model}`,
    mode: getEffectiveMode(opts, agentConfig),
    approvalMode,
    toolsMode,
    toolsEnabled,
    toolsFallbackUsed,
    attachments: {
      files: attachments.files.map((f) => ({ path: f.path, size: f.size, type: "text" })),
      images: attachments.images.map((i) => ({ path: i.path, size: i.size, type: i.mime })),
    },
    message: finalText,
    toolCalls,
    timingMs: Date.now() - start,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${payload.message || "(keine Antwort)"}\n`);
  }
}

/** Top-level error boundary for consistent CLI error handling. */
if (require.main === module) {
  /** Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM. */
  function handleSignal(signal) {
    process.stderr.write(`\nReceived ${signal}, exiting.\n`);
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  main().catch((err) => {
    const opts = parseCliArgs(process.argv.slice(2));
    appendErrorLog(opts.log, opts.logFile, err);

    const msg = err && err.message ? err.message : String(err);
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: msg, code: err && err.code ? err.code : ERROR_CODES.RUNTIME_ERROR }, null, 2)}\n`
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }

    process.exit(1);
  });
}

module.exports = {
  ERROR_CODES,
  fetchWithTimeout,
  parseRetryAfter,
  fetchWithRetry,
  parseCliArgs,
  applyEnvOverrides,
  defaultAgentConfig,
  splitProviderModel,
  resolveModelSelection,
  getProviderEntry,
  tokenizeCommand,
  matchesPolicyRule,
  evaluateCommandPolicy,
  getEffectiveMode,
  getEffectiveApprovalMode,
  getEffectiveToolsMode,
  isToolUnsupportedError,
  modelLikelySupportsVision,
  isVisionUnsupportedError,
  buildUserMessageContent,
  extractAssistantText,
  detectImageMime,
  parseDateMs,
  formatIsoFromSeconds,
  isTokenStillValid,
  nowMs,
  buildCopilotAdapter,
  toAbsolutePath,
};
