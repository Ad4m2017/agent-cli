#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

/**
 * Runtime constants.
 * - DEFAULT_AGENT_CONFIG_FILE: default runtime/policy config path in project root.
 * - DEFAULT_AUTH_CONFIG_FILE: default provider credential/config path in project root.
 * - COPILOT_REFRESH_BUFFER_MS: refresh Copilot token slightly before expiry.
 * - AGENT_VERSION: CLI version displayed via --version.
 */
const DEFAULT_AGENT_CONFIG_FILE = path.resolve(process.cwd(), "agent.json");
const DEFAULT_AUTH_CONFIG_FILE = path.resolve(process.cwd(), "agent.auth.json");
const COPILOT_REFRESH_BUFFER_MS = 60 * 1000;
const AGENT_VERSION = "1.5.6";
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
  INVALID_BASE_URL: "INVALID_BASE_URL",
  INSECURE_BASE_URL: "INSECURE_BASE_URL",
  ATTACHMENT_NOT_FOUND: "ATTACHMENT_NOT_FOUND",
  ATTACHMENT_UNREADABLE: "ATTACHMENT_UNREADABLE",
  ATTACHMENT_TOO_MANY_FILES: "ATTACHMENT_TOO_MANY_FILES",
  ATTACHMENT_TOO_MANY_IMAGES: "ATTACHMENT_TOO_MANY_IMAGES",
  ATTACHMENT_TOO_LARGE: "ATTACHMENT_TOO_LARGE",
  ATTACHMENT_LIMIT_INVALID: "ATTACHMENT_LIMIT_INVALID",
  ATTACHMENT_TYPE_UNSUPPORTED: "ATTACHMENT_TYPE_UNSUPPORTED",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  VISION_NOT_SUPPORTED: "VISION_NOT_SUPPORTED",
  INTERACTIVE_APPROVAL_JSON: "INTERACTIVE_APPROVAL_JSON",
  INTERACTIVE_APPROVAL_TTY: "INTERACTIVE_APPROVAL_TTY",
  TOOLS_NOT_SUPPORTED: "TOOLS_NOT_SUPPORTED",
  INVALID_OPTION: "INVALID_OPTION",
  RUNTIME_ERROR: "RUNTIME_ERROR",
  FETCH_TIMEOUT: "FETCH_TIMEOUT",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
  TOOL_INVALID_ARGS: "TOOL_INVALID_ARGS",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_INVALID_PATTERN: "TOOL_INVALID_PATTERN",
  TOOL_UNSUPPORTED_FILE_TYPE: "TOOL_UNSUPPORTED_FILE_TYPE",
  TOOL_CONFLICT: "TOOL_CONFLICT",
  TOOL_UNKNOWN: "TOOL_UNKNOWN",
  TOOL_EXECUTION_ERROR: "TOOL_EXECUTION_ERROR",
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

let CACHED_CHAT_TOOLS = null;
const POLICY_REGEX_CACHE = new Map();

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
  const logFn = typeof cfg.logFn === "function" ? cfg.logFn : null;
  const onRetry = typeof cfg.onRetry === "function" ? cfg.onRetry : null;
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
        if (onRetry) onRetry({ attempt: attempt + 1, maxRetries: cfg.maxRetries, reason: "http_429", delayMs });
        if (logFn) logFn(`Retry ${attempt + 1}/${cfg.maxRetries} after ${delayMs}ms (HTTP 429 rate limited)`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // Retryable server error (500/502/503)
      if (cfg.retryableStatuses.indexOf(res.status) !== -1) {
        if (attempt >= cfg.maxRetries) return res;
        const delayMs = Math.min(cfg.baseDelayMs * Math.pow(2, attempt), cfg.maxDelayMs);
        if (onRetry) onRetry({ attempt: attempt + 1, maxRetries: cfg.maxRetries, reason: `http_${res.status}`, delayMs });
        if (logFn) logFn(`Retry ${attempt + 1}/${cfg.maxRetries} after ${delayMs}ms (HTTP ${res.status})`);
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
        if (onRetry) onRetry({ attempt: attempt + 1, maxRetries: cfg.maxRetries, reason: "timeout", delayMs });
        if (logFn) logFn(`Retry ${attempt + 1}/${cfg.maxRetries} after ${delayMs}ms (timeout)`);
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
    configPath: "",
    authConfigPath: "",
    log: false,
    logFile: "agent.js.log",
    json: false,
    jsonSchema: false,
    unsafe: false,
    verbose: false,
    debug: false,
    stream: false,
    allowInsecureHttp: false,
    commandTimeoutMs: null,
    systemPrompt: "",
    systemPromptSet: false,
    maxFileBytes: null,
    maxImageBytes: null,
    maxFiles: null,
    maxImages: null,
    profile: "",
    approval: "",
    tools: "",
    files: [],
    images: [],
    yes: false,
    stats: false,
    statsTop: null,
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

    if (a === "--config") {
      opts.configPath = argv[i + 1] || opts.configPath;
      i += 1;
      continue;
    }

    if (a === "--auth-config") {
      opts.authConfigPath = argv[i + 1] || opts.authConfigPath;
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

    if (a === "--json-schema") {
      opts.jsonSchema = true;
      continue;
    }

    if (a === "--unsafe") {
      opts.unsafe = true;
      continue;
    }

    if (a === "--verbose") {
      opts.verbose = true;
      continue;
    }

    if (a === "--debug") {
      opts.debug = true;
      opts.verbose = true;
      continue;
    }

    if (a === "--stream") {
      opts.stream = true;
      continue;
    }

    if (a === "--allow-insecure-http") {
      opts.allowInsecureHttp = true;
      continue;
    }

    if (a === "--command-timeout") {
      const raw = argv[i + 1] || "";
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) opts.commandTimeoutMs = parsed;
      i += 1;
      continue;
    }

    if (a === "--system-prompt") {
      opts.systemPrompt = argv[i + 1] || "";
      opts.systemPromptSet = true;
      i += 1;
      continue;
    }

    if (a === "--max-file-bytes") {
      opts.maxFileBytes = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--max-image-bytes") {
      opts.maxImageBytes = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--max-files") {
      opts.maxFiles = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--max-images") {
      opts.maxImages = argv[i + 1] || "";
      i += 1;
      continue;
    }

    if (a === "--profile") {
      opts.profile = argv[i + 1] || "";
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

    if (a === "--stats") {
      opts.stats = true;
      const maybeTop = argv[i + 1] || "";
      if (/^\d+$/.test(maybeTop)) {
        const n = Number(maybeTop);
        if (Number.isSafeInteger(n) && n > 0) {
          opts.statsTop = n;
        }
        i += 1;
      }
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
    "  --config <path>        Path to agent.json (default: ./agent.json)",
    "  --auth-config <path>   Path to agent.auth.json (default: ./agent.auth.json)",
    "  --json                 Output JSON with tool details",
    "  --json-schema          Print JSON schema for --json output",
    "  --log                  Log errors to file (default off)",
    "  --log-file <path>      Log file path (default: ./agent.js.log)",
    "  --verbose              Print additional runtime diagnostics",
    "  --debug                Print verbose diagnostics (implies --verbose)",
    "  --stream               Enable streaming output when supported",
    "  --allow-insecure-http  Allow non-local HTTP provider URLs",
    "  --command-timeout <ms> Tool command timeout in milliseconds",
    "  --system-prompt <text> Optional system prompt (empty disables system role)",
    "  --max-file-bytes <n>   Max bytes per --file (integer >= 0, 0 = unlimited)",
    "  --max-image-bytes <n>  Max bytes per --image (integer >= 0, 0 = unlimited)",
    "  --max-files <n>        Max number of --file attachments (integer >= 0, 0 = unlimited)",
    "  --max-images <n>       Max number of --image attachments (integer >= 0, 0 = unlimited)",
    "  --profile <name>       Runtime profile (safe/dev/framework)",
    "  --approval <name>      Approval mode (ask/auto/never)",
    "  --tools <name>         Tools mode (auto/on/off)",
    "  --no-tools             Alias for --tools off",
    "  --file <path>          Attach text/code file (repeatable)",
    "  --image <path>         Attach image file (repeatable)",
    "  --yes                  Alias for --approval auto",
    "  --stats [N]            Show usage stats (all models or top N)",
    "  --unsafe               Force framework profile (critical deny rules still apply)",
    "  -V, --version          Show version",
    "  -h, --help             Show help",
    "",
    "Notes:",
    "  - If -m/--message is omitted, prompt is read from stdin (pipe mode)",
    "  - Config defaults: ./agent.json and ./agent.auth.json",
    "  - Setup wizard: node agent-connect.js",
  ].join("\n");

  process.stdout.write(`${txt}\n`);
}

function buildJsonOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://agent-cli.local/schema/output.json",
    title: "agent-cli JSON Output",
    type: "object",
    properties: {
      ok: { type: "boolean" },
      provider: { type: "string" },
      model: { type: "string" },
      profile: { type: "string", enum: ["safe", "dev", "framework"] },
      mode: { type: "string" },
      approvalMode: { type: "string" },
      toolsMode: { type: "string" },
      toolsEnabled: { type: "boolean" },
      toolsFallbackUsed: { type: "boolean" },
      health: {
        type: "object",
        properties: {
          retriesUsed: { type: "number" },
          toolCallsTotal: { type: "number" },
          toolCallsFailed: { type: "number" },
          toolCallFailureRate: { type: "number" },
        },
        required: ["retriesUsed", "toolCallsTotal", "toolCallsFailed", "toolCallFailureRate"],
      },
      attachments: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                size: { type: "number" },
                type: { type: "string" },
              },
              required: ["path", "size", "type"],
            },
          },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                size: { type: "number" },
                type: { type: "string" },
              },
              required: ["path", "size", "type"],
            },
          },
        },
        required: ["files", "images"],
      },
      usage: {
        type: "object",
        properties: {
          turns: { type: "number" },
          turns_with_usage: { type: "number" },
          has_usage: { type: "boolean" },
          input_tokens: { type: "number" },
          output_tokens: { type: "number" },
          total_tokens: { type: "number" },
        },
        required: ["turns", "turns_with_usage", "has_usage", "input_tokens", "output_tokens", "total_tokens"],
      },
      message: { type: "string" },
      toolCalls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: { type: "string" },
            input: { type: "object" },
            ok: { type: "boolean" },
            result: { type: ["object", "null"] },
            error: {
              type: ["object", "null"],
              properties: {
                message: { type: "string" },
                code: { type: "string" },
              },
            },
            meta: {
              type: "object",
              properties: {
                duration_ms: { type: "number" },
                ts: { type: "string" },
              },
              required: ["duration_ms", "ts"],
            },
          },
          required: ["tool", "input", "ok", "result", "error", "meta"],
        },
      },
      timingMs: { type: "number" },
      error: { type: "string" },
      code: { type: "string" },
    },
    required: ["ok"],
  };
}

