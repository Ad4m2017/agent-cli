#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const readlinePromises = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

/**
 * Runtime constants for the provider setup wizard.
 * Credentials are intentionally stored in local plaintext JSON for simplicity.
 */
const DEFAULT_AGENT_CONFIG_FILE = path.resolve(process.cwd(), "agent.json");
const DEFAULT_AUTH_CONFIG_FILE = path.resolve(process.cwd(), "agent.auth.json");
const CONNECT_VERSION = "1.2.1";

/**
 * Centralized error codes.
 * Every coded error thrown by agent-connect.js references one of these constants.
 */
const ERROR_CODES = {
  SELECT_OPTIONS_EMPTY: "SELECT_OPTIONS_EMPTY",
  INTERRUPTED: "INTERRUPTED",
  AUTH_CONFIG_INVALID: "AUTH_CONFIG_INVALID",
  AGENT_CONFIG_INVALID: "AGENT_CONFIG_INVALID",
  PROVIDER_INVALID: "PROVIDER_INVALID",
  PROVIDER_UNSUPPORTED: "PROVIDER_UNSUPPORTED",
  API_KEY_REQUIRED: "API_KEY_REQUIRED",
  COPILOT_DEVICE_START_FAILED: "COPILOT_DEVICE_START_FAILED",
  COPILOT_DEVICE_FLOW_FAILED: "COPILOT_DEVICE_FLOW_FAILED",
  COPILOT_TOKEN_MISSING: "COPILOT_TOKEN_MISSING",
  COPILOT_DEVICE_CODE_EXPIRED: "COPILOT_DEVICE_CODE_EXPIRED",
  COPILOT_RUNTIME_TOKEN_FAILED: "COPILOT_RUNTIME_TOKEN_FAILED",
  COPILOT_RUNTIME_TOKEN_MISSING: "COPILOT_RUNTIME_TOKEN_MISSING",
  CONNECT_ERROR: "CONNECT_ERROR",
  FETCH_TIMEOUT: "FETCH_TIMEOUT",
};

const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const MODELS_DEV_API_URL = "https://models.dev/api.json";

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

