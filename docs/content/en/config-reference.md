# Config Reference

Complete reference for `agent.json` and `agent.auth.json` configuration files.

## Overview

agent-cli uses two local JSON files for configuration:

- `agent.example.json` -- recommended committed baseline for team defaults.
- `agent.json` -- non-secret runtime defaults and security policy. Safe to commit.
- `agent.auth.json` -- provider credentials and tokens. Never commit this file.

Both files are created automatically by `node agent-connect.js`. You can also edit them manually.

Write behavior:

- Config saves use atomic writes (temp file + rename) to reduce risk of partial/corrupted JSON.
- Paths passed via `--config` / `--auth-config` are validated. Parent directory must exist and the target path must be a file path (not a directory).

## Rebuilding Docs

After changing markdown sources, rebuild HTML:

```bash
node scripts/build-docs.js
```

## agent.json

This file controls runtime behavior and security policy. It is created with sensible defaults by the setup wizard.

### Full Example

```json
{
  "version": 1,
  "runtime": {
    "defaultProvider": "openai",
    "defaultModel": "openai/gpt-4.1-mini",
    "profile": "dev",
    "defaultApprovalMode": "ask",
    "defaultToolsMode": "auto"
  },
  "security": {
    "denyCritical": [
      "rm -rf /",
      "mkfs",
      "shutdown",
      "reboot",
      "poweroff",
      "dd if=",
      "re:curl\\s+.*\\|\\s*(sh|bash)",
      "re:wget\\s+.*\\|\\s*(sh|bash)"
    ],
    "modes": {
      "safe": {
        "allow": ["pwd", "ls", "whoami", "date", "git status", "git branch", "git diff", "git log", "node -v", "npm -v"],
        "deny": ["rm", "sudo", "chmod", "chown", "mv", "cp", "docker", "npm install", "git push"]
      },
      "dev": {
        "allow": ["pwd", "ls", "whoami", "date", "git", "node", "npm", "pnpm", "yarn", "bun", "python", "pytest", "go", "cargo", "make", "docker"],
        "deny": ["rm", "sudo", "shutdown", "reboot", "mkfs", "chown"]
      },
      "framework": {
        "allow": ["*"],
        "deny": ["rm -rf /", "mkfs", "shutdown", "reboot", "poweroff"]
      }
    }
  }
}
```

### runtime

- `defaultProvider` (`string`) -- Provider identifier (e.g., `"openai"`, `"copilot"`, `"groq"`). Used when `--model` does not include a provider prefix.
- `defaultModel` (`string`) -- Full model identifier in `provider/model` format (e.g., `"openai/gpt-4.1-mini"`). Used when `--model` is not passed.
- `profile` (`string`: `"safe"`, `"dev"`, `"framework"`) -- Runtime profile. Default: `"dev"`.
- `defaultApprovalMode` (`string`: `"ask"`, `"auto"`, `"never"`) -- Approval mode applied when `--approval` is not passed. Default: `"ask"`.
- `defaultToolsMode` (`string`: `"auto"`, `"on"`, `"off"`) -- Tools mode applied when `--tools` is not passed. Default: `"auto"`.
- `commandTimeoutMs` (`number`) -- Timeout for tool command execution (`run_command`) in milliseconds. Default: `10000`.
- `allowInsecureHttp` (`boolean`) -- Allows non-local `http://` provider base URLs when true. Default: `false`.
- `approvalTimeoutMs` (`number`, optional) -- Timeout in milliseconds for the interactive approval prompt. 0 or omitted means no timeout.
- `systemPrompt` (`string`, optional) -- System prompt sent with each request. Empty or omitted disables the system role message.
- `attachments.maxFileBytes` (`number`, optional) -- Max bytes per `--file` attachment. Integer `>= 0`; `0` means unlimited.
- `attachments.maxImageBytes` (`number`, optional) -- Max bytes per `--image` attachment. Integer `>= 0`; `0` means unlimited.
- `attachments.maxFiles` (`number`, optional) -- Max number of `--file` attachments. Integer `>= 0`; `0` means unlimited.
- `attachments.maxImages` (`number`, optional) -- Max number of `--image` attachments. Integer `>= 0`; `0` means unlimited.
- `usageStats.enabled` (`boolean`, optional) -- Enables local usage stats logging to NDJSON. Default: `false`.
- `usageStats.file` (`string`, optional) -- Path to the usage log file. Default: `.agent-usage.ndjson`.
- `usageStats.retentionDays` (`number`, optional) -- Keep stats entries for this many days. Default: `90`.
- `usageStats.maxBytes` (`number`, optional) -- Soft max file size; applied during `--stats` compaction. Default: `5242880` (5 MB).
- `--stats` text output includes totals, a quality section (`Retry Rate`, `Tool Failure Rate`), plus `By Provider`/`By Model` sections with raw + compact values (for example `12345 (12.3k)`).

### security