function redactSensitiveText(input) {
  const text = input == null ? "" : String(input);
  return text
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|token|access_token|refresh_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|access_token|refresh_token|authorization)\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

function createLogger(opts) {
  const verboseEnabled = !!(opts && opts.verbose);
  const debugEnabled = !!(opts && opts.debug);
  return {
    verbose: (msg) => {
      if (!verboseEnabled && !debugEnabled) return;
      process.stderr.write(`[verbose] ${redactSensitiveText(msg)}\n`);
    },
    debug: (msg) => {
      if (!debugEnabled) return;
      process.stderr.write(`[debug] ${redactSensitiveText(msg)}\n`);
    },
  };
}

function getErrorCode(err, fallbackCode) {
  if (err && typeof err.code === "string" && err.code) return err.code;
  return fallbackCode;
}

function getExitCodeForError(err) {
  const code = getErrorCode(err, ERROR_CODES.RUNTIME_ERROR);
  if (code === ERROR_CODES.AGENT_CONFIG_INVALID || code === ERROR_CODES.AGENT_CONFIG_ERROR) return 2;
  if (code === ERROR_CODES.AUTH_CONFIG_INVALID || code === ERROR_CODES.AUTH_CONFIG_ERROR) return 3;
  if (code === ERROR_CODES.PROVIDER_NOT_CONFIGURED || code === ERROR_CODES.INVALID_BASE_URL || code === ERROR_CODES.INSECURE_BASE_URL) return 4;
  if (code === ERROR_CODES.INTERACTIVE_APPROVAL_JSON || code === ERROR_CODES.INTERACTIVE_APPROVAL_TTY) return 5;
  if (code === ERROR_CODES.TOOLS_NOT_SUPPORTED || code === ERROR_CODES.VISION_NOT_SUPPORTED) return 6;
  if (code === ERROR_CODES.FETCH_TIMEOUT) return 7;
  if (code === ERROR_CODES.RETRY_EXHAUSTED) return 8;
  if (String(code).startsWith("ATTACHMENT_")) return 9;
  return 1;
}

/**
 * Append errors to a log file when --log is enabled.
 * Logging failures are intentionally swallowed to avoid masking the primary error.
 */
