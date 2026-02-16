/**
 * Unit tests for pure functions exported from agent-connect.js.
 * Uses Node.js built-in test runner (node:test) — zero dependencies.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
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
} = require("../agent-connect.js");

// ---------------------------------------------------------------------------
// ERROR_CODES
// ---------------------------------------------------------------------------
describe("ERROR_CODES (connect)", () => {
  it("exports all expected error codes", () => {
    const expected = [
      "SELECT_OPTIONS_EMPTY",
      "INTERRUPTED",
      "AUTH_CONFIG_INVALID",
      "AGENT_CONFIG_INVALID",
      "PROVIDER_INVALID",
      "PROVIDER_UNSUPPORTED",
      "API_KEY_REQUIRED",
      "COPILOT_DEVICE_START_FAILED",
      "COPILOT_DEVICE_FLOW_FAILED",
      "COPILOT_TOKEN_MISSING",
      "COPILOT_DEVICE_CODE_EXPIRED",
      "COPILOT_RUNTIME_TOKEN_FAILED",
      "COPILOT_RUNTIME_TOKEN_MISSING",
      "CONNECT_ERROR",
      "FETCH_TIMEOUT",
    ];
    for (const code of expected) {
      assert.equal(ERROR_CODES[code], code);
    }
  });

  it("key equals value for every entry", () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      assert.equal(key, value);
    }
  });
});

// ---------------------------------------------------------------------------
// makeError
// ---------------------------------------------------------------------------
describe("makeError", () => {
  it("creates an Error with code property", () => {
    const err = makeError("TEST_CODE", "test message");
    assert.ok(err instanceof Error);
    assert.equal(err.message, "test message");
    assert.equal(err.code, "TEST_CODE");
  });

  it("creates errors with different codes", () => {
    const err = makeError(ERROR_CODES.INTERRUPTED, "interrupted");
    assert.equal(err.code, "INTERRUPTED");
    assert.equal(err.message, "interrupted");
  });
});

// ---------------------------------------------------------------------------
// getProviderMenuOptions
// ---------------------------------------------------------------------------
describe("getProviderMenuOptions", () => {
  it("returns an array of provider options", () => {
    const options = getProviderMenuOptions();
    assert.ok(Array.isArray(options));
    assert.ok(options.length > 0);
  });

  it("each option has value and label", () => {
    const options = getProviderMenuOptions();
    for (const opt of options) {
      assert.ok(typeof opt.value === "string");
      assert.ok(typeof opt.label === "string");
      assert.ok(opt.value.length > 0);
      assert.ok(opt.label.length > 0);
    }
  });

  it("options are sorted alphabetically by value", () => {
    const options = getProviderMenuOptions();
    const values = options.map((o) => o.value);
    const sorted = [...values].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(values, sorted);
  });

  it("includes known providers", () => {
    const options = getProviderMenuOptions();
    const values = options.map((o) => o.value);
    assert.ok(values.includes("copilot"));
    assert.ok(values.includes("openai"));
    assert.ok(values.includes("groq"));
    assert.ok(values.includes("ollama"));
    assert.ok(values.includes("lmstudio"));
  });

  it("marks default provider in label when config is provided", () => {
    const providersConfig = { providers: { openai: { kind: "openai_compatible", apiKey: "x" } } };
    const agentConfig = { runtime: { defaultProvider: "openai" } };
    const options = getProviderMenuOptions(providersConfig, agentConfig);
    const openai = options.find((o) => o.value === "openai");
    assert.ok(openai);
    assert.ok(openai.label.includes("installed, default"));
  });
});

// ---------------------------------------------------------------------------
// getModelMenuOptions
// ---------------------------------------------------------------------------
describe("getModelMenuOptions", () => {
  it("returns model options for a valid provider", () => {
    const options = getModelMenuOptions("openai");
    assert.ok(Array.isArray(options));
    assert.ok(options.length >= 2); // at least one model + custom
  });

  it("always includes Custom model as last option", () => {
    const options = getModelMenuOptions("openai");
    const last = options[options.length - 1];
    assert.equal(last.value, "__custom__");
    assert.equal(last.label, "Custom model");
  });

  it("model values have provider/ prefix", () => {
    const options = getModelMenuOptions("groq");
    const modelOptions = options.filter((o) => o.value !== "__custom__");
    for (const opt of modelOptions) {
      assert.ok(opt.value.startsWith("groq/"), `Expected groq/ prefix, got: ${opt.value}`);
    }
  });

  it("returns only custom option for unknown provider", () => {
    const options = getModelMenuOptions("unknown_provider");
    assert.equal(options.length, 1);
    assert.equal(options[0].value, "__custom__");
  });

  it("returns only custom option for copilot (oauth type, no models array)", () => {
    const options = getModelMenuOptions("copilot");
    // copilot has no models array in PROVIDER_CATALOG
    assert.equal(options[options.length - 1].value, "__custom__");
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------
describe("parseArgs (connect)", () => {
  it("returns defaults for empty argv", () => {
    const opts = parseArgs([]);
    assert.equal(opts.provider, "");
    assert.equal(opts.configPath, "");
    assert.equal(opts.authConfigPath, "");
    assert.equal(opts.help, false);
    assert.equal(opts.version, false);
  });

  it("parses --provider", () => {
    const opts = parseArgs(["--provider", "openai"]);
    assert.equal(opts.provider, "openai");
  });

  it("parses -h / --help", () => {
    assert.equal(parseArgs(["-h"]).help, true);
    assert.equal(parseArgs(["--help"]).help, true);
  });

  it("parses -V / --version", () => {
    assert.equal(parseArgs(["-V"]).version, true);
    assert.equal(parseArgs(["--version"]).version, true);
  });

  it("handles combined flags", () => {
    const opts = parseArgs(["--provider", "copilot", "--help"]);
    assert.equal(opts.provider, "copilot");
    assert.equal(opts.help, true);
  });

  it("handles missing --provider value gracefully", () => {
    const opts = parseArgs(["--provider"]);
    assert.equal(opts.provider, "");
  });

  it("parses --config and --auth-config", () => {
    const opts = parseArgs(["--config", "cfg/agent.json", "--auth-config", "cfg/agent.auth.json"]);
    assert.equal(opts.configPath, "cfg/agent.json");
    assert.equal(opts.authConfigPath, "cfg/agent.auth.json");
  });
});

// ---------------------------------------------------------------------------
// resolveConfigPaths
// ---------------------------------------------------------------------------
describe("resolveConfigPaths (connect)", () => {
  it("returns default paths when args are empty", () => {
    const resolved = resolveConfigPaths({ configPath: "", authConfigPath: "" });
    assert.ok(path.isAbsolute(resolved.agentConfigPath));
    assert.ok(path.isAbsolute(resolved.authConfigPath));
    assert.ok(resolved.agentConfigPath.endsWith("agent.json"));
    assert.ok(resolved.authConfigPath.endsWith("agent.auth.json"));
  });

  it("resolves relative paths", () => {
    const resolved = resolveConfigPaths({
      configPath: "cfg/agent.custom.json",
      authConfigPath: "cfg/agent.auth.custom.json",
    });
    assert.ok(path.isAbsolute(resolved.agentConfigPath));
    assert.ok(path.isAbsolute(resolved.authConfigPath));
    assert.ok(resolved.agentConfigPath.endsWith(path.join("cfg", "agent.custom.json")));
    assert.ok(resolved.authConfigPath.endsWith(path.join("cfg", "agent.auth.custom.json")));
  });
});

// ---------------------------------------------------------------------------
// validateConfigPath / writeJsonAtomic (connect)
// ---------------------------------------------------------------------------
describe("validateConfigPath (connect)", () => {
  it("throws AUTH_CONFIG_INVALID when parent directory is missing", () => {
    const missing = path.join(os.tmpdir(), `connect-missing-${Date.now()}`, "agent.auth.json");
    assert.throws(
      () => validateConfigPath(missing, "agent.auth.json", ERROR_CODES.AUTH_CONFIG_INVALID),
      (err) => {
        assert.equal(err.code, ERROR_CODES.AUTH_CONFIG_INVALID);
        return true;
      }
    );
  });
});

describe("writeJsonAtomic (connect)", () => {
  it("writes JSON using atomic flow", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-atomic-"));
    const target = path.join(dir, "agent.json");
    try {
      writeJsonAtomic(target, { version: 1 }, 0o600, ERROR_CODES.AGENT_CONFIG_INVALID, "agent.json");
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      assert.equal(parsed.version, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeProvider
// ---------------------------------------------------------------------------
describe("normalizeProvider", () => {
  it("normalizes copilot aliases", () => {
    assert.equal(normalizeProvider("copilot"), "copilot");
    assert.equal(normalizeProvider("github"), "copilot");
    assert.equal(normalizeProvider("github-copilot"), "copilot");
  });

  it("normalizes xAI alias", () => {
    assert.equal(normalizeProvider("x.ai"), "xai");
    assert.equal(normalizeProvider("xai"), "xai");
  });

  it("passes through known providers unchanged", () => {
    assert.equal(normalizeProvider("openai"), "openai");
    assert.equal(normalizeProvider("groq"), "groq");
    assert.equal(normalizeProvider("deepseek"), "deepseek");
    assert.equal(normalizeProvider("openrouter"), "openrouter");
    assert.equal(normalizeProvider("perplexity"), "perplexity");
  });

  it("is case-insensitive", () => {
    assert.equal(normalizeProvider("OpenAI"), "openai");
    assert.equal(normalizeProvider("COPILOT"), "copilot");
    assert.equal(normalizeProvider("GitHub"), "copilot");
  });

  it("trims whitespace", () => {
    assert.equal(normalizeProvider("  openai  "), "openai");
  });

  it("returns empty string for unknown providers", () => {
    assert.equal(normalizeProvider("unknown"), "");
    assert.equal(normalizeProvider("notaprovider"), "");
  });

  it("returns empty string for falsy input", () => {
    assert.equal(normalizeProvider(""), "");
    assert.equal(normalizeProvider(null), "");
    assert.equal(normalizeProvider(undefined), "");
  });

  it("normalizes local provider aliases", () => {
    assert.equal(normalizeProvider("lm-studio"), "lmstudio");
    assert.equal(normalizeProvider("ollama-local"), "ollama");
  });
});

describe("normalizeProviderSlug", () => {
  it("normalizes arbitrary provider ids to safe slug", () => {
    assert.equal(normalizeProviderSlug("My Provider!"), "my-provider");
    assert.equal(normalizeProviderSlug("  OpenAI-Compatible  "), "openai-compatible");
  });
});

describe("getModelsDevProviderKeys", () => {
  it("maps known provider aliases", () => {
    const keys = getModelsDevProviderKeys("copilot", "https://api.githubcopilot.com");
    assert.ok(keys.includes("copilot"));
    assert.ok(keys.includes("github-copilot"));
  });

  it("derives keys from base URL host", () => {
    const keys = getModelsDevProviderKeys("custom", "https://api.groq.com/openai/v1");
    assert.ok(keys.includes("groq"));
  });
});

describe("extractModelsFromModelsDevEntry", () => {
  it("extracts model ids from models object", () => {
    const ids = extractModelsFromModelsDevEntry({
      models: {
        "model-a": {},
        "model-b": {},
      },
    });
    assert.deepEqual(ids, ["model-a", "model-b"]);
  });

  it("returns empty array for invalid entry", () => {
    assert.deepEqual(extractModelsFromModelsDevEntry(null), []);
    assert.deepEqual(extractModelsFromModelsDevEntry({ models: null }), []);
  });
});

describe("getModelsDevProviderCandidates", () => {
  it("returns providers with api URLs not in built-in catalog", () => {
    const registry = {
      openai: { id: "openai", name: "OpenAI", api: "https://api.openai.com/v1", models: { "gpt-4o": {} } },
      myprovider: { id: "myprovider", name: "My Provider", api: "https://api.myprovider.com/v1", models: { "model-x": {} } },
    };
    const candidates = getModelsDevProviderCandidates(registry);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, "myprovider");
    assert.equal(candidates[0].baseUrl, "https://api.myprovider.com/v1");
    assert.ok(candidates[0].models.includes("model-x"));
  });

  it("ignores entries without api field", () => {
    const registry = {
      providerA: { id: "providerA", name: "Provider A" },
    };
    const candidates = getModelsDevProviderCandidates(registry);
    assert.equal(candidates.length, 0);
  });
});

// ---------------------------------------------------------------------------
// defaultAgentConfig (connect)
// ---------------------------------------------------------------------------
describe("defaultAgentConfig (connect)", () => {
  it("returns a valid config object", () => {
    const cfg = defaultAgentConfig();
    assert.equal(cfg.version, 1);
    assert.ok(cfg.runtime);
    assert.ok(cfg.security);
  });

  it("has same structure as agent.js defaultAgentConfig", () => {
    const cfg = defaultAgentConfig();
    assert.equal(cfg.runtime.profile, "dev");
    assert.equal(cfg.runtime.defaultApprovalMode, "ask");
    assert.equal(cfg.runtime.defaultToolsMode, "auto");
    assert.equal(cfg.runtime.maxToolTurns, 10);
    assert.ok(Array.isArray(cfg.security.denyCritical));
    assert.ok(cfg.security.modes.safe);
    assert.ok(cfg.security.modes.dev);
    assert.ok(cfg.security.modes.framework);
  });

  it("returns fresh object each call", () => {
    const a = defaultAgentConfig();
    const b = defaultAgentConfig();
    assert.notEqual(a, b);
    assert.notEqual(a.runtime, b.runtime);
  });
});

// ---------------------------------------------------------------------------
// getCopilotDefaults
// ---------------------------------------------------------------------------
describe("getCopilotDefaults", () => {
  it("returns oauth configuration", () => {
    const defaults = getCopilotDefaults();
    assert.ok(defaults.oauth);
    assert.ok(defaults.oauth.clientId);
    assert.ok(defaults.oauth.deviceCodeUrl);
    assert.ok(defaults.oauth.accessTokenUrl);
  });

  it("returns api configuration", () => {
    const defaults = getCopilotDefaults();
    assert.ok(defaults.api);
    assert.ok(defaults.api.copilotTokenUrl);
    assert.ok(defaults.api.baseUrl);
  });

  it("returns extra headers", () => {
    const defaults = getCopilotDefaults();
    assert.ok(defaults.extraHeaders);
    assert.ok(defaults.extraHeaders["Editor-Version"]);
    assert.ok(defaults.extraHeaders["User-Agent"]);
  });

  it("returns fresh object each call", () => {
    const a = getCopilotDefaults();
    const b = getCopilotDefaults();
    assert.notEqual(a, b);
    assert.notEqual(a.oauth, b.oauth);
  });

  it("has valid GitHub OAuth endpoints", () => {
    const defaults = getCopilotDefaults();
    assert.ok(defaults.oauth.deviceCodeUrl.includes("github.com"));
    assert.ok(defaults.oauth.accessTokenUrl.includes("github.com"));
    assert.ok(defaults.api.copilotTokenUrl.includes("github.com"));
  });
});

// ---------------------------------------------------------------------------
// fetchWithTimeout
// ---------------------------------------------------------------------------
describe("fetchWithTimeout (connect)", () => {
  it("throws FETCH_TIMEOUT error when request exceeds timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
    try {
      await assert.rejects(
        () => fetchWithTimeout("http://localhost:1/test", {}, 50),
        (err) => {
          assert.equal(err.code, "FETCH_TIMEOUT");
          assert.ok(err.message.includes("timed out"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns response on success", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({ ok: true, status: 200 });
    try {
      const res = await fetchWithTimeout("http://localhost/test", {}, 5000);
      assert.equal(res.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// redactSensitiveText (connect)
// ---------------------------------------------------------------------------
describe("redactSensitiveText (connect)", () => {
  it("redacts bearer tokens", () => {
    const out = redactSensitiveText("Authorization: Bearer very-secret-token");
    assert.ok(out.includes("[REDACTED]"));
    assert.ok(!out.includes("very-secret-token"));
  });

  it("redacts query token params", () => {
    const out = redactSensitiveText("https://x.test?a=1&token=abc123");
    assert.ok(out.includes("token=[REDACTED]"));
    assert.ok(!out.includes("token=abc123"));
  });
});

// ---------------------------------------------------------------------------
// error code + exit code helpers (connect)
// ---------------------------------------------------------------------------
describe("getErrorCode (connect)", () => {
  it("returns err.code when present", () => {
    assert.equal(getErrorCode({ code: "X" }, "FALLBACK"), "X");
  });

  it("returns fallback when err.code missing", () => {
    assert.equal(getErrorCode({}, "FALLBACK"), "FALLBACK");
    assert.equal(getErrorCode(null, "FALLBACK"), "FALLBACK");
  });
});

describe("getExitCodeForError (connect)", () => {
  it("maps config errors", () => {
    assert.equal(getExitCodeForError({ code: ERROR_CODES.AGENT_CONFIG_INVALID }), 2);
    assert.equal(getExitCodeForError({ code: ERROR_CODES.AUTH_CONFIG_INVALID }), 3);
  });

  it("maps provider and copilot flow errors", () => {
    assert.equal(getExitCodeForError({ code: ERROR_CODES.PROVIDER_INVALID }), 4);
    assert.equal(getExitCodeForError({ code: ERROR_CODES.COPILOT_DEVICE_FLOW_FAILED }), 6);
  });

  it("maps timeout and default", () => {
    assert.equal(getExitCodeForError({ code: ERROR_CODES.FETCH_TIMEOUT }), 7);
    assert.equal(getExitCodeForError({ code: "UNKNOWN" }), 1);
  });
});

describe("getMenuWindow", () => {
  it("returns full range when total <= page size", () => {
    const w = getMenuWindow(5, 2, 10);
    assert.equal(w.start, 0);
    assert.equal(w.end, 5);
  });

  it("centers around selected item when possible", () => {
    const w = getMenuWindow(100, 50, 10);
    assert.equal(w.start, 45);
    assert.equal(w.end, 55);
  });

  it("clamps to beginning and end boundaries", () => {
    const a = getMenuWindow(100, 1, 10);
    assert.equal(a.start, 0);
    assert.equal(a.end, 10);

    const b = getMenuWindow(100, 99, 10);
    assert.equal(b.start, 90);
    assert.equal(b.end, 100);
  });
});

describe("truncateForTerminal", () => {
  it("keeps short strings unchanged", () => {
    assert.equal(truncateForTerminal("short", 20), "short");
  });

  it("truncates long strings with ellipsis", () => {
    const out = truncateForTerminal("abcdefghijklmnopqrstuvwxyz", 10);
    assert.equal(out, "abcdefg...");
  });
});