- `denyCritical` (`string[]`) -- Commands that are always blocked, regardless of profile. Supports plain text matching and regex via `re:` prefix.
- `modes` (`object`) -- Per-profile allow/deny rule sets (`safe`, `dev`, `framework`).

### security.modes.<profile>

- `allow` (`string[]`) -- Commands allowed in this profile. Use `"*"` to allow all.
- `deny` (`string[]`) -- Commands blocked in this profile.

### Rule Matching

Rules are matched against the full command string:

- `"*"` -- matches any command
- `"re:<pattern>"` -- regex match (case-insensitive). Example: `"re:curl\\s+.*\\|\\s*(sh|bash)"`
- Plain text -- exact match or prefix match. `"git"` matches `"git status"`, `"git push"`, etc.

### Decision Order

1. `denyCritical` -- checked first, always wins
2. `modes[profile].deny` -- checked second
3. `modes[profile].allow` -- checked last, command must match at least one allow rule

If a command matches `denyCritical` or `deny`, it is blocked. If it does not match any `allow` rule, it is also blocked.

## agent.auth.json

This file stores provider credentials. File permissions are set to `0600` (owner read/write only). Do not commit this file.

### OpenAI-compatible Provider Example

```json
{
  "version": 1,
  "defaultProvider": "openai",
  "defaultModel": "openai/gpt-4.1-mini",
  "providers": {
    "openai": {
      "kind": "openai_compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-..."
    }
  }
}
```

Optional per-provider fields used by the connect wizard:

- `enabledModels` (`string[]`) -- model allow-list selected in the wizard
- `authMethod` (`string`, optional) -- metadata for how credentials were provisioned

Fields:

- `kind` (`string`) -- Always `"openai_compatible"` for API key providers.
- `baseUrl` (`string`) -- Provider API base URL.
- `apiKey` (`string`) -- Your API key.

### GitHub Copilot Provider Example

```json
{
  "version": 1,
  "defaultProvider": "copilot",
  "defaultModel": "copilot/gpt-4o",
  "providers": {
    "copilot": {
      "kind": "github_copilot",
      "githubToken": "gho_...",
      "githubRefreshToken": "ghr_...",
      "githubTokenExpiresAt": "2025-01-15T12:00:00.000Z",
      "copilotToken": "tid=...",
      "copilotTokenExpiresAt": "2025-01-15T12:30:00.000Z",
      "oauth": {
        "clientId": "Iv1.b507a08c87ecfe98",
        "accessTokenUrl": "https://github.com/login/oauth/access_token"
      },
      "api": {
        "copilotTokenUrl": "https://api.github.com/copilot_internal/v2/token",
        "baseUrl": "https://api.githubcopilot.com"
      },
      "extraHeaders": {
        "Editor-Version": "vscode/1.85.1",
        "Editor-Plugin-Version": "copilot-chat/0.12.0",
        "User-Agent": "agent.js-copilot"
      }
    }
  }
}
```

Fields:

- `kind` (`string`) -- Always `"github_copilot"`.
- `githubToken` (`string`) -- GitHub OAuth access token.
- `githubRefreshToken` (`string`) -- GitHub OAuth refresh token.
- `githubTokenExpiresAt` (`string`) -- ISO timestamp of GitHub token expiry.
- `copilotToken` (`string`) -- Short-lived Copilot runtime token.
- `copilotTokenExpiresAt` (`string`) -- ISO timestamp of Copilot token expiry.
- `oauth` (`object`) -- OAuth endpoint configuration.
- `api` (`object`) -- Copilot API endpoint configuration.
- `extraHeaders` (`object`) -- Additional headers sent with Copilot API requests.

### Multiple Providers

You can configure multiple providers simultaneously:

```json
{
  "version": 1,
  "defaultProvider": "openai",
  "defaultModel": "openai/gpt-4.1-mini",
  "providers": {
    "openai": {
      "kind": "openai_compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-..."
    },
    "groq": {
      "kind": "openai_compatible",
      "baseUrl": "https://api.groq.com/openai/v1",
      "apiKey": "gsk_..."
    },
    "copilot": {
      "kind": "github_copilot",
      "githubToken": "gho_..."
    }
  }
}
```

Switch between them using `--model provider/model`:

```bash
node agent.js -m "Hello" --model groq/llama-3.3-70b-versatile
node agent.js -m "Hello" --model openai/gpt-4.1
```

### Token Refresh

Copilot tokens are short-lived (around 25 minutes). The agent automatically:

1. Checks if the Copilot token is still valid (with a 60-second buffer)
2. If expired, fetches a new Copilot token using the GitHub access token
3. If the GitHub token is also expired (HTTP 401), refreshes it using the refresh token
4. Saves updated tokens to `agent.auth.json`

If all tokens are expired and refresh fails, re-run `node agent-connect.js --provider copilot`.

## Error Code Reference

### agent.js Errors