const PROVIDER_CATALOG = {
  copilot: { type: "oauth", label: "GitHub Copilot" },
  deepseek: {
    type: "api",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v3"],
  },
  fireworks: {
    type: "api",
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    models: ["accounts/fireworks/models/llama-v3p1-8b-instruct", "accounts/fireworks/models/qwen2p5-72b-instruct"],
  },
  groq: {
    type: "api",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
  mistral: {
    type: "api",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
  },
  moonshot: {
    type: "api",
    label: "Moonshot AI",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  ollama: {
    type: "local",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.1", "qwen2.5", "mistral"],
  },
  lmstudio: {
    type: "local",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    models: ["local-model"],
  },
  openai: {
    type: "api",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o", "gpt-5-mini"],
  },
  openrouter: {
    type: "api",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o-mini", "openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001"],
  },
  perplexity: {
    type: "api",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"],
  },
  together: {
    type: "api",
    label: "Together",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.1-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
  },
  xai: {
    type: "api",
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-2-latest", "grok-2-mini-latest", "grok-beta"],
  },
  custom: {
    type: "api",
    label: "Custom OpenAI-Compatible",
    baseUrl: "https://api.openai.com/v1",
    models: [],
  },
};

const SORTED_PROVIDERS = Object.keys(PROVIDER_CATALOG).sort((a, b) => a.localeCompare(b));

function makeError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function redactSensitiveText(input) {
  const text = input == null ? "" : String(input);
  return text
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|token|access_token|refresh_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|access_token|refresh_token|authorization)\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

function getErrorCode(err, fallbackCode) {
  if (err && typeof err.code === "string" && err.code) return err.code;
  return fallbackCode;
}

function getExitCodeForError(err) {
  const code = getErrorCode(err, ERROR_CODES.CONNECT_ERROR);
  if (code === ERROR_CODES.AGENT_CONFIG_INVALID) return 2;
  if (code === ERROR_CODES.AUTH_CONFIG_INVALID) return 3;
  if (code === ERROR_CODES.PROVIDER_INVALID || code === ERROR_CODES.PROVIDER_UNSUPPORTED || code === ERROR_CODES.API_KEY_REQUIRED) return 4;
  if (
    code === ERROR_CODES.COPILOT_DEVICE_START_FAILED ||
    code === ERROR_CODES.COPILOT_DEVICE_FLOW_FAILED ||
    code === ERROR_CODES.COPILOT_TOKEN_MISSING ||
    code === ERROR_CODES.COPILOT_DEVICE_CODE_EXPIRED ||
    code === ERROR_CODES.COPILOT_RUNTIME_TOKEN_FAILED ||
    code === ERROR_CODES.COPILOT_RUNTIME_TOKEN_MISSING
  ) {
    return 6;
  }
  if (code === ERROR_CODES.FETCH_TIMEOUT) return 7;
  return 1;
}

/**
 * Simple interactive select menu using arrow keys + Enter.
 * Falls back to initial option in non-TTY environments.
 */
function getMenuWindow(total, selected, pageSize) {
  const size = Math.max(1, Math.floor(pageSize || 10));
  const safeTotal = Math.max(0, Math.floor(total || 0));
  const safeSelected = Math.max(0, Math.min(Math.floor(selected || 0), Math.max(0, safeTotal - 1)));
  if (safeTotal <= size) {
    return { start: 0, end: safeTotal, pageSize: size };
  }
  let start = safeSelected - Math.floor(size / 2);
  if (start < 0) start = 0;
  if (start + size > safeTotal) start = safeTotal - size;
  return { start, end: start + size, pageSize: size };
}

function truncateForTerminal(text, maxWidth) {
  const s = String(text == null ? "" : text);
  const width = Math.max(10, Number.isFinite(maxWidth) ? Math.floor(maxWidth) : 120);
  if (s.length <= width) return s;
  if (width <= 3) return s.slice(0, width);
  return `${s.slice(0, width - 3)}...`;
}

async function selectMenu(message, options, initialIndex = 0) {
  if (!Array.isArray(options) || options.length === 0) {
    throw makeError(ERROR_CODES.SELECT_OPTIONS_EMPTY, "Wizard options are missing.");
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return options[Math.max(0, Math.min(initialIndex, options.length - 1))].value;
  }

  let selected = Math.max(0, Math.min(initialIndex, options.length - 1));
  const pageSize = 10;
  let renderedLines = 0;

  const render = () => {
    if (renderedLines > 0) {
      for (let i = 0; i < renderedLines; i += 1) {
        stdout.write("\x1b[1A\x1b[2K\r");
      }
    }

    const w = getMenuWindow(options.length, selected, pageSize);
    const pageOptions = options.slice(w.start, w.end);
    const columns = Number(stdout.columns || 120);
    const labelWidth = Math.max(20, columns - 4);
    const lines = [
      `${message} (${selected + 1}/${options.length})`,
      ...pageOptions.map((opt, idx) => {
        const absoluteIdx = w.start + idx;
        return `${absoluteIdx === selected ? ">" : " "} ${truncateForTerminal(opt.label, labelWidth)}`;
      }),
      "Use Up/Down, n/p (+/-10), and Enter.",
    ];

    stdout.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  };

  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(stdin);
    stdin.resume();
    const previousRaw = stdin.isRaw;
    if (!previousRaw) stdin.setRawMode(true);

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (!previousRaw) stdin.setRawMode(false);
    };

    const finish = (value) => {
      cleanup();
      resolve(value);
    };

    const fail = (err) => {
      cleanup();
      reject(err);
    };

    const onKeypress = (_str, key) => {
      if (!key) return;

      if (key.ctrl && key.name === "c") {
        fail(makeError(ERROR_CODES.INTERRUPTED, "Wizard interrupted."));
        return;
      }

      if (key.name === "up") {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === "down") {
        selected = (selected + 1) % options.length;
        render();
        return;
      }

      if (key.name === "n" || key.name === "pagedown") {
        selected = Math.min(options.length - 1, selected + pageSize);
        render();
        return;
      }

      if (key.name === "p" || key.name === "pageup") {
        selected = Math.max(0, selected - pageSize);
        render();
        return;
      }

      if (key.name === "return") {
        finish(options[selected].value);
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

async function multiSelectMenu(message, options, initiallySelectedValues) {
  if (!Array.isArray(options) || options.length === 0) {
    throw makeError(ERROR_CODES.SELECT_OPTIONS_EMPTY, "Wizard options are missing.");
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return Array.isArray(initiallySelectedValues) ? initiallySelectedValues : [];
  }

  const selectedSet = new Set(Array.isArray(initiallySelectedValues) ? initiallySelectedValues : []);
  let cursor = 0;
  const pageSize = 10;
  let renderedLines = 0;

  const render = () => {
    if (renderedLines > 0) {
      for (let i = 0; i < renderedLines; i += 1) {
        stdout.write("\x1b[1A\x1b[2K\r");
      }
    }

    const w = getMenuWindow(options.length, cursor, pageSize);
    const pageOptions = options.slice(w.start, w.end);
    const columns = Number(stdout.columns || 120);
    const labelWidth = Math.max(20, columns - 10);
    const lines = [
      `${message} (${cursor + 1}/${options.length})`,
      ...pageOptions.map((opt, idx) => {
        const absoluteIdx = w.start + idx;
        const pointer = absoluteIdx === cursor ? ">" : " ";
        const checked = selectedSet.has(opt.value) ? "x" : " ";
        return `${pointer} [${checked}] ${truncateForTerminal(opt.label, labelWidth)}`;
      }),
      "Use Up/Down, Space toggle, n/p (+/-10), Enter confirm.",
    ];

    stdout.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  };

  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(stdin);
    stdin.resume();
    const previousRaw = stdin.isRaw;
    if (!previousRaw) stdin.setRawMode(true);

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (!previousRaw) stdin.setRawMode(false);
    };

    const finish = () => {
      cleanup();
      resolve(Array.from(selectedSet));
    };

    const fail = (err) => {
      cleanup();
      reject(err);
    };

    const onKeypress = (_str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        fail(makeError(ERROR_CODES.INTERRUPTED, "Wizard interrupted."));
        return;
      }
      if (key.name === "up") {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === "down") {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }
      if (key.name === "n" || key.name === "pagedown") {
        cursor = Math.min(options.length - 1, cursor + pageSize);
        render();
        return;
      }
      if (key.name === "p" || key.name === "pageup") {
        cursor = Math.max(0, cursor - pageSize);
        render();
        return;
      }
      if (key.name === "space") {
        const v = options[cursor].value;
        if (selectedSet.has(v)) selectedSet.delete(v);
        else selectedSet.add(v);
        render();
        return;
      }
      if (key.name === "return") {
        finish();
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

async function fetchProviderModels(baseUrl, authToken) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  if (!root) return [];
  const headers = { Accept: "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetchWithTimeout(`${root}/models`, {
    method: "GET",
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || !Array.isArray(json.data)) return [];

  const ids = json.data
    .map((m) => (m && typeof m.id === "string" ? m.id.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

function getModelsDevProviderKeys(provider, baseUrl) {
  const p = String(provider || "").trim().toLowerCase();
  const keys = [];
  if (p) keys.push(p);
  if (p === "copilot") keys.push("github-copilot");
  if (p === "moonshot") keys.push("moonshotai");
  if (p === "lmstudio") keys.push("lm-studio", "lm_studio");

  const host = (() => {
    try {
      return new URL(String(baseUrl || "")).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (host.includes("openrouter")) keys.push("openrouter");
  if (host.includes("groq")) keys.push("groq");
  if (host.includes("perplexity")) keys.push("perplexity");
  if (host.includes("moonshot")) keys.push("moonshotai", "moonshot");
  if (host.includes("deepseek")) keys.push("deepseek");
  if (host.includes("mistral")) keys.push("mistral");
  if (host.includes("together")) keys.push("together");
  if (host.includes("x.ai")) keys.push("xai");
  if (host.includes("githubcopilot")) keys.push("github-copilot");
  if (host.includes("localhost") || host.includes("127.0.0.1")) keys.push("ollama", "lm-studio", "lmstudio");

  return Array.from(new Set(keys.filter(Boolean)));
}

async function fetchModelsFromModelsDev(provider, baseUrl) {
  const res = await fetchWithTimeout(MODELS_DEV_API_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  }, 20000);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || typeof json !== "object") return [];

  const providerKeys = getModelsDevProviderKeys(provider, baseUrl);
  for (const key of providerKeys) {
    const entry = json[key];
    if (!entry || typeof entry !== "object") continue;
    const models = entry.models;
    if (!models || typeof models !== "object") continue;
    const ids = Object.keys(models)
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (ids.length > 0) return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }

  return [];
}

async function fetchModelsDevRegistry() {
  const res = await fetchWithTimeout(MODELS_DEV_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "agent-connect.js",
    },
  }, 20000);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || typeof json !== "object") return {};
  return json;
}

function extractModelsFromModelsDevEntry(entry) {
  if (!entry || typeof entry !== "object") return [];
  const models = entry.models;
  if (!models || typeof models !== "object") return [];
  return Object.keys(models)
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function getModelsDevProviderCandidates(registry) {
  const out = [];
  if (!registry || typeof registry !== "object") return out;

  for (const [id, entry] of Object.entries(registry)) {
    if (!entry || typeof entry !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(PROVIDER_CATALOG, id)) continue;

    const apiUrl = typeof entry.api === "string" ? entry.api.trim() : "";
    if (!apiUrl) continue;

    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id;
    const models = extractModelsFromModelsDevEntry(entry);
    out.push({
      id,
      name,
      baseUrl: apiUrl,
      models,
      label: `${name} (${id})`,
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function buildProviderModelList(provider, providerInfo, dynamicModels) {
  const list = Array.isArray(dynamicModels) && dynamicModels.length > 0
    ? dynamicModels
    : Array.isArray(providerInfo.models)
      ? providerInfo.models
      : [];
  return Array.from(new Set(list.filter(Boolean)));
}

async function chooseEnabledModels(rl, provider, providerInfo, entry) {
  let discovered = [];
  const authToken = entry.apiKey || entry.oauthAccessToken || entry.copilotToken || "";
  const shouldFetchLive = stdin.isTTY && stdout.isTTY
    ? await askYesNo(rl, "Try to fetch live models from provider now?", true)
    : true;

  if (shouldFetchLive) {
    try {
      discovered = await fetchProviderModels(entry.baseUrl, authToken);
      if (discovered.length === 0 && stdin.isTTY && stdout.isTTY) {
        process.stdout.write("No models returned from provider /models endpoint. Falling back to catalog/manual input.\n");
      }
    } catch {
      if (stdin.isTTY && stdout.isTTY) {
        process.stdout.write("Could not fetch live models. Falling back to catalog/manual input.\n");
      }
    }
  }

  let community = [];
  if (discovered.length === 0) {
    const useModelsDev = stdin.isTTY && stdout.isTTY
      ? await askYesNo(rl, "Load community models from models.dev?", true)
      : false;
    if (useModelsDev) {
      try {
        community = await fetchModelsFromModelsDev(provider, entry.baseUrl);
        if (community.length === 0 && stdin.isTTY && stdout.isTTY) {
          process.stdout.write("models.dev returned no models for this provider.\n");
        }
      } catch {
        if (stdin.isTTY && stdout.isTTY) {
          process.stdout.write("Could not load models from models.dev.\n");
        }
      }
    }
  }

  const available = buildProviderModelList(provider, providerInfo, discovered.length > 0 ? discovered : community);
  const prefixed = available.map((m) => `${provider}/${m}`);

  if (prefixed.length === 0) {
    const manual = (await rl.question(`No known models found for ${provider}. Enter models (comma-separated, provider/model or model): `)).trim();
    if (manual) {
      const parsed = manual
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((m) => (m.includes("/") ? m : `${provider}/${m}`));
      if (parsed.length > 0) return Array.from(new Set(parsed));
    }
  }

  if (stdin.isTTY && stdout.isTTY) {
    const opts = prefixed.map((v) => ({ value: v, label: v }));
    const selected = await multiSelectMenu("Select enabled models:", opts, entry.enabledModels || prefixed.slice(0, 1));
    if (selected.length > 0) return selected;
  } else {
    const sample = prefixed.slice(0, 5).join(", ");
    const raw = (await rl.question(`Enabled models comma-separated [${sample}]: `)).trim();
    if (raw) {
      const parsed = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((m) => (m.includes("/") ? m : `${provider}/${m}`));
      if (parsed.length > 0) return Array.from(new Set(parsed));
    }
  }

  if (prefixed.length > 0) return [prefixed[0]];
  return [];
}

async function chooseDefaultModelFromEnabled(rl, provider, enabledModels, fallbackModel) {
  const list = Array.isArray(enabledModels) && enabledModels.length > 0 ? enabledModels : [fallbackModel].filter(Boolean);
  if (list.length === 0) {
    const customOnly = (await rl.question(`No models available for ${provider}. Enter custom model (${provider}/...): `)).trim();
    if (!customOnly) return "";
    return customOnly.includes("/") ? customOnly : `${provider}/${customOnly}`;
  }

  if (stdin.isTTY && stdout.isTTY) {
    const options = list.map((m) => ({ value: m, label: m }));
    options.push({ value: "__custom__", label: "Custom model..." });
    const idx = Math.max(0, options.findIndex((o) => o.value === fallbackModel));
    const picked = await selectMenu("Select default model:", options, idx >= 0 ? idx : 0);
    if (picked === "__custom__") {
      const custom = (await rl.question(`Custom model (${provider}/...): `)).trim();
      if (!custom) return list[0];
      return custom.includes("/") ? custom : `${provider}/${custom}`;
    }
    return picked;
  }

  const input = (await rl.question(`Default model [${list[0]}]: `)).trim();
  return input || list[0];
}

function getProviderStatus(provider, providersConfig, agentConfig) {
  const installed = !!(
    providersConfig &&
    providersConfig.providers &&
    Object.prototype.hasOwnProperty.call(providersConfig.providers, provider)
  );
  const isDefault = !!(
    agentConfig &&
    agentConfig.runtime &&
    agentConfig.runtime.defaultProvider === provider
  );
  if (installed && isDefault) return "installed, default";
  if (installed) return "installed";
  return "not configured";
}

function getProviderMenuOptions(providersConfig, agentConfig) {
  return SORTED_PROVIDERS.map((provider) => ({
    value: provider,
    label: `${PROVIDER_CATALOG[provider].label} (${getProviderStatus(provider, providersConfig, agentConfig)})`,
  }));
}

function getModelMenuOptions(provider) {
  const entry = PROVIDER_CATALOG[provider];
  const models = entry && Array.isArray(entry.models) ? entry.models : [];
  const options = models.map((model) => ({
    value: `${provider}/${model}`,
    label: model,
  }));
  options.push({ value: "__custom__", label: "Custom model" });
  return options;
}

/** Parse basic CLI args for connect wizard. */
function parseArgs(argv) {
  const opts = {
    provider: "",
    configPath: "",
    authConfigPath: "",
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--provider") {
      opts.provider = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (a === "--config") {
      opts.configPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (a === "--auth-config") {
      opts.authConfigPath = argv[i + 1] || "";
      i += 1;
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

function toAbsolutePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return "";
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function validateConfigPath(filePath, displayName, errorCode) {
  const p = String(filePath || "");
  if (!p) {
    throw makeError(errorCode, `Invalid ${displayName} path.`);
  }

  const parent = path.dirname(p);
  if (!fs.existsSync(parent)) {
    throw makeError(errorCode, `Parent directory does not exist for ${displayName}: ${parent}`);
  }

  let parentStat;
  try {
    parentStat = fs.statSync(parent);
  } catch (err) {
    throw makeError(errorCode, `Cannot access parent directory for ${displayName}: ${parent} (${err.message})`);
  }
  if (!parentStat.isDirectory()) {
    throw makeError(errorCode, `Parent path is not a directory for ${displayName}: ${parent}`);
  }

  if (fs.existsSync(p)) {
    let st;
    try {
      st = fs.statSync(p);
    } catch (err) {
      throw makeError(errorCode, `Cannot access ${displayName}: ${p} (${err.message})`);
    }
    if (st.isDirectory()) {
      throw makeError(errorCode, `${displayName} path points to a directory, expected a file: ${p}`);
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
      // ignore chmod issues
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw makeError(errorCode, `Failed to write ${displayName}: ${err.message}`);
  }
}

function resolveConfigPaths(opts) {
  return {
    agentConfigPath: toAbsolutePath(opts && opts.configPath) || DEFAULT_AGENT_CONFIG_FILE,
    authConfigPath: toAbsolutePath(opts && opts.authConfigPath) || DEFAULT_AUTH_CONFIG_FILE,
  };
}

/** Print usage/help text. */
function printHelp() {
  const providerLines = SORTED_PROVIDERS.map((p) => `  ${p}`);
  const txt = [
    "Usage:",
    "  node agent-connect.js [--provider <name>] [options]",
    "",
    "Provider options:",
    ...providerLines,
    "",
    "Examples:",
    "  node agent-connect.js",
    "  node agent-connect.js --provider openai",
    "  node agent-connect.js --provider copilot",
    "",
    "Options:",
    "  --provider <name>  Choose provider without menu",
    "  --config <path>    Path to agent.json (default: ./agent.json)",
    "  --auth-config <path> Path to agent.auth.json (default: ./agent.auth.json)",
    "  -V, --version   Show version",
    "  -h, --help      Show help",
    "",
    "Tip:",
    "  In interactive TTY: use Up/Down + Enter",
  ].join("\n");

  process.stdout.write(`${txt}\n`);
}

/**
 * Load or initialize provider config.
 * Returns a complete object shape so callers can mutate safely.
 */
function loadConfig(authConfigFilePath) {
  const filePath = authConfigFilePath || DEFAULT_AUTH_CONFIG_FILE;
  validateConfigPath(filePath, "agent.auth.json", ERROR_CODES.AUTH_CONFIG_INVALID);
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      defaultProvider: "",
      defaultModel: "",
      providers: {},
    };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    throw makeError(
      ERROR_CODES.AUTH_CONFIG_INVALID,
      `agent.auth.json contains invalid JSON: ${parseErr.message}`
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw makeError(
      ERROR_CODES.AUTH_CONFIG_INVALID,
      "agent.auth.json is invalid (JSON format). Re-run setup: node agent-connect.js"
    );
  }
  if (!parsed.providers || typeof parsed.providers !== "object") {
    parsed.providers = {};
  }
  if (!parsed.version) parsed.version = 1;
  if (!parsed.defaultProvider) parsed.defaultProvider = "";
  if (!parsed.defaultModel) parsed.defaultModel = "";
  return parsed;
}

function defaultAgentConfig() {
  return {
    version: 1,
    runtime: {
      defaultProvider: "",
      defaultModel: "",
      defaultMode: "build",
      defaultApprovalMode: "ask",
      defaultToolsMode: "auto",
      commandTimeoutMs: 10000,
      allowInsecureHttp: false,
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
            "npm -v"
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
            "docker"
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

function loadAgentConfig(agentConfigFilePath) {
  const defaults = defaultAgentConfig();
  const filePath = agentConfigFilePath || DEFAULT_AGENT_CONFIG_FILE;
  validateConfigPath(filePath, "agent.json", ERROR_CODES.AGENT_CONFIG_INVALID);
  if (!fs.existsSync(filePath)) return defaults;

  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    throw makeError(ERROR_CODES.AGENT_CONFIG_INVALID, `agent.json contains invalid JSON: ${parseErr.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw makeError(ERROR_CODES.AGENT_CONFIG_INVALID, "agent.json is invalid (JSON format). Please check the file.");
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

/** Persist config with restrictive local file permissions. */
function saveConfig(config, authConfigFilePath) {
  const filePath = authConfigFilePath || DEFAULT_AUTH_CONFIG_FILE;
  validateConfigPath(filePath, "agent.auth.json", ERROR_CODES.AUTH_CONFIG_INVALID);
  writeJsonAtomic(filePath, config, 0o600, ERROR_CODES.AUTH_CONFIG_INVALID, "agent.auth.json");
}

function saveAgentConfig(config, agentConfigFilePath) {
  const filePath = agentConfigFilePath || DEFAULT_AGENT_CONFIG_FILE;
  validateConfigPath(filePath, "agent.json", ERROR_CODES.AGENT_CONFIG_INVALID);
  writeJsonAtomic(filePath, config, 0o600, ERROR_CODES.AGENT_CONFIG_INVALID, "agent.json");
}

/** Normalize provider aliases to canonical identifiers used in config. */
function normalizeProvider(input) {
  const p = (input || "").trim().toLowerCase();
  if (p === "github" || p === "github-copilot" || p === "copilot") return "copilot";
  if (p === "x.ai") return "xai";
  if (p === "ollama-local") return "ollama";
  if (p === "lm-studio" || p === "lm_studio") return "lmstudio";
  if (Object.prototype.hasOwnProperty.call(PROVIDER_CATALOG, p)) return p;
  return "";
}

/** Interactive provider selector for users not passing --provider. */
async function chooseProvider(rl, providersConfig, agentConfig) {
  if (stdin.isTTY && stdout.isTTY) {
    const options = getProviderMenuOptions(providersConfig, agentConfig).concat([
      { value: "__models_dev__", label: "Load provider from models.dev..." },
    ]);
    return selectMenu("Select provider:", options, 0);
  }

  const answer = await rl.question(`Provider (${SORTED_PROVIDERS.join("/")}): `);
  const p = normalizeProvider(answer);
  if (!p) {
    throw makeError(ERROR_CODES.PROVIDER_INVALID, `Unknown provider. Allowed: ${SORTED_PROVIDERS.join(", ")}.`);
  }
  return p;
}

async function chooseProviderFromModelsDev(rl) {
  const registry = await fetchModelsDevRegistry();
  const candidates = getModelsDevProviderCandidates(registry);
  if (candidates.length === 0) {
    throw makeError(ERROR_CODES.PROVIDER_INVALID, "No provider candidates with API URLs found on models.dev.");
  }

  if (stdin.isTTY && stdout.isTTY) {
    const options = candidates.map((c) => ({
      value: c.id,
      label: `${c.label} - ${c.baseUrl}`,
    }));
    const selectedId = await selectMenu("Select provider from models.dev:", options, 0);
    return candidates.find((c) => c.id === selectedId) || candidates[0];
  }

  const ids = candidates.map((c) => c.id);
  const answer = (await rl.question(`Provider id from models.dev (${ids.join("/")}): `)).trim();
  const found = candidates.find((c) => c.id === answer);
  return found || candidates[0];
}

async function setupModelsDevProvider(rl, providersConfig, agentConfig, candidate) {
  const providerId = normalizeProviderSlug(candidate && candidate.id ? candidate.id : "") || "custom-provider";
  const defaultBase = candidate && candidate.baseUrl ? candidate.baseUrl : "https://api.openai.com/v1";
  const baseUrl = (await rl.question(`Base URL [${defaultBase}]: `)).trim() || defaultBase;
  const apiKey = (await rl.question(`${candidate && candidate.name ? candidate.name : providerId} API key: `)).trim();
  if (!apiKey) {
    throw makeError(ERROR_CODES.API_KEY_REQUIRED, "API key is required. Aborting setup.");
  }

  const entry = {
    kind: "openai_compatible",
    baseUrl,
    apiKey,
  };

  entry.enabledModels = await chooseEnabledModels(
    rl,
    providerId,
    { models: Array.isArray(candidate && candidate.models) ? candidate.models : [] },
    entry
  );
  providersConfig.providers[providerId] = entry;

  const setDefault = await askYesNo(rl, `Set '${providerId}' as default provider?`, true);
  if (setDefault) {
    agentConfig.runtime.defaultProvider = providerId;
    const fallbackModel = entry.enabledModels && entry.enabledModels.length > 0 ? entry.enabledModels[0] : `${providerId}/model`;
    const selectedDefault = await chooseDefaultModelFromEnabled(rl, providerId, entry.enabledModels || [], fallbackModel);
    if (selectedDefault) agentConfig.runtime.defaultModel = selectedDefault;
  }
}

/** Small helper for yes/no prompts with default behavior. */
async function askYesNo(rl, question, yesDefault) {
  const suffix = yesDefault ? " [Y/n]: " : " [y/N]: ";
  const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
  if (!answer) return yesDefault;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return yesDefault;
}

async function chooseMainAction(rl) {
  if (stdin.isTTY && stdout.isTTY) {
    const options = [
      { value: "setup", label: "Setup or reconfigure provider" },
      { value: "switch_default", label: "Set default provider/model only" },
      { value: "exit", label: "Exit" },
    ];
    return selectMenu("Select action:", options, 0);
  }

  const action = (await rl.question("Action [setup/switch_default/exit] (default: setup): ")).trim().toLowerCase();
  if (action === "switch_default" || action === "exit") return action;
  return "setup";
}

async function chooseConfiguredProvider(rl, providersConfig, agentConfig) {
  const configured = SORTED_PROVIDERS.filter((p) => providersConfig.providers && providersConfig.providers[p]);
  if (configured.length === 0) {
    throw makeError(ERROR_CODES.PROVIDER_INVALID, "No configured providers found.");
  }

  if (stdin.isTTY && stdout.isTTY) {
    const options = configured.map((p) => {
      const label = PROVIDER_CATALOG[p] ? PROVIDER_CATALOG[p].label : p;
      const isDefault = !!(agentConfig && agentConfig.runtime && agentConfig.runtime.defaultProvider === p);
      return { value: p, label: isDefault ? `${label} (default)` : label };
    });
    return selectMenu("Select configured provider:", options, 0);
  }

  const answer = (await rl.question(`Configured provider (${configured.join("/")}): `)).trim().toLowerCase();
  if (configured.includes(answer)) return answer;
  return configured[0];
}

async function setDefaultOnlyFlow(rl, providersConfig, agentConfig) {
  const provider = await chooseConfiguredProvider(rl, providersConfig, agentConfig);
  const entry = providersConfig.providers[provider] || {};
  const providerInfo = PROVIDER_CATALOG[provider] || { models: [] };

  const supportsModelRefresh = entry.kind === "openai_compatible" || entry.kind === "github_copilot";
  if (supportsModelRefresh) {
    const refreshModels = stdin.isTTY && stdout.isTTY
      ? await askYesNo(rl, `Refresh available models for '${provider}' now?`, false)
      : false;
    if (refreshModels) {
      entry.enabledModels = await chooseEnabledModels(rl, provider, providerInfo, entry);
      providersConfig.providers[provider] = entry;
    }
  }

  const fallback = `${provider}/${(PROVIDER_CATALOG[provider] && PROVIDER_CATALOG[provider].models && PROVIDER_CATALOG[provider].models[0]) || ""}`;
  const enabled = Array.isArray(entry.enabledModels) && entry.enabledModels.length > 0
    ? entry.enabledModels
    : [fallback].filter(Boolean);
  const selectedDefault = await chooseDefaultModelFromEnabled(rl, provider, enabled, enabled[0] || "");

  agentConfig.runtime.defaultProvider = provider;
  if (selectedDefault) agentConfig.runtime.defaultModel = selectedDefault;
}

/**
 * Configure API-key providers via openai_compatible transport.
 * Stores apiKey + baseUrl + optional defaults.
 */
async function setupApiProvider(rl, providersConfig, agentConfig, provider) {
  const providerInfo = PROVIDER_CATALOG[provider];
  if (!providerInfo || (providerInfo.type !== "api" && providerInfo.type !== "local")) {
    throw makeError(ERROR_CODES.PROVIDER_UNSUPPORTED, `Provider '${provider}' hat keinen API-Key Setup-Flow.`);
  }

  const defaultBase = providerInfo.baseUrl;
  const baseUrlInput = (await rl.question(`Base URL [${defaultBase}]: `)).trim();
  const baseUrl = baseUrlInput || defaultBase;

  let apiKey = "";
  if (providerInfo.type === "api") {
    const keyPrompt = `${providerInfo.label} API key: `;
    apiKey = (await rl.question(keyPrompt)).trim();
    if (!apiKey && provider !== "custom") {
      throw makeError(ERROR_CODES.API_KEY_REQUIRED, "API key is required. Aborting setup.");
    }
  } else {
    const keyPrompt = `${providerInfo.label} API key (optional): `;
    apiKey = (await rl.question(keyPrompt)).trim();
  }

  const entry = {
    kind: "openai_compatible",
    baseUrl,
  };
  if (apiKey) entry.apiKey = apiKey;

  entry.enabledModels = await chooseEnabledModels(rl, provider, providerInfo, entry);

  providersConfig.providers[provider] = entry;

  const setDefault = await askYesNo(rl, `Set '${provider}' as default provider?`, true);
  if (setDefault) {
    agentConfig.runtime.defaultProvider = provider;
    const fallbackModel = entry.enabledModels && entry.enabledModels.length > 0
      ? entry.enabledModels[0]
      : `${provider}/${providerInfo.models && providerInfo.models[0] ? providerInfo.models[0] : ""}`;
    const selectedDefault = await chooseDefaultModelFromEnabled(rl, provider, entry.enabledModels || [], fallbackModel);
    if (selectedDefault) agentConfig.runtime.defaultModel = selectedDefault;
  }
}

function normalizeProviderSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function setupCustomProvider(rl, providersConfig, agentConfig, suggestedProvider) {
  const defaultSlug = normalizeProviderSlug(suggestedProvider || "custom");
  const slugInput = (await rl.question(`Provider id [${defaultSlug || "custom"}]: `)).trim();
  const providerId = normalizeProviderSlug(slugInput || defaultSlug || "custom");
  if (!providerId) {
    throw makeError(ERROR_CODES.PROVIDER_INVALID, "Custom provider id is required.");
  }

  const baseUrl = (await rl.question("Base URL (OpenAI-compatible) [http://localhost:11434/v1]: ")).trim() || "http://localhost:11434/v1";
  const apiKey = (await rl.question("API key (optional): ")).trim();

  const entry = {
    kind: "openai_compatible",
    baseUrl,
  };
  if (apiKey) entry.apiKey = apiKey;

  entry.enabledModels = await chooseEnabledModels(rl, providerId, { models: [] }, entry);
  providersConfig.providers[providerId] = entry;

  const setDefault = await askYesNo(rl, `Set '${providerId}' as default provider?`, true);
  if (setDefault) {
    agentConfig.runtime.defaultProvider = providerId;
    const fallbackModel = entry.enabledModels && entry.enabledModels.length > 0 ? entry.enabledModels[0] : `${providerId}/model`;
    const selectedDefault = await chooseDefaultModelFromEnabled(rl, providerId, entry.enabledModels || [], fallbackModel);
    if (selectedDefault) agentConfig.runtime.defaultModel = selectedDefault;
  }
}



/**
 * Default Copilot OAuth and API endpoints/headers.
 * Centralized for easy maintenance if provider details change.
 */
function getCopilotDefaults() {
  return {
    oauth: {
      clientId: "Iv1.b507a08c87ecfe98",
      scope: "read:user",
      deviceCodeUrl: "https://github.com/login/device/code",
      accessTokenUrl: "https://github.com/login/oauth/access_token",
    },
    api: {
      copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
      baseUrl: "https://api.githubcopilot.com",
    },
    extraHeaders: {
      "Editor-Version": "vscode/1.85.1",
      "Editor-Plugin-Version": "copilot-chat/0.12.0",
      "User-Agent": "agent.js-copilot",
    },
  };
}

/** Start GitHub device flow and return device code payload. */
async function requestDeviceCode(defaults) {
  const params = new URLSearchParams({
    client_id: defaults.oauth.clientId,
    scope: defaults.oauth.scope,
  });

  const res = await fetchWithTimeout(defaults.oauth.deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw makeError(ERROR_CODES.COPILOT_DEVICE_START_FAILED, `Copilot device start failed: ${detail}`);
  }

  return json;
}

/**
 * Poll GitHub OAuth token endpoint until user completes browser auth.
 * Handles authorization_pending and slow_down states.
 */
async function pollDeviceToken(defaults, deviceCodeData) {
  const started = Date.now();
  const expiresIn = Number(deviceCodeData.expires_in || 900);
  let intervalMs = Number(deviceCodeData.interval || 5) * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) intervalMs = 5000;

  while (Date.now() - started < expiresIn * 1000) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const params = new URLSearchParams({
      client_id: defaults.oauth.clientId,
      device_code: deviceCodeData.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const res = await fetchWithTimeout(defaults.oauth.accessTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const json = await res.json();
    if (json.error === "authorization_pending") {
      continue;
    }
    if (json.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (!res.ok || json.error) {
      const detail = json.error_description || json.error || `HTTP ${res.status}`;
      throw makeError(ERROR_CODES.COPILOT_DEVICE_FLOW_FAILED, `Copilot device flow failed: ${detail}`);
    }

    if (!json.access_token) {
      throw makeError(ERROR_CODES.COPILOT_TOKEN_MISSING, "Copilot device flow returned no access token.");
    }

    return json;
  }

  throw makeError(ERROR_CODES.COPILOT_DEVICE_CODE_EXPIRED, "Copilot device code expired. Please run setup again.");
}

/** Exchange GitHub access token for Copilot runtime token. */
async function fetchCopilotToken(defaults, githubAccessToken) {
  const res = await fetchWithTimeout(defaults.api.copilotTokenUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `token ${githubAccessToken}`,
      ...defaults.extraHeaders,
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.message || `HTTP ${res.status}`;
    throw makeError(ERROR_CODES.COPILOT_RUNTIME_TOKEN_FAILED, `Copilot runtime token request failed: ${detail}`);
  }

  if (!json.token) {
    throw makeError(ERROR_CODES.COPILOT_RUNTIME_TOKEN_MISSING, "Copilot runtime token is missing in response.");
  }

  let expiresAt = "";
  if (json.expires_at) {
    expiresAt = new Date(Number(json.expires_at) * 1000).toISOString();
  } else if (json.expires_at_ms) {
    expiresAt = new Date(Number(json.expires_at_ms)).toISOString();
  } else {
    expiresAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();
  }

  return {
    copilotToken: json.token,
    copilotTokenExpiresAt: expiresAt,
  };
}

/**
 * Full Copilot setup flow:
 * 1) device auth
 * 2) fetch initial Copilot token
 * 3) save tokens and adapter config
 */
async function setupCopilot(rl, providersConfig, agentConfig) {
  const defaults = getCopilotDefaults();

  process.stdout.write("\nStarting Copilot device authentication...\n");
  const device = await requestDeviceCode(defaults);

  process.stdout.write("\n1) Open this URL in your browser:\n");
  process.stdout.write(`${device.verification_uri || device.verification_uri_complete || "https://github.com/login/device"}\n`);
  process.stdout.write("2) Enter this code:\n");
  process.stdout.write(`${device.user_code}\n\n`);
  process.stdout.write("Waiting for confirmation...\n");

  const oauthToken = await pollDeviceToken(defaults, device);
  const githubToken = oauthToken.access_token;
  const githubRefreshToken = oauthToken.refresh_token || "";
  const githubTokenExpiresAt = oauthToken.expires_in
    ? new Date(Date.now() + Number(oauthToken.expires_in) * 1000).toISOString()
    : "";

  const copilot = await fetchCopilotToken(defaults, githubToken);

  providersConfig.providers.copilot = {
    kind: "github_copilot",
    githubToken,
    githubRefreshToken,
    githubTokenExpiresAt,
    copilotToken: copilot.copilotToken,
    copilotTokenExpiresAt: copilot.copilotTokenExpiresAt,
    baseUrl: defaults.api.baseUrl,
    oauth: defaults.oauth,
    api: defaults.api,
    extraHeaders: defaults.extraHeaders,
  };

  providersConfig.providers.copilot.enabledModels = await chooseEnabledModels(
    rl,
    "copilot",
    PROVIDER_CATALOG.copilot,
    providersConfig.providers.copilot
  );

  const setDefault = await askYesNo(rl, "Set 'copilot' as default provider?", true);
  if (setDefault) {
    agentConfig.runtime.defaultProvider = "copilot";
    const fallbackModel =
      providersConfig.providers.copilot.enabledModels && providersConfig.providers.copilot.enabledModels.length > 0
        ? providersConfig.providers.copilot.enabledModels[0]
        : "copilot/gpt-4o";
    const selectedDefault = await chooseDefaultModelFromEnabled(
      rl,
      "copilot",
      providersConfig.providers.copilot.enabledModels || [],
      fallbackModel
    );
    if (selectedDefault) {
      agentConfig.runtime.defaultModel = selectedDefault;
    }
  }
}

/** Main connect wizard entrypoint. */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const paths = resolveConfigPaths(opts);
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    process.stdout.write(`${CONNECT_VERSION}\n`);
    process.exit(0);
  }

  const providersConfig = loadConfig(paths.authConfigPath);
  const agentConfig = loadAgentConfig(paths.agentConfigPath);
  const rl = readlinePromises.createInterface({ input: stdin, output: stdout });

  try {
    const action = opts.provider ? "setup" : await chooseMainAction(rl);
    if (action === "exit") {
      process.stdout.write("Bye.\n");
      return;
    }

    if (action === "switch_default") {
      await setDefaultOnlyFlow(rl, providersConfig, agentConfig);
      saveConfig(providersConfig, paths.authConfigPath);
      saveAgentConfig(agentConfig, paths.agentConfigPath);
      process.stdout.write(`\nSaved: ${paths.authConfigPath}\n`);
      process.stdout.write(`Saved: ${paths.agentConfigPath}\n`);
      return;
    }

    const rawProvider = (opts.provider || "").trim();
    let provider = normalizeProvider(rawProvider);
    const providerWasUnknown = !!rawProvider && !provider;
    if (!provider) {
      provider = await chooseProvider(rl, providersConfig, agentConfig);
    }

    if (provider === "__models_dev__") {
      const candidate = await chooseProviderFromModelsDev(rl);
      await setupModelsDevProvider(rl, providersConfig, agentConfig, candidate);
      provider = "";
    }

    if (provider === "copilot") {
      await setupCopilot(rl, providersConfig, agentConfig);
    } else if (provider === "openai") {
      await setupApiProvider(rl, providersConfig, agentConfig, provider);
    } else if (provider === "custom" || providerWasUnknown) {
      await setupCustomProvider(rl, providersConfig, agentConfig, providerWasUnknown ? rawProvider : "custom");
    } else if (provider && PROVIDER_CATALOG[provider] && (PROVIDER_CATALOG[provider].type === "api" || PROVIDER_CATALOG[provider].type === "local")) {
      await setupApiProvider(rl, providersConfig, agentConfig, provider);
    } else if (provider) {
      throw makeError(ERROR_CODES.PROVIDER_UNSUPPORTED, "Provider is not supported.");
    }

    if (stdin.isTTY && stdout.isTTY) {
      const modeOptions = [
        { value: "plan", label: "plan (strict/read-only style)" },
        { value: "build", label: "build (normal development)" },
        { value: "unsafe", label: "unsafe (broad command scope)" },
      ];
      const defaultModeIndex = Math.max(
        0,
        modeOptions.findIndex((m) => m.value === (agentConfig.runtime.defaultMode || "build"))
      );
      const modeInput = await selectMenu("Select default mode:", modeOptions, defaultModeIndex);
      agentConfig.runtime.defaultMode = modeInput;
      agentConfig.security.mode = modeInput;

      const approvalOptions = [
        { value: "ask", label: "ask (confirm each command)" },
        { value: "auto", label: "auto (run allowed commands directly)" },
        { value: "never", label: "never (block command execution)" },
      ];
      const defaultApprovalIndex = Math.max(
        0,
        approvalOptions.findIndex((a) => a.value === (agentConfig.runtime.defaultApprovalMode || "ask"))
      );
      const approvalInput = await selectMenu("Select default approval mode:", approvalOptions, defaultApprovalIndex);
      agentConfig.runtime.defaultApprovalMode = approvalInput;

      const toolsOptions = [
        { value: "auto", label: "auto (start with tools, fallback to no-tools if needed)" },
        { value: "on", label: "on (always send tools)" },
        { value: "off", label: "off (disable tool-calling)" },
      ];
      const defaultToolsIndex = Math.max(
        0,
        toolsOptions.findIndex((t) => t.value === (agentConfig.runtime.defaultToolsMode || "auto"))
      );
      const toolsInput = await selectMenu("Select default tools mode:", toolsOptions, defaultToolsIndex);
      agentConfig.runtime.defaultToolsMode = toolsInput;
    } else {
      const modeInput = (await rl.question(`Default mode [${agentConfig.runtime.defaultMode || "build"}] (plan/build/unsafe): `))
        .trim()
        .toLowerCase();
      if (modeInput === "plan" || modeInput === "build" || modeInput === "unsafe") {
        agentConfig.runtime.defaultMode = modeInput;
        agentConfig.security.mode = modeInput;
      }

      const approvalInput = (
        await rl.question(
          `Default approval mode [${agentConfig.runtime.defaultApprovalMode || "ask"}] (ask/auto/never): `
        )
      )
        .trim()
        .toLowerCase();
      if (approvalInput === "ask" || approvalInput === "auto" || approvalInput === "never") {
        agentConfig.runtime.defaultApprovalMode = approvalInput;
      }

      const toolsInput = (await rl.question(`Default tools mode [${agentConfig.runtime.defaultToolsMode || "auto"}] (auto/on/off): `))
        .trim()
        .toLowerCase();
      if (toolsInput === "auto" || toolsInput === "on" || toolsInput === "off") {
        agentConfig.runtime.defaultToolsMode = toolsInput;
      }
    }

    saveConfig(providersConfig, paths.authConfigPath);
    saveAgentConfig(agentConfig, paths.agentConfigPath);

    process.stdout.write(`\nSaved: ${paths.authConfigPath}\n`);
    process.stdout.write(`Saved: ${paths.agentConfigPath}\n`);
    process.stdout.write("Note: file contains plaintext secrets. Do not commit.\n");
  } finally {
    rl.close();
  }
}

/** Top-level error boundary for readable CLI failures. */
if (require.main === module) {
  /** Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM. */
  function handleSignal(signal) {
    process.stderr.write(`\nReceived ${signal}, exiting.\n`);
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  main().catch((err) => {
    const msg = redactSensitiveText(err && err.message ? err.message : String(err));
    const code = getErrorCode(err, ERROR_CODES.CONNECT_ERROR);
    const exitCode = getExitCodeForError(err);
    process.stderr.write(`Error [${code}]: ${msg}\n`);
    process.exit(exitCode);
  });
}

module.exports = {
  ERROR_CODES,
  fetchWithTimeout,
  makeError,
  redactSensitiveText,
  getErrorCode,
  getExitCodeForError,
  getMenuWindow,
  truncateForTerminal,
  getProviderMenuOptions,
  getModelMenuOptions,
  parseArgs,
  resolveConfigPaths,
  validateConfigPath,
  writeJsonAtomic,
  normalizeProvider,
  normalizeProviderSlug,
  getModelsDevProviderKeys,
  extractModelsFromModelsDevEntry,
  getModelsDevProviderCandidates,
  defaultAgentConfig,
  getCopilotDefaults,
};
