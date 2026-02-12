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
const AGENT_CONFIG_FILE = path.resolve(process.cwd(), "agent.json");
const AUTH_CONFIG_FILE = path.resolve(process.cwd(), "agent.auth.json");
const CONNECT_VERSION = "0.3.1";

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
};

const SORTED_PROVIDERS = Object.keys(PROVIDER_CATALOG).sort((a, b) => a.localeCompare(b));

function makeError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Simple interactive select menu using arrow keys + Enter.
 * Falls back to initial option in non-TTY environments.
 */
async function selectMenu(message, options, initialIndex = 0) {
  if (!Array.isArray(options) || options.length === 0) {
    throw makeError("SELECT_OPTIONS_EMPTY", "Wizard options are missing.");
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return options[Math.max(0, Math.min(initialIndex, options.length - 1))].value;
  }

  let selected = Math.max(0, Math.min(initialIndex, options.length - 1));
  let renderedLines = 0;

  const render = () => {
    if (renderedLines > 0) {
      for (let i = 0; i < renderedLines; i += 1) {
        stdout.write("\x1b[1A\x1b[2K\r");
      }
    }

    const lines = [
      `${message}`,
      ...options.map((opt, idx) => `${idx === selected ? ">" : " "} ${opt.label}`),
      "Use Up/Down and Enter.",
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
        fail(makeError("INTERRUPTED", "Wizard interrupted."));
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

      if (key.name === "return") {
        finish(options[selected].value);
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

function getProviderMenuOptions() {
  return SORTED_PROVIDERS.map((provider) => ({
    value: provider,
    label: PROVIDER_CATALOG[provider].label,
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
function loadConfig() {
  if (!fs.existsSync(AUTH_CONFIG_FILE)) {
    return {
      version: 1,
      defaultProvider: "",
      defaultModel: "",
      providers: {},
    };
  }

  const raw = fs.readFileSync(AUTH_CONFIG_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw makeError(
      "AUTH_CONFIG_INVALID",
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

function loadAgentConfig() {
  const defaults = defaultAgentConfig();
  if (!fs.existsSync(AGENT_CONFIG_FILE)) return defaults;

  const raw = fs.readFileSync(AGENT_CONFIG_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw makeError("AGENT_CONFIG_INVALID", "agent.json is invalid (JSON format). Please check the file.");
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
function saveConfig(config) {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(AUTH_CONFIG_FILE, body, { mode: 0o600 });
  try {
    fs.chmodSync(AUTH_CONFIG_FILE, 0o600);
  } catch {
    // ignore chmod issues
  }
}

function saveAgentConfig(config) {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(AGENT_CONFIG_FILE, body, { mode: 0o600 });
  try {
    fs.chmodSync(AGENT_CONFIG_FILE, 0o600);
  } catch {
    // ignore chmod issues
  }
}

/** Normalize provider aliases to canonical identifiers used in config. */
function normalizeProvider(input) {
  const p = (input || "").trim().toLowerCase();
  if (p === "github" || p === "github-copilot" || p === "copilot") return "copilot";
  if (p === "x.ai") return "xai";
  if (Object.prototype.hasOwnProperty.call(PROVIDER_CATALOG, p)) return p;
  return "";
}

/** Interactive provider selector for users not passing --provider. */
async function chooseProvider(rl) {
  if (stdin.isTTY && stdout.isTTY) {
    return selectMenu("Select provider:", getProviderMenuOptions(), 0);
  }

  const answer = await rl.question(`Provider (${SORTED_PROVIDERS.join("/")}): `);
  const p = normalizeProvider(answer);
  if (!p) {
    throw makeError("PROVIDER_INVALID", `Unknown provider. Allowed: ${SORTED_PROVIDERS.join(", ")}.`);
  }
  return p;
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

/**
 * Configure API-key providers via openai_compatible transport.
 * Stores apiKey + baseUrl + optional defaults.
 */
async function setupApiProvider(rl, providersConfig, agentConfig, provider) {
  const providerInfo = PROVIDER_CATALOG[provider];
  if (!providerInfo || providerInfo.type !== "api") {
    throw makeError("PROVIDER_UNSUPPORTED", `Provider '${provider}' hat keinen API-Key Setup-Flow.`);
  }

  const keyPrompt = `${providerInfo.label} API key: `;
  const apiKey = (await rl.question(keyPrompt)).trim();
  if (!apiKey) {
    throw makeError("API_KEY_REQUIRED", "API key is required. Aborting setup.");
  }

  const defaultBase = providerInfo.baseUrl;
  const baseUrlInput = (await rl.question(`Base URL [${defaultBase}]: `)).trim();

  providersConfig.providers[provider] = {
    kind: "openai_compatible",
    baseUrl: baseUrlInput || defaultBase,
    apiKey,
  };

  const setDefault = await askYesNo(rl, `Set '${provider}' as default provider?`, true);
  if (setDefault) {
    agentConfig.runtime.defaultProvider = provider;
    if (stdin.isTTY && stdout.isTTY) {
      const picked = await selectMenu("Select default model:", getModelMenuOptions(provider), 0);
      if (picked === "__custom__") {
        const custom = (await rl.question(`Custom model (${provider}/...): `)).trim();
        if (custom) {
          agentConfig.runtime.defaultModel = custom;
        }
      } else {
        agentConfig.runtime.defaultModel = picked;
      }
    } else {
      const modelSuggestion = `${provider}/${providerInfo.models[0]}`;
      const modelInput = (await rl.question(`Default model [${modelSuggestion}]: `)).trim();
      agentConfig.runtime.defaultModel = modelInput || modelSuggestion;
    }
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

  const res = await fetch(defaults.oauth.deviceCodeUrl, {
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
    throw makeError("COPILOT_DEVICE_START_FAILED", `Copilot device start failed: ${detail}`);
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

    const res = await fetch(defaults.oauth.accessTokenUrl, {
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
      throw makeError("COPILOT_DEVICE_FLOW_FAILED", `Copilot device flow failed: ${detail}`);
    }

    if (!json.access_token) {
      throw makeError("COPILOT_TOKEN_MISSING", "Copilot device flow returned no access token.");
    }

    return json;
  }

  throw makeError("COPILOT_DEVICE_CODE_EXPIRED", "Copilot device code expired. Please run setup again.");
}

/** Exchange GitHub access token for Copilot runtime token. */
async function fetchCopilotToken(defaults, githubAccessToken) {
  const res = await fetch(defaults.api.copilotTokenUrl, {
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
    throw makeError("COPILOT_RUNTIME_TOKEN_FAILED", `Copilot runtime token request failed: ${detail}`);
  }

  if (!json.token) {
    throw makeError("COPILOT_RUNTIME_TOKEN_MISSING", "Copilot runtime token is missing in response.");
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
    oauth: defaults.oauth,
    api: defaults.api,
    extraHeaders: defaults.extraHeaders,
  };

  const setDefault = await askYesNo(rl, "Set 'copilot' as default provider?", true);
  if (setDefault) {
    agentConfig.runtime.defaultProvider = "copilot";
    if (stdin.isTTY && stdout.isTTY) {
      const picked = await selectMenu("Select default model:", getModelMenuOptions("copilot"), 0);
      if (picked === "__custom__") {
        const custom = (await rl.question("Custom model (copilot/...): ")).trim();
        if (custom) {
          agentConfig.runtime.defaultModel = custom;
        }
      } else {
        agentConfig.runtime.defaultModel = picked;
      }
    } else {
      const defaultModel = "copilot/gpt-4o";
      const modelInput = (await rl.question(`Default model [${defaultModel}]: `)).trim();
      agentConfig.runtime.defaultModel = modelInput || defaultModel;
    }
  }
}

/** Main connect wizard entrypoint. */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    process.stdout.write(`${CONNECT_VERSION}\n`);
    process.exit(0);
  }

  const providersConfig = loadConfig();
  const agentConfig = loadAgentConfig();
  const rl = readlinePromises.createInterface({ input: stdin, output: stdout });

  try {
    let provider = normalizeProvider(opts.provider);
    if (!provider) {
      provider = await chooseProvider(rl);
    }

    if (provider === "copilot") {
      await setupCopilot(rl, providersConfig, agentConfig);
    } else if (PROVIDER_CATALOG[provider] && PROVIDER_CATALOG[provider].type === "api") {
      await setupApiProvider(rl, providersConfig, agentConfig, provider);
    } else {
      throw makeError("PROVIDER_UNSUPPORTED", "Provider is not supported.");
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

    saveConfig(providersConfig);
    saveAgentConfig(agentConfig);

    process.stdout.write(`\nSaved: ${AUTH_CONFIG_FILE}\n`);
    process.stdout.write(`Saved: ${AGENT_CONFIG_FILE}\n`);
    process.stdout.write("Note: file contains plaintext secrets. Do not commit.\n");
  } finally {
    rl.close();
  }
}

/** Top-level error boundary for readable CLI failures. */
main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  const code = err && err.code ? err.code : "CONNECT_ERROR";
  process.stderr.write(`Error [${code}]: ${msg}\n`);
  process.exit(1);
});