function appendErrorLog(enabled, logFile, err) {
  if (!enabled) return;
  const fullPath = path.resolve(process.cwd(), logFile);
  const timestamp = new Date().toISOString();
  const message = redactSensitiveText(err && err.message ? err.message : String(err));
  const stack = redactSensitiveText(err && err.stack ? err.stack : "(no stack)");
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
      profile: "dev",
      defaultApprovalMode: "ask",
      defaultToolsMode: "auto",
      maxToolTurns: 10,
      commandTimeoutMs: 10000,
      allowInsecureHttp: false,
      usageStats: {
        enabled: false,
        file: ".agent-usage.ndjson",
        retentionDays: 90,
        maxBytes: 5 * 1024 * 1024,
      },
    },
    security: {
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
        safe: {
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
        dev: {
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
        framework: {
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
function loadAgentConfig(configFilePath) {
  const defaults = defaultAgentConfig();
  const filePath = configFilePath || DEFAULT_AGENT_CONFIG_FILE;
  validateConfigPath(filePath, "agent.json", ERROR_CODES.AGENT_CONFIG_ERROR);
  if (!fs.existsSync(filePath)) return defaults;

  const raw = fs.readFileSync(filePath, "utf8");
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
 * Load provider configuration from agent.auth.json path.
 * Returns null when file does not exist (supported for first-run UX).
 */
function loadProviderConfig(authConfigFilePath) {
  const filePath = authConfigFilePath || DEFAULT_AUTH_CONFIG_FILE;
  validateConfigPath(filePath, "agent.auth.json", ERROR_CODES.AUTH_CONFIG_ERROR);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
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
function saveProviderConfig(config, authConfigFilePath) {
  const filePath = authConfigFilePath || DEFAULT_AUTH_CONFIG_FILE;
  validateConfigPath(filePath, "agent.auth.json", ERROR_CODES.AUTH_CONFIG_ERROR);
  writeJsonAtomic(filePath, config, 0o600, ERROR_CODES.AUTH_CONFIG_ERROR, "agent.auth.json");
}

function toAbsolutePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return "";
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function validateConfigPath(filePath, displayName, errorCode) {
  const p = String(filePath || "");
  if (!p) {
    const e = new Error(`Invalid ${displayName} path.`);
    e.code = errorCode;
    throw e;
  }

  const parent = path.dirname(p);
  if (!fs.existsSync(parent)) {
    const e = new Error(`Parent directory does not exist for ${displayName}: ${parent}`);
    e.code = errorCode;
    throw e;
  }

  let parentStat;
  try {
    parentStat = fs.statSync(parent);
  } catch (err) {
    const e = new Error(`Cannot access parent directory for ${displayName}: ${parent} (${err.message})`);
    e.code = errorCode;
    throw e;
  }
  if (!parentStat.isDirectory()) {
    const e = new Error(`Parent path is not a directory for ${displayName}: ${parent}`);
    e.code = errorCode;
    throw e;
  }

  if (fs.existsSync(p)) {
    let st;
    try {
      st = fs.statSync(p);
    } catch (err) {
      const e = new Error(`Cannot access ${displayName}: ${p} (${err.message})`);
      e.code = errorCode;
      throw e;
    }
    if (st.isDirectory()) {
      const e = new Error(`${displayName} path points to a directory, expected a file: ${p}`);
      e.code = errorCode;
      throw e;
    }
  }
}

function writeJsonAtomic(filePath, value, mode, errorCode, displayName) {
  const target = String(filePath);
  const parent = path.dirname(target);
  const base = path.basename(target);
  const tmpName = `.${base}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tmpPath = path.join(parent, tmpName);
  const body = `${JSON.stringify(value, null, 2)}\n`;

  try {
    fs.writeFileSync(tmpPath, body, { mode });

    try {
      const fd = fs.openSync(tmpPath, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Some filesystems/platforms may not support fsync reliably.
    }

    fs.renameSync(tmpPath, target);
    try {
      fs.chmodSync(target, mode);
    } catch {
      // skip chmod failure on unsupported platforms
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    const e = new Error(`Failed to write ${displayName}: ${err.message}`);
    e.code = errorCode;
    throw e;
  }
}

/** Resolve effective config file paths from CLI options. */
function resolveConfigPaths(opts) {
  return {
    agentConfigPath: toAbsolutePath(opts && opts.configPath) || DEFAULT_AGENT_CONFIG_FILE,
    authConfigPath: toAbsolutePath(opts && opts.authConfigPath) || DEFAULT_AUTH_CONFIG_FILE,
  };
}

function resolveCommandTimeoutMs(opts, agentConfig) {
  const cliValue = opts && Number.isFinite(Number(opts.commandTimeoutMs)) ? Number(opts.commandTimeoutMs) : NaN;
  const cfgValue =
    agentConfig && agentConfig.runtime && Number.isFinite(Number(agentConfig.runtime.commandTimeoutMs))
      ? Number(agentConfig.runtime.commandTimeoutMs)
      : NaN;
  const raw = Number.isFinite(cliValue) ? cliValue : Number.isFinite(cfgValue) ? cfgValue : 10000;
  const rounded = Math.round(raw);
  if (!Number.isFinite(rounded) || rounded <= 0) return 10000;
  if (rounded < 100) return 100;
  if (rounded > 600000) return 600000;
  return rounded;
}

function resolveAllowInsecureHttp(opts, agentConfig) {
  if (opts && opts.allowInsecureHttp) return true;
  const cfgValue =
    agentConfig && agentConfig.runtime && typeof agentConfig.runtime.allowInsecureHttp === "boolean"
      ? agentConfig.runtime.allowInsecureHttp
      : false;
  return cfgValue;
}

function isLocalOrPrivateHttpHost(hostname) {
  const host = (hostname || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".local")) return true;

  // IPv6 local ranges:
  // - loopback: ::1
  // - unique local addresses: fc00::/7 (fcxx and fdxx)
  // - link-local addresses: fe80::/10
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
  }

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

function validateProviderBaseUrl(baseUrl, opts, providerName) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const e = new Error(`Provider '${providerName}' has invalid baseUrl: ${baseUrl}`);
    e.code = ERROR_CODES.INVALID_BASE_URL;
    throw e;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "https:") return parsed.toString().replace(/\/$/, "");
  if (protocol !== "http:") {
    const e = new Error(`Provider '${providerName}' uses unsupported protocol in baseUrl: ${baseUrl}`);
    e.code = ERROR_CODES.INVALID_BASE_URL;
    throw e;
  }

  const allowInsecureHttp = !!(opts && opts.allowInsecureHttp);
  if (allowInsecureHttp || isLocalOrPrivateHttpHost(parsed.hostname)) {
    return parsed.toString().replace(/\/$/, "");
  }

  const e = new Error(
    `Provider '${providerName}' uses insecure HTTP baseUrl: ${baseUrl}. Use HTTPS, local/private host, or --allow-insecure-http.`
  );
  e.code = ERROR_CODES.INSECURE_BASE_URL;
  throw e;
}

async function readStdinText() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
  }
  return chunks.join("");
}

function resolveInputMessage(opts, stdinText) {
  if (opts && typeof opts.message === "string" && opts.message.trim()) return opts.message;
  if (typeof stdinText === "string" && stdinText.trim()) return stdinText.trimEnd();
  return "";
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

function parseNonNegativeInt(raw, label) {
  if (raw == null) return null;

  let value;
  if (typeof raw === "number") {
    value = raw;
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      const e = new Error(`Invalid value for ${label}: '${String(raw)}'. Expected integer >= 0.`);
      e.code = ERROR_CODES.ATTACHMENT_LIMIT_INVALID;
      throw e;
    }
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      const e = new Error(`Invalid value for ${label}: '${raw}'. Expected integer >= 0.`);
      e.code = ERROR_CODES.ATTACHMENT_LIMIT_INVALID;
      throw e;
    }
    value = Number(trimmed);
  } else {
    const e = new Error(`Invalid value for ${label}: '${String(raw)}'. Expected integer >= 0.`);
    e.code = ERROR_CODES.ATTACHMENT_LIMIT_INVALID;
    throw e;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    const e = new Error(`Invalid value for ${label}: '${String(raw)}'. Expected integer >= 0.`);
    e.code = ERROR_CODES.ATTACHMENT_LIMIT_INVALID;
    throw e;
  }

  if (value === 0) return null;
  return value;
}

function resolveAttachmentLimits(opts, agentConfig) {
  const runtime = agentConfig && agentConfig.runtime && typeof agentConfig.runtime === "object" ? agentConfig.runtime : {};
  const cfg = runtime && runtime.attachments && typeof runtime.attachments === "object" ? runtime.attachments : {};

  return {
    maxFileBytes: parseNonNegativeInt(opts && opts.maxFileBytes != null ? opts.maxFileBytes : cfg.maxFileBytes, "--max-file-bytes"),
    maxImageBytes: parseNonNegativeInt(opts && opts.maxImageBytes != null ? opts.maxImageBytes : cfg.maxImageBytes, "--max-image-bytes"),
    maxFiles: parseNonNegativeInt(opts && opts.maxFiles != null ? opts.maxFiles : cfg.maxFiles, "--max-files"),
    maxImages: parseNonNegativeInt(opts && opts.maxImages != null ? opts.maxImages : cfg.maxImages, "--max-images"),
  };
}

function resolveMaxToolTurns(agentConfig) {
  const runtime = agentConfig && agentConfig.runtime && typeof agentConfig.runtime === "object" ? agentConfig.runtime : {};
  const raw = runtime.maxToolTurns;

  if (raw == null) return 10;

  let value;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return 10;
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return 10;
    value = Number(trimmed);
  } else {
    return 10;
  }

  if (value < 1) return 1;
  if (value > 200) return 200;
  return value;
}

function resolveSystemPrompt(opts, agentConfig) {
  if (opts && opts.systemPromptSet) return typeof opts.systemPrompt === "string" ? opts.systemPrompt : "";
  if (opts && typeof opts.systemPrompt === "string" && opts.systemPrompt) return opts.systemPrompt;

  const runtime = agentConfig && agentConfig.runtime && typeof agentConfig.runtime === "object" ? agentConfig.runtime : {};
  if (typeof runtime.systemPrompt === "string") return runtime.systemPrompt;
  return "";
}

function parseUsageStatsNumber(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

function resolveUsageStatsConfig(agentConfig) {
  const runtime = agentConfig && agentConfig.runtime && typeof agentConfig.runtime === "object" ? agentConfig.runtime : {};
  const cfg = runtime && runtime.usageStats && typeof runtime.usageStats === "object" ? runtime.usageStats : {};
  const rawFile = typeof cfg.file === "string" && cfg.file.trim() ? cfg.file.trim() : ".agent-usage.ndjson";
  return {
    enabled: !!cfg.enabled,
    filePath: toAbsolutePath(rawFile),
    retentionDays: parseUsageStatsNumber(cfg.retentionDays, 90),
    maxBytes: parseUsageStatsNumber(cfg.maxBytes, 5 * 1024 * 1024),
    _dirReady: false,
  };
}

function toUsageTokenValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function extractUsageStatsFromCompletion(completion) {
  const usage = completion && completion.usage && typeof completion.usage === "object" ? completion.usage : null;
  if (!usage) {
    return {
      hasUsage: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  const input = toUsageTokenValue(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
  const output = toUsageTokenValue(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
  const totalRaw = toUsageTokenValue(usage.total_tokens);
  const total = totalRaw != null ? totalRaw : input != null && output != null ? input + output : null;
  const hasUsage = input != null || output != null || total != null;

  return {
    hasUsage,
    inputTokens: input != null ? input : 0,
    outputTokens: output != null ? output : 0,
    totalTokens: total != null ? total : 0,
  };
}

function appendUsageStatsEvent(statsConfig, event) {
  if (!statsConfig || !statsConfig.enabled) return;

  try {
    if (!statsConfig._dirReady) {
      fs.mkdirSync(path.dirname(statsConfig.filePath), { recursive: true });
      statsConfig._dirReady = true;
    }
  } catch {
    return;
  }

  const line = `${JSON.stringify(event)}\n`;
  fs.appendFile(statsConfig.filePath, line, "utf8", () => {
    // best-effort logging only
  });
}

function compactUsageStatsEntries(entries, statsConfig) {
  const retentionMs = Number.isFinite(statsConfig.retentionDays) && statsConfig.retentionDays > 0
    ? statsConfig.retentionDays * 24 * 60 * 60 * 1000
    : null;
  const cutoffMs = retentionMs != null ? Date.now() - retentionMs : null;

  let kept = entries.filter((e) => {
    if (cutoffMs == null) return true;
    const t = parseDateMs(e && e.ts ? e.ts : "");
    if (!t) return false;
    return t >= cutoffMs;
  });

  const maxBytes = Number.isFinite(statsConfig.maxBytes) && statsConfig.maxBytes > 0 ? statsConfig.maxBytes : null;
  if (maxBytes != null) {
    const lines = kept.map((e) => `${JSON.stringify(e)}\n`);
    let totalBytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8"), 0);
    if (totalBytes > maxBytes) {
      const targetBytes = Math.max(Math.floor(maxBytes * 0.7), Math.floor(maxBytes / 2));
      let start = 0;
      while (start < lines.length && totalBytes > targetBytes) {
        totalBytes -= Buffer.byteLength(lines[start], "utf8");
        start += 1;
      }
      kept = kept.slice(start);
    }
  }

  return kept;
}

function writeUsageStatsEntriesAtomic(filePath, entries) {
  const parent = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(parent, `.${base}.tmp.${process.pid}.${Date.now()}`);
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  const normalized = body ? `${body}\n` : "";
  fs.writeFileSync(tmpPath, normalized, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function loadAndCompactUsageStats(statsConfig) {
  if (!statsConfig || !statsConfig.filePath || !fs.existsSync(statsConfig.filePath)) return [];
  let raw = "";
  try {
    raw = fs.readFileSync(statsConfig.filePath, "utf8");
  } catch {
    return [];
  }

  const parsed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && typeof e === "object");

  const compacted = compactUsageStatsEntries(parsed, statsConfig);
  if (compacted.length !== parsed.length) {
    try {
      fs.mkdirSync(path.dirname(statsConfig.filePath), { recursive: true });
      writeUsageStatsEntriesAtomic(statsConfig.filePath, compacted);
    } catch {
      // keep stats best-effort
    }
  }

  return compacted;
}

function buildUsageStatsReport(entries) {
  const report = {
    requests_total: 0,
    requests_with_usage: 0,
    requests_usage_missing: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    runs_total: 0,
    retries_used_total: 0,
    tools_fallback_runs: 0,
    tool_calls_total: 0,
    tool_calls_failed: 0,
    by_provider: {},
    by_model: {},
  };

  for (const e of entries) {
    const reqNum = Number(e.request_count);
    const req = Number.isFinite(reqNum) && reqNum >= 0 ? Math.round(reqNum) : 1;
    const provider = typeof e.provider === "string" && e.provider ? e.provider : "unknown";
    const model = typeof e.model === "string" && e.model ? e.model : "unknown";
    const hasUsage = !!e.has_usage;
    const eventType = typeof e.event_type === "string" ? e.event_type : "request";

    if (eventType === "run_summary") {
      report.runs_total += 1;
      report.retries_used_total += toUsageTokenValue(e.retries_used) || 0;
      report.tool_calls_total += toUsageTokenValue(e.tool_calls_total) || 0;
      report.tool_calls_failed += toUsageTokenValue(e.tool_calls_failed) || 0;
      if (e.tools_fallback_used) report.tools_fallback_runs += 1;
      continue;
    }

    report.requests_total += req;
    if (hasUsage) {
      report.requests_with_usage += req;
      report.input_tokens += toUsageTokenValue(e.input_tokens) || 0;
      report.output_tokens += toUsageTokenValue(e.output_tokens) || 0;
      report.total_tokens += toUsageTokenValue(e.total_tokens) || 0;
    }

    if (!report.by_provider[provider]) {
      report.by_provider[provider] = {
        requests_total: 0,
        requests_with_usage: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };
    }
    const p = report.by_provider[provider];
    p.requests_total += req;
    if (hasUsage) {
      p.requests_with_usage += req;
      p.input_tokens += toUsageTokenValue(e.input_tokens) || 0;
      p.output_tokens += toUsageTokenValue(e.output_tokens) || 0;
      p.total_tokens += toUsageTokenValue(e.total_tokens) || 0;
    }

    if (!report.by_model[model]) {
      report.by_model[model] = {
        requests_total: 0,
        requests_with_usage: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };
    }
    const m = report.by_model[model];
    m.requests_total += req;
    if (hasUsage) {
      m.requests_with_usage += req;
      m.input_tokens += toUsageTokenValue(e.input_tokens) || 0;
      m.output_tokens += toUsageTokenValue(e.output_tokens) || 0;
      m.total_tokens += toUsageTokenValue(e.total_tokens) || 0;
    }
  }

  report.requests_usage_missing = report.requests_total - report.requests_with_usage;
  report.retry_rate = report.requests_total > 0 ? report.retries_used_total / report.requests_total : 0;
  report.tool_call_failure_rate = report.tool_calls_total > 0 ? report.tool_calls_failed / report.tool_calls_total : 0;
  return report;
}

function selectTopModels(report, topN) {
  const base = report && typeof report === "object" ? report : buildUsageStatsReport([]);
  const allEntries = Object.entries(base.by_model || {}).sort((a, b) => {
    const bt = toUsageTokenValue(b[1] && b[1].total_tokens) || 0;
    const at = toUsageTokenValue(a[1] && a[1].total_tokens) || 0;
    if (bt !== at) return bt - at;
    const br = toUsageTokenValue(b[1] && b[1].requests_total) || 0;
    const ar = toUsageTokenValue(a[1] && a[1].requests_total) || 0;
    if (br !== ar) return br - ar;
    return String(a[0]).localeCompare(String(b[0]));
  });

  const limit = Number.isSafeInteger(Number(topN)) && Number(topN) > 0 ? Number(topN) : null;
  const selected = limit == null ? allEntries : allEntries.slice(0, limit);
  const byModel = {};
  for (const [name, value] of selected) {
    byModel[name] = value;
  }

  return Object.assign({}, base, {
    by_model: byModel,
    models_total_count: allEntries.length,
    models_shown_count: selected.length,
    models_top_n: limit,
  });
}

function formatHumanNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));

  const units = [
    { limit: 1_000_000_000, suffix: "B" },
    { limit: 1_000_000, suffix: "M" },
    { limit: 1000, suffix: "K" },
  ];

  for (const u of units) {
    if (abs >= u.limit) {
      const scaled = n / u.limit;
      const text = Math.abs(scaled) >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
      return `${text.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")}${u.suffix}`;
    }
  }

  return String(Math.round(n));
}

function formatUsageMetric(value) {
  const n = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return `${n} (${formatHumanNumber(n)})`;
}

function formatNumberWithCommas(value) {
  const n = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return n.toLocaleString("en-US");
}

function formatOverviewMetric(value) {
  const n = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return `${formatHumanNumber(n)} (${formatNumberWithCommas(n)})`;
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${(n * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function fitCell(text, width) {
  const s = String(text == null ? "" : text);
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return `${s.slice(0, width - 1)}…`;
}

function buildStatsBox(title, rows, width) {
  const w = Number.isInteger(width) && width >= 24 ? width : 56;
  const inner = w - 2;
  const top = `┌${"─".repeat(inner)}┐`;
  const sep = `├${"─".repeat(inner)}┤`;
  const bottom = `└${"─".repeat(inner)}┘`;
  const headerText = fitCell(String(title || "").toUpperCase(), inner);
  const headerPadLeft = Math.floor((inner - headerText.length) / 2);
  const headerPadRight = inner - headerText.length - headerPadLeft;
  const lines = [top, `│${" ".repeat(headerPadLeft)}${headerText}${" ".repeat(headerPadRight)}│`, sep];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const label = String(row.label || "");
    const value = String(row.value || "");

    if (!value) {
      const t = fitCell(label, inner);
      lines.push(`│${t}${" ".repeat(inner - t.length)}│`);
      continue;
    }

    const valueFit = fitCell(value, Math.max(1, inner - 2));
    const maxLabel = Math.max(1, inner - valueFit.length - 1);
    const labelFit = fitCell(label, maxLabel);
    const spaces = inner - labelFit.length - valueFit.length;
    lines.push(`│${labelFit}${" ".repeat(spaces)}${valueFit}│`);
  }

  lines.push(bottom);
  return lines.join("\n");
}

function resolveStatsBoxWidth() {
  const cols =
    process && process.stdout && Number.isFinite(Number(process.stdout.columns))
      ? Number(process.stdout.columns)
      : NaN;
  if (!Number.isFinite(cols) || cols <= 0) return 56;
  const preferred = Math.floor(cols) - 2;
  if (preferred < 24) return 24;
  if (preferred > 56) return 56;
  return preferred;
}

function formatUsageStatsText(report, statsConfig) {
  const sections = [];
  const width = resolveStatsBoxWidth();
  const modelsShown = Number.isFinite(report.models_shown_count) ? report.models_shown_count : Object.keys(report.by_model || {}).length;
  const modelsTotal = Number.isFinite(report.models_total_count) ? report.models_total_count : modelsShown;

  sections.push(
    buildStatsBox(
      "Overview",
      [
        { label: "Input", value: formatOverviewMetric(report.input_tokens) },
        { label: "Output", value: formatOverviewMetric(report.output_tokens) },
        { label: "Total", value: formatOverviewMetric(report.total_tokens) },
        { label: "Requests", value: formatNumberWithCommas(report.requests_total) },
        { label: "With Usage", value: formatNumberWithCommas(report.requests_with_usage) },
        { label: "Missing Usage", value: formatNumberWithCommas(report.requests_usage_missing) },
        { label: "Models Shown", value: `${modelsShown}/${modelsTotal}` },
      ],
      width
    )
  );

  sections.push(
    buildStatsBox(
      "Quality",
      [
        { label: "Runs", value: formatNumberWithCommas(report.runs_total) },
        { label: "Retries Used", value: formatNumberWithCommas(report.retries_used_total) },
        { label: "Retry Rate", value: formatPercent(report.retry_rate) },
        { label: "Tool Calls", value: formatNumberWithCommas(report.tool_calls_total) },
        { label: "Tool Failures", value: formatNumberWithCommas(report.tool_calls_failed) },
        { label: "Tool Failure Rate", value: formatPercent(report.tool_call_failure_rate) },
        { label: "Tools Fallback Runs", value: formatNumberWithCommas(report.tools_fallback_runs) },
      ],
      width
    )
  );

  const providerNames = Object.keys(report.by_provider || {}).sort((a, b) => {
    const av = report.by_provider[a] || {};
    const bv = report.by_provider[b] || {};
    const bt = toUsageTokenValue(bv.total_tokens) || 0;
    const at = toUsageTokenValue(av.total_tokens) || 0;
    if (bt !== at) return bt - at;
    return String(a).localeCompare(String(b));
  });

  if (providerNames.length > 0) {
    for (const name of providerNames) {
      const p = report.by_provider[name];
      sections.push(
        buildStatsBox(
          "Provider Usage",
          [
            { label: name },
            { label: "Messages", value: formatNumberWithCommas(p.requests_total) },
            { label: "Input Tokens", value: formatHumanNumber(p.input_tokens) },
            { label: "Output Tokens", value: formatHumanNumber(p.output_tokens) },
            { label: "Total Tokens", value: formatHumanNumber(p.total_tokens) },
          ],
          width
        )
      );
    }
  }

  const modelNames = Object.keys(report.by_model || {});
  if (modelNames.length > 0) {
    for (const name of modelNames) {
      const m = report.by_model[name];
      sections.push(
        buildStatsBox(
          "Model Usage",
          [
            { label: name },
            { label: "Messages", value: formatNumberWithCommas(m.requests_total) },
            { label: "Input Tokens", value: formatHumanNumber(m.input_tokens) },
            { label: "Output Tokens", value: formatHumanNumber(m.output_tokens) },
            { label: "Total Tokens", value: formatHumanNumber(m.total_tokens) },
          ],
          width
        )
      );
    }
  }

  return `${sections.join("\n\n")}\n`;
}

function collectAttachments(opts, limits) {
  const maxFiles = limits && Number.isInteger(limits.maxFiles) ? limits.maxFiles : null;
  const maxImages = limits && Number.isInteger(limits.maxImages) ? limits.maxImages : null;
  const maxFileBytes = limits && Number.isInteger(limits.maxFileBytes) ? limits.maxFileBytes : null;
  const maxImageBytes = limits && Number.isInteger(limits.maxImageBytes) ? limits.maxImageBytes : null;

  if (maxFiles != null && opts.files.length > maxFiles) {
    const e = new Error(`Too many files. Maximum is ${maxFiles}.`);
    e.code = ERROR_CODES.ATTACHMENT_TOO_MANY_FILES;
    throw e;
  }

  if (maxImages != null && opts.images.length > maxImages) {
    const e = new Error(`Too many images. Maximum is ${maxImages}.`);
    e.code = ERROR_CODES.ATTACHMENT_TOO_MANY_IMAGES;
    throw e;
  }

  const files = opts.files.map((rawPath) => {
    const abs = toAbsolutePath(rawPath);
    const stat = ensureReadableFile(abs);
    if (maxFileBytes != null && stat.size > maxFileBytes) {
      const e = new Error(`File too large (${stat.size} bytes): ${rawPath}. Max ${maxFileBytes} bytes.`);
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
    if (maxImageBytes != null && stat.size > maxImageBytes) {
      const e = new Error(`Image too large (${stat.size} bytes): ${rawPath}. Max ${maxImageBytes} bytes.`);
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

function wildcardToRegExp(pattern) {
  const src = String(pattern == null ? "*" : pattern);
  const escaped = src.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${withWildcards}$`);
}

function isTextFilePath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const binaryLike = [
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".ico", ".pdf", ".zip", ".gz", ".tar", ".7z",
    ".mp3", ".wav", ".mp4", ".mov", ".avi", ".woff", ".woff2", ".ttf", ".otf", ".exe", ".dll", ".so",
    ".class", ".jar", ".bin",
  ];
  return binaryLike.indexOf(ext) === -1;
}

function readUtf8TextFile(filePath) {
  if (!isTextFilePath(filePath)) {
    const e = new Error(`Binary-like file extension is unsupported for text operations: ${filePath}`);
    e.code = ERROR_CODES.TOOL_UNSUPPORTED_FILE_TYPE;
    throw e;
  }
  return fs.readFileSync(filePath, "utf8");
}

function resolveToolPath(rawPath, label) {
  const input = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!input) {
    const e = new Error(`Missing ${label || "path"}`);
    e.code = ERROR_CODES.RUNTIME_ERROR;
    throw e;
  }
  return toAbsolutePath(input);
}

function writeTextAtomic(filePath, content) {
  const target = String(filePath || "");
  const parent = path.dirname(target);
  const base = path.basename(target);
  const tmpName = `.${base}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tmpPath = path.join(parent, tmpName);
  const body = typeof content === "string" ? content : String(content || "");

  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(tmpPath, body, "utf8");
  fs.renameSync(tmpPath, target);
}

function listFilesRecursive(baseDir, includeHidden) {
  const out = [];
  const stack = [baseDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (!includeHidden && name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function readFileTool(args) {
  const rawPath = args && typeof args.path === "string" ? args.path : "";
  if (!rawPath) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing path" };

  let filePath = "";
  try {
    filePath = resolveToolPath(rawPath, "path");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  let text = "";
  try {
    text = readUtf8TextFile(filePath);
  } catch (err) {
    const code = err && typeof err.code === "string" && err.code ? err.code : ERROR_CODES.TOOL_EXECUTION_ERROR;
    return { ok: false, code, error: err && err.message ? err.message : String(err) };
  }

  const lines = text.split("\n");
  const offsetRaw = Number(args && args.offset != null ? args.offset : 1);
  const limitRaw = Number(args && args.limit != null ? args.limit : 2000);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 2000;
  const start = offset - 1;
  const end = Math.min(start + limit, lines.length);
  const numbered = [];
  for (let i = start; i < end; i += 1) {
    numbered.push(`${i + 1}: ${lines[i]}`);
  }

  return {
    ok: true,
    path: rawPath,
    absolutePath: filePath,
    totalLines: lines.length,
    offset,
    limit,
    content: numbered.join("\n"),
  };
}

function listFilesTool(args) {
  const rootRaw = args && typeof args.path === "string" && args.path.trim() ? args.path : ".";
  let root = "";
  try {
    root = resolveToolPath(rootRaw, "path");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  const include = args && typeof args.include === "string" && args.include.trim() ? args.include.trim() : "*";
  const includeHidden = !!(args && args.includeHidden);
  const maxRaw = Number(args && args.maxResults != null ? args.maxResults : 2000);
  const maxResults = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 2000;
  const rx = wildcardToRegExp(include);

  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return { ok: false, code: ERROR_CODES.TOOL_NOT_FOUND, error: `Path not found: ${rootRaw}` };
  }
  if (!stat.isDirectory()) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Path is not a directory: ${rootRaw}` };

  const files = listFilesRecursive(root, includeHidden)
    .map((abs) => ({ abs, rel: path.relative(root, abs) }))
    .filter((f) => rx.test(f.rel))
    .slice(0, maxResults)
    .map((f) => f.rel);

  return { ok: true, path: rootRaw, include, maxResults, files };
}

function searchContentTool(args) {
  const rootRaw = args && typeof args.path === "string" && args.path.trim() ? args.path : ".";
  let root = "";
  try {
    root = resolveToolPath(rootRaw, "path");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  const pattern = args && typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing pattern" };

  const include = args && typeof args.include === "string" && args.include.trim() ? args.include.trim() : "*";
  const includeHidden = !!(args && args.includeHidden);
  const caseSensitive = !!(args && args.caseSensitive);
  const maxRaw = Number(args && args.maxResults != null ? args.maxResults : 2000);
  const maxResults = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 2000;
  const includeRx = wildcardToRegExp(include);

  let contentRx;
  try {
    contentRx = new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_PATTERN, error: `Invalid regex pattern: ${err.message}` };
  }

  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return { ok: false, code: ERROR_CODES.TOOL_NOT_FOUND, error: `Path not found: ${rootRaw}` };
  }
  if (!stat.isDirectory()) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Path is not a directory: ${rootRaw}` };

  const matches = [];
  const files = listFilesRecursive(root, includeHidden);
  for (const abs of files) {
    if (matches.length >= maxResults) break;
    const rel = path.relative(root, abs);
    if (!includeRx.test(rel)) continue;
    if (!isTextFilePath(abs)) continue;

    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      contentRx.lastIndex = 0;
      if (!contentRx.test(line)) continue;
      matches.push({ path: rel, line: i + 1, preview: line.slice(0, 400) });
      if (matches.length >= maxResults) break;
    }
  }

  return {
    ok: true,
    path: rootRaw,
    pattern,
    include,
    maxResults,
    matches,
  };
}

function writeFileTool(args) {
  const rawPath = args && typeof args.path === "string" ? args.path : "";
  if (!rawPath) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing path" };
  let filePath = "";
  try {
    filePath = resolveToolPath(rawPath, "path");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  const content = args && typeof args.content === "string" ? args.content : "";
  const createDirs = args && Object.prototype.hasOwnProperty.call(args, "createDirs") ? !!args.createDirs : true;

  try {
    if (!createDirs && !fs.existsSync(path.dirname(filePath))) {
      return { ok: false, code: ERROR_CODES.TOOL_NOT_FOUND, error: `Parent directory does not exist: ${path.dirname(rawPath)}` };
    }
    writeTextAtomic(filePath, content);
    return { ok: true, path: rawPath, bytes: Buffer.byteLength(content, "utf8") };
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_EXECUTION_ERROR, error: err && err.message ? err.message : String(err) };
  }
}

function deleteFileTool(args) {
  const rawPath = args && typeof args.path === "string" ? args.path : "";
  if (!rawPath) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing path" };
  let target = "";
  try {
    target = resolveToolPath(rawPath, "path");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  const recursive = !!(args && args.recursive);

  try {
    const st = fs.statSync(target);
    if (st.isDirectory()) {
      if (!recursive) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Path is a directory. Use recursive=true." };
      fs.rmSync(target, { recursive: true, force: false });
    } else {
      fs.unlinkSync(target);
    }
    return { ok: true, path: rawPath };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code === "ENOENT" ? ERROR_CODES.TOOL_NOT_FOUND : ERROR_CODES.TOOL_EXECUTION_ERROR,
      error: err && err.message ? err.message : String(err),
    };
  }
}

function moveFileTool(args) {
  const fromRaw = args && typeof args.path === "string" ? args.path : "";
  const toRaw = args && typeof args.to === "string" ? args.to : "";
  if (!fromRaw || !toRaw) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing path or to" };

  let from = "";
  let to = "";
  try {
    from = resolveToolPath(fromRaw, "path");
    to = resolveToolPath(toRaw, "to");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  const overwrite = !!(args && args.overwrite);

  try {
    if (!overwrite && fs.existsSync(to)) {
      return { ok: false, code: ERROR_CODES.TOOL_CONFLICT, error: `Destination already exists: ${toRaw}` };
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return { ok: true, path: fromRaw, to: toRaw };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code === "ENOENT" ? ERROR_CODES.TOOL_NOT_FOUND : ERROR_CODES.TOOL_EXECUTION_ERROR,
      error: err && err.message ? err.message : String(err),
    };
  }
}

function mkdirTool(args) {
  const rawPath = args && typeof args.path === "string" ? args.path : "";
  if (!rawPath) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing path" };
  let target = "";
  try {
    target = resolveToolPath(rawPath, "path");
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: err && err.message ? err.message : String(err) };
  }
  const recursive = args && Object.prototype.hasOwnProperty.call(args, "recursive") ? !!args.recursive : true;

  try {
    fs.mkdirSync(target, { recursive });
    return { ok: true, path: rawPath, recursive };
  } catch (err) {
    return { ok: false, code: ERROR_CODES.TOOL_EXECUTION_ERROR, error: err && err.message ? err.message : String(err) };
  }
}

function applyPatchTool(args) {
  const ops = args && Array.isArray(args.operations) ? args.operations : [];
  if (ops.length === 0) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Missing operations[]" };

  const normalizedOps = [];
  for (const op of ops) {
    const type = op && typeof op.op === "string" ? op.op.trim().toLowerCase() : "";
    if (!type) return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Patch op is missing 'op'" };

    if (type === "write" || type === "add" || type === "update") {
      if (!op || typeof op.path !== "string" || !op.path.trim()) {
        return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Patch op '${type}' is missing 'path'` };
      }
      if (!op || typeof op.content !== "string") {
        return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Patch op '${type}' requires string 'content'` };
      }
    } else if (type === "delete") {
      if (!op || typeof op.path !== "string" || !op.path.trim()) {
        return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Patch op 'delete' is missing 'path'" };
      }
    } else if (type === "move" || type === "rename") {
      if (!op || typeof op.path !== "string" || !op.path.trim()) {
        return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Patch op '${type}' is missing 'path'` };
      }
      if (!op || typeof op.to !== "string" || !op.to.trim()) {
        return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Patch op '${type}' is missing 'to'` };
      }
    } else if (type === "mkdir") {
      if (!op || typeof op.path !== "string" || !op.path.trim()) {
        return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: "Patch op 'mkdir' is missing 'path'" };
      }
    } else {
      return { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Unknown patch op: ${type}` };
    }

    normalizedOps.push(Object.assign({}, op, { op: type }));
  }

  for (const op of normalizedOps) {
    const type = op.op;
    if (type === "add") {
      const target = toAbsolutePath(op.path);
      if (fs.existsSync(target)) {
        return { ok: false, code: ERROR_CODES.TOOL_CONFLICT, error: `Patch precheck failed: add target already exists: ${op.path}` };
      }
    }
    if (type === "update") {
      const target = toAbsolutePath(op.path);
      if (!fs.existsSync(target)) {
        return { ok: false, code: ERROR_CODES.TOOL_NOT_FOUND, error: `Patch precheck failed: update target not found: ${op.path}` };
      }
    }
  }

  const results = [];
  for (const op of normalizedOps) {
    const type = op.op;
    let res;
    if (type === "write" || type === "add" || type === "update") {
      res = writeFileTool({ path: op.path, content: op.content, createDirs: true });
    } else if (type === "delete") {
      res = deleteFileTool({ path: op.path, recursive: !!op.recursive });
    } else if (type === "move" || type === "rename") {
      res = moveFileTool({ path: op.path, to: op.to, overwrite: !!op.overwrite });
    } else if (type === "mkdir") {
      res = mkdirTool({ path: op.path, recursive: op.recursive });
    } else {
      res = { ok: false, code: ERROR_CODES.TOOL_INVALID_ARGS, error: `Unknown patch op: ${type || "(empty)"}` };
    }

    results.push({ op: type, path: op && op.path ? op.path : "", result: res });
    if (!res.ok) {
      return { ok: false, code: res.code || ERROR_CODES.TOOL_EXECUTION_ERROR, error: `Patch failed at op '${type}': ${res.error}`, results };
    }
  }

  return { ok: true, results };
}

function buildToolCallRecord(toolName, inputArgs, rawResult, durationMs) {
  const normalizedInput = inputArgs && typeof inputArgs === "object" ? inputArgs : {};
  const base = rawResult && typeof rawResult === "object" ? rawResult : { ok: false, error: String(rawResult || "Unknown error") };
  const ok = !!base.ok;
  return {
    tool: String(toolName || ""),
    input: normalizedInput,
    ok,
    result: ok ? base : null,
    error: ok
      ? null
      : {
          message: base && base.error ? String(base.error) : "Tool execution failed",
          code: base && typeof base.code === "string" && base.code ? base.code : ERROR_CODES.TOOL_EXECUTION_ERROR,
        },
    meta: {
      duration_ms: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : 0,
      ts: new Date().toISOString(),
    },
  };
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

function normalizeProviderName(value) {
  return String(value || "").trim().toLowerCase();
}

function listConfiguredProviders(config) {
  if (!config || !config.providers || typeof config.providers !== "object") return [];
  return Object.keys(config.providers)
    .map((name) => normalizeProviderName(name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function suggestProviderName(input, configuredProviders) {
  const target = normalizeProviderName(input);
  if (!target || !Array.isArray(configuredProviders) || configuredProviders.length === 0) return "";

  for (const candidate of configuredProviders) {
    if (candidate === target) return candidate;
  }
  for (const candidate of configuredProviders) {
    if (candidate.startsWith(target) || target.startsWith(candidate)) return candidate;
  }
  for (const candidate of configuredProviders) {
    if (candidate.includes(target) || target.includes(candidate)) return candidate;
  }
  return "";
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
  const configuredDefaultProviderRaw =
    agentConfig && agentConfig.runtime && typeof agentConfig.runtime.defaultProvider === "string"
      ? agentConfig.runtime.defaultProvider
      : providerConfig && typeof providerConfig.defaultProvider === "string"
        ? providerConfig.defaultProvider
        : "";
  const configuredDefaultProvider = normalizeProviderName(configuredDefaultProviderRaw);

  let modelInput = opts.model || configuredDefaultModel || "gpt-4.1-mini";
  let provider = "";
  let model = "";

  const explicit = splitProviderModel(modelInput);
  if (explicit) {
    provider = normalizeProviderName(explicit.provider);
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

function resolvePowerShellPath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    const candidate = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
}

function buildShellCommandAttempts(command) {
  if (process.platform === "win32") {
    return [
      {
        backend: "powershell",
        file: resolvePowerShellPath(),
        args: ["-NoProfile", "-NonInteractive", "-Command", command],
      },
      {
        backend: "cmd",
        file: "cmd.exe",
        args: ["/d", "/s", "/c", command],
      },
    ];
  }

  const shPath = fs.existsSync("/bin/sh") ? "/bin/sh" : "sh";
  return [
    {
      backend: "sh",
      file: shPath,
      args: ["-lc", command],
    },
  ];
}

function isShellBackendMissingError(err) {
  if (!err || typeof err !== "object") return false;
  const code = typeof err.code === "string" ? err.code : "";
  if (code === "ENOENT" || code === "ENOTFOUND") return true;
  const msg = err.message ? String(err.message).toLowerCase() : "";
  return msg.includes("not found") || msg.includes("cannot find") || msg.includes("is not recognized");
}

async function executeShellCommand(command, timeoutMs) {
  const attempts = buildShellCommandAttempts(command);
  let lastErr = null;

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      const { stdout, stderr } = await execFileAsync(attempt.file, attempt.args, {
        cwd: process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      return {
        ok: true,
        executionMode: "shell",
        backend: attempt.backend,
        stdout: stdout || "",
        stderr: stderr || "",
        code: 0,
        timedOut: false,
      };
    } catch (err) {
      lastErr = err;
      const canRetryDifferentBackend = i < attempts.length - 1 && isShellBackendMissingError(err);
      if (canRetryDifferentBackend) continue;

      const timeoutLike = !!(err && (err.killed || err.signal === "SIGTERM") && err.code == null);
      return {
        ok: false,
        executionMode: "shell",
        backend: attempt.backend,
        error: err && err.message ? err.message : String(err),
        stdout: err && typeof err.stdout === "string" ? err.stdout : "",
        stderr: err && typeof err.stderr === "string" ? err.stderr : "",
        code: typeof err.code === "number" ? err.code : null,
        timedOut: timeoutLike,
      };
    }
  }

  return {
    ok: false,
    executionMode: "shell",
    backend: "unknown",
    error: lastErr && lastErr.message ? lastErr.message : String(lastErr || "Shell execution failed"),
    stdout: lastErr && typeof lastErr.stdout === "string" ? lastErr.stdout : "",
    stderr: lastErr && typeof lastErr.stderr === "string" ? lastErr.stderr : "",
    code: lastErr && typeof lastErr.code === "number" ? lastErr.code : null,
    timedOut: false,
  };
}

/**
 * Match a policy rule against a command.
 * Rule syntax:
 * - "*"            => match all commands
 * - "re:<regex>"   => regex match (case-insensitive)
 * - plain text      => exact or prefix command match
 */
function matchesPolicyRule(rule, cmd, normalizedCmdOverride) {
  if (!rule || typeof rule !== "string") return false;
  const normalizedRule = rule.trim().toLowerCase();
  const normalizedCmd = typeof normalizedCmdOverride === "string" ? normalizedCmdOverride : String(cmd || "").trim().toLowerCase();

  if (normalizedRule === "*") return true;
  if (normalizedRule.startsWith("re:")) {
    let rx = POLICY_REGEX_CACHE.get(normalizedRule);
    if (!rx) {
      rx = new RegExp(normalizedRule.slice(3), "i");
      POLICY_REGEX_CACHE.set(normalizedRule, rx);
    }
    return rx.test(cmd);
  }

  return normalizedCmd === normalizedRule || normalizedCmd.startsWith(`${normalizedRule} `);
}

/**
 * Evaluate command against agent.json security policy.
 */
function evaluateCommandPolicy(cmd, opts, agentConfig) {
  const profile = getEffectiveProfile(opts, agentConfig);
  const mode = profileToPolicyMode(profile);
  const security = agentConfig && agentConfig.security ? agentConfig.security : defaultAgentConfig().security;
  const modes = security.modes || {};
  const modeConfig = modes[mode] || modes.dev || defaultAgentConfig().security.modes.dev;

  const denyCritical = Array.isArray(security.denyCritical) ? security.denyCritical : [];
  const command = String(cmd || "");
  const normalizedCommand = command.trim().toLowerCase();
  for (const rule of denyCritical) {
    if (matchesPolicyRule(rule, command, normalizedCommand)) {
      return { allowed: false, profile, mode, source: "denyCritical", rule };
    }
  }

  const deny = Array.isArray(modeConfig.deny) ? modeConfig.deny : [];
  for (const rule of deny) {
    if (matchesPolicyRule(rule, command, normalizedCommand)) {
      return { allowed: false, profile, mode, source: "deny", rule };
    }
  }

  const allow = Array.isArray(modeConfig.allow) ? modeConfig.allow : [];
  const isAllowed = allow.some((rule) => matchesPolicyRule(rule, command, normalizedCommand));
  if (!isAllowed) {
    return { allowed: false, profile, mode, source: "allow", rule: "no allow rule matched" };
  }

  return { allowed: true, profile, mode, source: "allow", rule: "matched" };
}

function parseProfileValue(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;
  if (v === "safe" || v === "dev" || v === "framework") {
    return { profile: v };
  }
  return null;
}

function getEffectiveProfileDetails(opts, agentConfig) {
  if (opts && opts.unsafe) {
    return { profile: "framework" };
  }

  const profileSources = [
    opts && typeof opts.profile === "string" ? opts.profile : "",
    agentConfig && agentConfig.runtime && typeof agentConfig.runtime.profile === "string" ? agentConfig.runtime.profile : "",
  ];

  for (const source of profileSources) {
    const parsed = parseProfileValue(source);
    if (!parsed) continue;
    return { profile: parsed.profile };
  }

  return { profile: "dev" };
}

function profileToPolicyMode(profile) {
  const p = parseProfileValue(profile);
  const resolved = p ? p.profile : "dev";
  if (resolved === "safe") return "safe";
  if (resolved === "framework") return "framework";
  return "dev";
}

function getEffectiveProfile(opts, agentConfig) {
  return getEffectiveProfileDetails(opts, agentConfig).profile;
}

/** Resolve policy mode from profile. */
function getEffectiveMode(opts, agentConfig) {
  return profileToPolicyMode(getEffectiveProfile(opts, agentConfig));
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

function validateRuntimeOptionOverrides(opts) {
  const profileRaw = opts && typeof opts.profile === "string" ? opts.profile.trim() : "";
  if (profileRaw) {
    const parsed = parseProfileValue(profileRaw);
    if (!parsed) {
      const e = new Error(`Invalid --profile value '${profileRaw}'. Allowed values: safe, dev, framework.`);
      e.code = ERROR_CODES.INVALID_OPTION;
      throw e;
    }
  }

  const approvalRaw = opts && typeof opts.approval === "string" ? opts.approval.trim() : "";
  if (approvalRaw) {
    const v = approvalRaw.toLowerCase();
    if (v !== "ask" && v !== "auto" && v !== "never") {
      const e = new Error(`Invalid --approval value '${approvalRaw}'. Allowed values: ask, auto, never.`);
      e.code = ERROR_CODES.INVALID_OPTION;
      throw e;
    }
  }

  const toolsRaw = opts && typeof opts.tools === "string" ? opts.tools.trim() : "";
  if (toolsRaw) {
    const v = toolsRaw.toLowerCase();
    if (v !== "auto" && v !== "on" && v !== "off") {
      const e = new Error(`Invalid --tools value '${toolsRaw}'. Allowed values: auto, on, off.`);
      e.code = ERROR_CODES.INVALID_OPTION;
      throw e;
    }
  }
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

function providerLikelySupportsStreaming(provider) {
  const p = (provider || "").toLowerCase();
  return (
    p === "openai" ||
    p === "copilot" ||
    p === "openrouter" ||
    p === "groq" ||
    p === "mistral" ||
    p === "deepseek" ||
    p === "fireworks" ||
    p === "moonshot" ||
    p === "together" ||
    p === "xai" ||
    p === "perplexity"
  );
}

function shouldUseStreaming(opts, runtime, toolsEnabled) {
  if (!opts || !opts.stream) return false;
  if (opts.json) return false;
  if (toolsEnabled) return false;
  const provider = runtime && runtime.provider ? runtime.provider : "";
  return providerLikelySupportsStreaming(provider);
}

function isStreamUnsupportedError(err) {
  const msg = err && err.message ? String(err.message).toLowerCase() : "";
  return (
    (msg.includes("stream") && msg.includes("not support")) ||
    (msg.includes("stream") && msg.includes("unsupported")) ||
    (msg.includes("stream") && msg.includes("invalid")) ||
    msg.includes("unknown parameter: stream")
  );
}

async function createChatCompletionStream(runtime, payload, logger, onText, onRetry) {
  const base = (runtime.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
  const authHeaders = runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {};
  const res = await fetchWithRetry(`${base}/chat/completions`, {
    method: "POST",
    headers: Object.assign(
      {
        "Content-Type": "application/json",
      },
      authHeaders,
      runtime.defaultHeaders || {}
    ),
    body: JSON.stringify(Object.assign({}, payload, { stream: true })),
  }, CHAT_FETCH_TIMEOUT_MS, {
    logFn: logger && typeof logger.verbose === "function" ? logger.verbose : null,
    onRetry,
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const errMessage =
      (json && json.error && (json.error.message || json.error.type)) ||
      json.message ||
      `HTTP ${res.status}`;
    const err = new Error(`Chat completion failed: ${errMessage}`);
    err.status = res.status;
    throw err;
  }

  if (!res.body || typeof res.body.getReader !== "function") {
    throw new Error("Streaming response body is not readable in this runtime.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = evt && evt.choices && evt.choices[0] ? evt.choices[0].delta : null;
      if (!delta) continue;

      if (typeof delta.content === "string") {
        text += delta.content;
        if (typeof onText === "function") onText(delta.content);
        continue;
      }

      if (Array.isArray(delta.content)) {
        for (const part of delta.content) {
          if (part && typeof part.text === "string") {
            text += part.text;
            if (typeof onText === "function") onText(part.text);
          }
        }
      }
    }
  }

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: text,
        },
      },
    ],
  };
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
      error: `BLOCKED: Command not allowed for profile '${decision.mode}': ${cmd}`,
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

  const commandTimeoutMs = resolveCommandTimeoutMs(options, agentConfig);
  const result = await executeShellCommand(cmd, commandTimeoutMs);
  return Object.assign({ cmd, approvalMode }, result);
}

const SYNC_TOOL_EXECUTORS = Object.assign(Object.create(null), {
  read_file: readFileTool,
  list_files: listFilesTool,
  search_content: searchContentTool,
  write_file: writeFileTool,
  delete_file: deleteFileTool,
  move_file: moveFileTool,
  mkdir: mkdirTool,
  apply_patch: applyPatchTool,
});

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
async function ensureCopilotRuntimeToken(config, providerName, entry, authConfigPath) {
  const adapter = buildCopilotAdapter(providerName, entry);

  if (isTokenStillValid(entry.copilotTokenExpiresAt, COPILOT_REFRESH_BUFFER_MS) && entry.copilotToken) {
    return { token: entry.copilotToken, baseUrl: adapter.api.baseUrl, headers: adapter.extraHeaders };
  }

  try {
    await fetchCopilotSessionToken(adapter, entry);
    saveProviderConfig(config, authConfigPath);
    return { token: entry.copilotToken, baseUrl: adapter.api.baseUrl, headers: adapter.extraHeaders };
  } catch (err) {
    const status = err && typeof err.status === "number" ? err.status : 0;
    if (status === 401 && entry.githubRefreshToken) {
      await refreshGithubToken(adapter, entry);
      await fetchCopilotSessionToken(adapter, entry);
      saveProviderConfig(config, authConfigPath);
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
async function createProviderRuntime(config, selection, authConfigPath, opts) {
  const providerName = selection.provider;
  const entry = getProviderEntry(config, providerName);
  const configuredProviders = listConfiguredProviders(config);
  const providerHint = suggestProviderName(providerName, configuredProviders);
  const providersText = configuredProviders.length > 0 ? ` Available providers: ${configuredProviders.join(", ")}.` : "";
  const hintText = providerHint && providerHint !== providerName ? ` Did you mean '${providerHint}'?` : "";

  // When no auth config entry exists but AGENT_API_KEY is set,
  // allow env-only runtime creation (useful for CI/CD without agent.auth.json).
  if (!entry) {
    const envApiKey = process.env.AGENT_API_KEY || "";
    if (envApiKey) {
      const baseURL = validateProviderBaseUrl("https://api.openai.com/v1", opts, providerName);
      return {
        apiKey: envApiKey,
        baseURL,
        defaultHeaders: {},
        model: selection.model,
        provider: providerName,
      };
    }
    const e = new Error(
      `Provider '${providerName}' is not configured.${providersText}${hintText} Setup: node agent-connect.js --provider ${providerName}`
    );
    e.code = ERROR_CODES.PROVIDER_NOT_CONFIGURED;
    throw e;
  }

  const kind = entry.kind || "openai_compatible";

  if (kind === "openai_compatible") {
    const envApiKey = process.env.AGENT_API_KEY || "";
    const apiKey = envApiKey || entry.apiKey || "";
    const baseURL = validateProviderBaseUrl(entry.baseUrl || "https://api.openai.com/v1", opts, providerName);
    const isLocalHttp = baseURL.startsWith("http://") && isLocalOrPrivateHttpHost(new URL(baseURL).hostname);
    if (!apiKey && !isLocalHttp) {
      throw new Error(`Provider '${providerName}' is missing apiKey. Set AGENT_API_KEY env var or configure via agent-connect.js.`);
    }
    return {
      apiKey,
      baseURL,
      defaultHeaders: {},
      model: selection.model,
      provider: providerName,
    };
  }

  if (kind === "github_copilot") {
    const runtime = await ensureCopilotRuntimeToken(config, providerName, entry, authConfigPath);
    const baseURL = validateProviderBaseUrl(runtime.baseUrl, opts, providerName);
    return {
      apiKey: runtime.token,
      baseURL,
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
async function createChatCompletion(runtime, payload, logger, useStream, onText, onRetry) {
  if (useStream) {
    return createChatCompletionStream(runtime, payload, logger, onText, onRetry);
  }
  const base = (runtime.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
  const authHeaders = runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {};
  const res = await fetchWithRetry(`${base}/chat/completions`, {
    method: "POST",
    headers: Object.assign(
      {
        "Content-Type": "application/json",
      },
      authHeaders,
      runtime.defaultHeaders || {}
    ),
    body: JSON.stringify(payload),
  }, CHAT_FETCH_TIMEOUT_MS, {
    logFn: logger && typeof logger.verbose === "function" ? logger.verbose : null,
    onRetry,
  });

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
 *   AGENT_PROFILE  - runtime profile: safe | dev | framework
 *   AGENT_API_KEY  - API key (overrides agent.auth.json)
 *   AGENT_APPROVAL - approval mode: ask | auto | never
 *   AGENT_SYSTEM_PROMPT - optional system prompt (empty disables)
 *   AGENT_MAX_FILE_BYTES - max bytes per --file (integer >= 0, 0 = unlimited)
 *   AGENT_MAX_IMAGE_BYTES - max bytes per --image (integer >= 0, 0 = unlimited)
 *   AGENT_MAX_FILES - max count for --file attachments (integer >= 0, 0 = unlimited)
 *   AGENT_MAX_IMAGES - max count for --image attachments (integer >= 0, 0 = unlimited)
 *   AGENT_COMMAND_TIMEOUT - tool command timeout (ms)
 *   AGENT_ALLOW_INSECURE_HTTP - allow non-local HTTP base URLs (1/true/yes)
 *
 * Returns a new opts object (does not mutate the input).
 */
function applyEnvOverrides(opts) {
  const out = Object.assign({}, opts);
  const envModel = process.env.AGENT_MODEL || "";
  const envProfile = process.env.AGENT_PROFILE || "";
  const envApproval = process.env.AGENT_APPROVAL || "";
  const envSystemPrompt = Object.prototype.hasOwnProperty.call(process.env, "AGENT_SYSTEM_PROMPT")
    ? String(process.env.AGENT_SYSTEM_PROMPT)
    : null;
  const envMaxFileBytes = Object.prototype.hasOwnProperty.call(process.env, "AGENT_MAX_FILE_BYTES")
    ? String(process.env.AGENT_MAX_FILE_BYTES)
    : null;
  const envMaxImageBytes = Object.prototype.hasOwnProperty.call(process.env, "AGENT_MAX_IMAGE_BYTES")
    ? String(process.env.AGENT_MAX_IMAGE_BYTES)
    : null;
  const envMaxFiles = Object.prototype.hasOwnProperty.call(process.env, "AGENT_MAX_FILES")
    ? String(process.env.AGENT_MAX_FILES)
    : null;
  const envMaxImages = Object.prototype.hasOwnProperty.call(process.env, "AGENT_MAX_IMAGES")
    ? String(process.env.AGENT_MAX_IMAGES)
    : null;
  const envCommandTimeout = Number(process.env.AGENT_COMMAND_TIMEOUT || "");
  const envAllowInsecureHttp = (process.env.AGENT_ALLOW_INSECURE_HTTP || "").trim().toLowerCase();

  if (!out.model && envModel) out.model = envModel;
  if (!out.profile && envProfile) out.profile = envProfile;
  if (!out.approval && envApproval) out.approval = envApproval;
  if (!out.systemPromptSet && envSystemPrompt !== null) out.systemPrompt = envSystemPrompt;
  if (out.maxFileBytes == null && envMaxFileBytes !== null) out.maxFileBytes = envMaxFileBytes;
  if (out.maxImageBytes == null && envMaxImageBytes !== null) out.maxImageBytes = envMaxImageBytes;
  if (out.maxFiles == null && envMaxFiles !== null) out.maxFiles = envMaxFiles;
  if (out.maxImages == null && envMaxImages !== null) out.maxImages = envMaxImages;
  if ((out.commandTimeoutMs == null || out.commandTimeoutMs === "") && Number.isFinite(envCommandTimeout)) {
    out.commandTimeoutMs = envCommandTimeout;
  }
  if (!out.allowInsecureHttp && (envAllowInsecureHttp === "1" || envAllowInsecureHttp === "true" || envAllowInsecureHttp === "yes")) {
    out.allowInsecureHttp = true;
  }

  return out;
}

async function main() {
  const start = Date.now();
  const opts = applyEnvOverrides(parseCliArgs(process.argv.slice(2)));
  const paths = resolveConfigPaths(opts);
  const logger = createLogger(opts);
  logger.debug(`Resolved config paths: agent=${paths.agentConfigPath}, auth=${paths.authConfigPath}`);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    process.stdout.write(`${AGENT_VERSION}\n`);
    process.exit(0);
  }

  if (opts.jsonSchema) {
    process.stdout.write(`${JSON.stringify(buildJsonOutputSchema(), null, 2)}\n`);
    process.exit(0);
  }

  if (opts.stats) {
    let agentConfigForStats = null;
    try {
      agentConfigForStats = loadAgentConfig(paths.agentConfigPath);
    } catch (err) {
      const e = new Error(`Failed to load ${paths.agentConfigPath}: ${err.message}`);
      e.code = err && err.code ? err.code : ERROR_CODES.AGENT_CONFIG_ERROR;
      throw e;
    }

    const usageStatsConfigForStats = resolveUsageStatsConfig(agentConfigForStats);
    const entries = loadAndCompactUsageStats(usageStatsConfigForStats);
    const report = selectTopModels(buildUsageStatsReport(entries), opts.statsTop);
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, usageStats: Object.assign({ file: usageStatsConfigForStats.filePath }, report) }, null, 2)}\n`
      );
    } else {
      process.stdout.write(formatUsageStatsText(report, usageStatsConfigForStats));
    }
    process.exit(0);
  }

  const stdinText = opts.message ? "" : await readStdinText();
  opts.message = resolveInputMessage(opts, stdinText);

  if (!opts.message) {
    const msg = "Missing required -m/--message. Use --help for usage.";
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: msg }, null, 2)}\n`);
    } else {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  validateRuntimeOptionOverrides(opts);

  let agentConfig = null;
  let providerConfig = null;
  try {
    agentConfig = loadAgentConfig(paths.agentConfigPath);
  } catch (err) {
    const e = new Error(`Failed to load ${paths.agentConfigPath}: ${err.message}`);
    e.code = err && err.code ? err.code : ERROR_CODES.AGENT_CONFIG_ERROR;
    throw e;
  }

  try {
    providerConfig = loadProviderConfig(paths.authConfigPath);
  } catch (err) {
    const e = new Error(`Failed to load ${paths.authConfigPath}: ${err.message}`);
    e.code = err && err.code ? err.code : ERROR_CODES.AUTH_CONFIG_ERROR;
    throw e;
  }

  opts.allowInsecureHttp = resolveAllowInsecureHttp(opts, agentConfig);

  const attachmentLimits = resolveAttachmentLimits(opts, agentConfig);
  const systemPrompt = resolveSystemPrompt(opts, agentConfig);
  const usageStatsConfig = resolveUsageStatsConfig(agentConfig);

  const selection = resolveModelSelection(opts, agentConfig, providerConfig);
  logger.verbose(`Model selection: provider='${selection.provider || ""}' model='${selection.model || ""}'`);
  if (!selection.provider) {
    const e = new Error(
      "No provider configured. Start setup: node agent-connect.js | Or use --model <provider/model> (for example --model copilot/gpt-4o)."
    );
    e.code = ERROR_CODES.PROVIDER_NOT_CONFIGURED;
    throw e;
  }
  const approvalMode = getEffectiveApprovalMode(opts, agentConfig);
  const toolsMode = getEffectiveToolsMode(opts, agentConfig);
  const attachments = collectAttachments(opts, attachmentLimits);

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

  const runtime = await createProviderRuntime(providerConfig, selection, paths.authConfigPath, opts);
  logger.debug(`Runtime resolved: provider='${runtime.provider}' model='${runtime.model}' base='${runtime.baseURL}'`);

  const tools = CACHED_CHAT_TOOLS || (CACHED_CHAT_TOOLS = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a UTF-8 text file with optional line window.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
            offset: { type: "integer", description: "1-based start line" },
            limit: { type: "integer", description: "Max lines to read" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List files recursively from a directory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path" },
            include: { type: "string", description: "Wildcard pattern, e.g. *.js or src/*" },
            includeHidden: { type: "boolean", description: "Include dotfiles and dot-directories" },
            maxResults: { type: "integer", description: "Maximum number of files returned" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_content",
        description: "Search text in files using a regex pattern.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex pattern to search" },
            path: { type: "string", description: "Directory path" },
            include: { type: "string", description: "Wildcard include filter for file paths" },
            caseSensitive: { type: "boolean", description: "Case-sensitive regex search" },
            includeHidden: { type: "boolean", description: "Include dotfiles and dot-directories" },
            maxResults: { type: "integer", description: "Maximum number of matches returned" },
          },
          required: ["pattern"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write UTF-8 text content to a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to write" },
            content: { type: "string", description: "Full UTF-8 content" },
            createDirs: { type: "boolean", description: "Create parent directories when missing" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file or directory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to delete" },
            recursive: { type: "boolean", description: "Required to delete directories" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "move_file",
        description: "Move or rename a file or directory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Source path" },
            to: { type: "string", description: "Destination path" },
            overwrite: { type: "boolean", description: "Overwrite destination if it exists" },
          },
          required: ["path", "to"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mkdir",
        description: "Create a directory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path" },
            recursive: { type: "boolean", description: "Create parent directories" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "apply_patch",
        description: "Apply multiple file operations in order (write/update/delete/move/mkdir).",
        parameters: {
          type: "object",
          properties: {
            operations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  op: { type: "string", description: "Operation: add|update|write|delete|move|rename|mkdir" },
                  path: { type: "string", description: "Path for operation" },
                  to: { type: "string", description: "Destination path for move/rename" },
                  content: { type: "string", description: "File content for add/update/write" },
                  recursive: { type: "boolean", description: "Recursive directory delete/create" },
                  overwrite: { type: "boolean", description: "Overwrite destination on move" },
                },
                required: ["op", "path"],
                additionalProperties: false,
              },
            },
          },
          required: ["operations"],
          additionalProperties: false,
        },
      },
    },
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
  ]);

  const messages = [];
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: buildUserMessageContent(opts.message, attachments) });

  const toolCalls = [];
  let failedToolCalls = 0;
  let finalText = "";
  let streamedFinalOutput = false;
  let toolsEnabled = toolsMode !== "off";
  let toolsFallbackUsed = false;
  let retriesUsed = 0;
  const usageAggregate = {
    turns: 0,
    turns_with_usage: 0,
    has_usage: false,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  const maxTurns = resolveMaxToolTurns(agentConfig);
  const profileDetails = getEffectiveProfileDetails(opts, agentConfig);

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
    let completionError = null;
    const streamThisTurn = shouldUseStreaming(opts, runtime, toolsEnabled);
    if (streamThisTurn) {
      logger.verbose("Using streaming response mode for this turn.");
    }
    try {
      completion = await createChatCompletion(
        runtime,
        request,
        logger,
        streamThisTurn,
        streamThisTurn
          ? (chunk) => {
              process.stdout.write(chunk);
            }
          : null,
        () => {
          retriesUsed += 1;
        }
      );
      if (streamThisTurn) {
        process.stdout.write("\n");
        streamedFinalOutput = true;
      }
    } catch (err) {
      if (streamThisTurn && isStreamUnsupportedError(err)) {
        logger.verbose("Streaming is unsupported for this provider/model. Falling back to non-stream request.");
        try {
          completion = await createChatCompletion(runtime, request, logger, false, null, () => {
            retriesUsed += 1;
          });
        } catch (fallbackErr) {
          completionError = fallbackErr;
        }
      } else {
        completionError = err;
      }
    }

    if (!completion) {
      const err = completionError || new Error("Completion failed.");
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

    const usageStats = extractUsageStatsFromCompletion(completion);
    usageAggregate.turns += 1;
    if (usageStats.hasUsage) {
      usageAggregate.turns_with_usage += 1;
      usageAggregate.has_usage = true;
      usageAggregate.input_tokens += usageStats.inputTokens;
      usageAggregate.output_tokens += usageStats.outputTokens;
      usageAggregate.total_tokens += usageStats.totalTokens;
    }
    appendUsageStatsEvent(usageStatsConfig, {
      ts: new Date().toISOString(),
      provider: runtime.provider,
      model: `${runtime.provider}/${runtime.model}`,
      request_count: 1,
      input_tokens: usageStats.inputTokens,
      output_tokens: usageStats.outputTokens,
      total_tokens: usageStats.totalTokens,
      has_usage: usageStats.hasUsage,
    });

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
      const toolStart = Date.now();
      const syncExecutor = SYNC_TOOL_EXECUTORS[name] || null;
      if (syncExecutor) {
        result = syncExecutor(args);
      } else if (name === "run_command") {
        result = await runCommandTool(args, opts, agentConfig);
      } else {
        result = { ok: false, code: ERROR_CODES.TOOL_UNKNOWN, error: `Unknown tool: ${name}` };
      }

      const record = buildToolCallRecord(name, args, result, Date.now() - toolStart);

      toolCalls.push(record);
      if (!record.ok) failedToolCalls += 1;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(record),
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
    profile: profileDetails.profile,
    mode: getEffectiveMode(opts, agentConfig),
    approvalMode,
    toolsMode,
    toolsEnabled,
    toolsFallbackUsed,
    health: {
      retriesUsed,
      toolCallsTotal: toolCalls.length,
      toolCallsFailed: failedToolCalls,
      toolCallFailureRate: toolCalls.length ? failedToolCalls / toolCalls.length : 0,
    },
    attachments: {
      files: attachments.files.map((f) => ({ path: f.path, size: f.size, type: "text" })),
      images: attachments.images.map((i) => ({ path: i.path, size: i.size, type: i.mime })),
    },
    usage: usageAggregate,
    message: finalText,
    toolCalls,
    timingMs: Date.now() - start,
  };

  appendUsageStatsEvent(usageStatsConfig, {
    ts: new Date().toISOString(),
    event_type: "run_summary",
    provider: runtime.provider,
    model: `${runtime.provider}/${runtime.model}`,
    request_count: 0,
    retries_used: payload.health.retriesUsed,
    tool_calls_total: payload.health.toolCallsTotal,
    tool_calls_failed: payload.health.toolCallsFailed,
    tools_fallback_used: payload.toolsFallbackUsed,
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    if (!streamedFinalOutput) {
      process.stdout.write(`${payload.message || "(keine Antwort)"}\n`);
    }
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

    const code = getErrorCode(err, ERROR_CODES.RUNTIME_ERROR);
    const exitCode = getExitCodeForError(err);
    const msg = redactSensitiveText(err && err.message ? err.message : String(err));
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: msg, code }, null, 2)}\n`
      );
    } else {
      process.stderr.write(`Error [${code}]: ${msg}\n`);
    }

    process.exit(exitCode);
  });
}

module.exports = {
  ERROR_CODES,
  fetchWithTimeout,
  parseRetryAfter,
  fetchWithRetry,
  parseCliArgs,
  buildJsonOutputSchema,
  applyEnvOverrides,
  resolveConfigPaths,
  resolveCommandTimeoutMs,
  isLocalOrPrivateHttpHost,
  validateProviderBaseUrl,
  readStdinText,
  resolveInputMessage,
  validateConfigPath,
  writeJsonAtomic,
  redactSensitiveText,
  createLogger,
  getErrorCode,
  getExitCodeForError,
  defaultAgentConfig,
  splitProviderModel,
  normalizeProviderName,
  listConfiguredProviders,
  suggestProviderName,
  resolveModelSelection,
  getProviderEntry,
  tokenizeCommand,
  matchesPolicyRule,
  evaluateCommandPolicy,
  parseProfileValue,
  getEffectiveProfileDetails,
  getEffectiveProfile,
  getEffectiveMode,
  getEffectiveApprovalMode,
  getEffectiveToolsMode,
  validateRuntimeOptionOverrides,
  isToolUnsupportedError,
  modelLikelySupportsVision,
  isVisionUnsupportedError,
  providerLikelySupportsStreaming,
  shouldUseStreaming,
  isStreamUnsupportedError,
  buildUserMessageContent,
  extractAssistantText,
  detectImageMime,
  parseNonNegativeInt,
  resolveAttachmentLimits,
  resolveMaxToolTurns,
  resolveSystemPrompt,
  resolveUsageStatsConfig,
  wildcardToRegExp,
  readFileTool,
  listFilesTool,
  searchContentTool,
  writeFileTool,
  deleteFileTool,
  moveFileTool,
  mkdirTool,
  applyPatchTool,
  buildToolCallRecord,
  extractUsageStatsFromCompletion,
  buildUsageStatsReport,
  selectTopModels,
  compactUsageStatsEntries,
  loadAndCompactUsageStats,
  formatUsageStatsText,
  parseDateMs,
  formatIsoFromSeconds,
  isTokenStillValid,
  nowMs,
  buildCopilotAdapter,
  toAbsolutePath,
};