- `ATTACHMENT_NOT_FOUND` -- File path does not exist
- `ATTACHMENT_UNREADABLE` -- File is not readable as UTF-8 text
- `ATTACHMENT_LIMIT_INVALID` -- Invalid attachment limit value (must be integer `>= 0`)
- `ATTACHMENT_TOO_LARGE` -- Attachment exceeds configured byte limit
- `ATTACHMENT_TOO_MANY_FILES` -- Number of files exceeds configured `maxFiles`
- `ATTACHMENT_TOO_MANY_IMAGES` -- Number of images exceeds configured `maxImages`
- `ATTACHMENT_TYPE_UNSUPPORTED` -- Image format not in: .png, .jpg, .jpeg, .webp
- `VISION_NOT_SUPPORTED` -- Image attached to a text-only model
- `PROVIDER_NOT_CONFIGURED` -- Provider not found in agent.auth.json
- `INTERACTIVE_APPROVAL_JSON` -- Cannot use `--approval ask` with `--json`
- `INTERACTIVE_APPROVAL_TTY` -- Cannot use `--approval ask` without a TTY
- `TOOLS_NOT_SUPPORTED` -- Model does not support tool calling (with `--tools on`)
- `AGENT_CONFIG_INVALID` -- agent.json is not valid JSON
- `AUTH_CONFIG_INVALID` -- agent.auth.json is not valid JSON
- `AGENT_CONFIG_ERROR` -- Failed to read agent.json
- `AUTH_CONFIG_ERROR` -- Failed to read agent.auth.json
- `FETCH_TIMEOUT` -- Provider request exceeded timeout
- `RETRY_EXHAUSTED` -- All retry attempts failed for a transient provider error
- `RUNTIME_ERROR` -- Unhandled runtime error
- `INVALID_BASE_URL` -- Provider `baseUrl` is malformed or protocol is unsupported
- `INSECURE_BASE_URL` -- Public `http://` base URL rejected without insecure override

### agent-connect.js Errors

- `PROVIDER_INVALID` -- Unknown provider name
- `API_KEY_REQUIRED` -- Empty API key during setup
- `AUTH_CONFIG_INVALID` -- agent.auth.json is not valid JSON
- `AGENT_CONFIG_INVALID` -- agent.json is not valid JSON
- `COPILOT_DEVICE_START_FAILED` -- Could not start GitHub device flow
- `COPILOT_DEVICE_FLOW_FAILED` -- Device flow authentication failed
- `COPILOT_DEVICE_CODE_EXPIRED` -- Device code timed out before user confirmed
- `COPILOT_RUNTIME_TOKEN_FAILED` -- Could not exchange GitHub token for Copilot token
- `COPILOT_RUNTIME_TOKEN_MISSING` -- Copilot token response was empty
- `COPILOT_TOKEN_MISSING` -- No access token in device flow response
- `PROVIDER_UNSUPPORTED` -- Provider type not supported
- `SELECT_OPTIONS_EMPTY` -- Wizard menu has no options
- `INTERRUPTED` -- User pressed Ctrl+C during wizard
- `CONNECT_ERROR` -- Unhandled error during setup

## Exit Codes

agent-cli now uses stable process exit codes for automation:

- `1` generic runtime/connect error
- `2` agent config error (`agent.json`)
- `3` auth config error (`agent.auth.json`)
- `4` provider configuration/selection error
- `5` interactive approval constraint error
- `6` provider capability / copilot flow error
- `7` fetch timeout
- `8` retry exhausted
- `9` attachment validation error

## CLI Precedence

Configuration values are resolved in this order (first wins):

1. CLI flags (`--model`, `--profile`, `--approval`, `--tools`, `--unsafe`, `--system-prompt`, `--max-file-bytes`, `--max-image-bytes`, `--max-files`, `--max-images`, `--stats`)
2. Environment variables (`AGENT_MODEL`, `AGENT_PROFILE`, `AGENT_APPROVAL`, `AGENT_API_KEY`, `AGENT_COMMAND_TIMEOUT`, `AGENT_ALLOW_INSECURE_HTTP`, `AGENT_SYSTEM_PROMPT`, `AGENT_MAX_FILE_BYTES`, `AGENT_MAX_IMAGE_BYTES`, `AGENT_MAX_FILES`, `AGENT_MAX_IMAGES`)
3. `agent.json` runtime defaults
4. `agent.auth.json` defaults (`defaultProvider`, `defaultModel`)
5. Hardcoded fallbacks (`gpt-4.1-mini`, `dev`, `ask`, `auto`)

Config file path resolution:

- `--config <path>` overrides the default `./agent.json`
- `--auth-config <path>` overrides the default `./agent.auth.json`

models.dev integration in `agent-connect.js`:

- Optional fallback for model discovery when `/models` is unavailable
- Optional provider import flow: `Load provider from models.dev...`
- Imported providers use the registry `api` URL as initial `baseUrl`
