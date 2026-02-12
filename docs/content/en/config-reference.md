# Config Reference

Complete reference for `agent.json` and `agent.auth.json` configuration files.

## Overview

agent-cli uses two local JSON files for configuration:

- `agent.json` -- non-secret runtime defaults and security policy. Safe to commit.
- `agent.auth.json` -- provider credentials and tokens. Never commit this file.

Both files are created automatically by `node agent-connect.js`. You can also edit them manually.

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
    "defaultMode": "build",
    "defaultApprovalMode": "ask",
    "defaultToolsMode": "auto"
  },
  "security": {
    "mode": "build",
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
      "plan": {
        "allow": ["pwd", "ls", "whoami", "date", "git status", "git branch", "git diff", "git log", "node -v", "npm -v"],
        "deny": ["rm", "sudo", "chmod", "chown", "mv", "cp", "docker", "npm install", "git push"]
      },
      "build": {
        "allow": ["pwd", "ls", "whoami", "date", "git", "node", "npm", "pnpm", "yarn", "bun", "python", "pytest", "go", "cargo", "make", "docker"],
        "deny": ["rm", "sudo", "shutdown", "reboot", "mkfs", "chown"]
      },
      "unsafe": {
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
- `defaultMode` (`string`: `"plan"`, `"build"`, `"unsafe"`) -- Security mode applied when `--mode` is not passed. Default: `"build"`.
- `defaultApprovalMode` (`string`: `"ask"`, `"auto"`, `"never"`) -- Approval mode applied when `--approval` is not passed. Default: `"ask"`.
- `defaultToolsMode` (`string`: `"auto"`, `"on"`, `"off"`) -- Tools mode applied when `--tools` is not passed. Default: `"auto"`.
- `approvalTimeoutMs` (`number`, optional) -- Timeout in milliseconds for the interactive approval prompt. 0 or omitted means no timeout.

### security

- `mode` (`string`) -- Active security mode. Should match `runtime.defaultMode`.
- `denyCritical` (`string[]`) -- Commands that are always blocked, regardless of mode. Supports plain text matching and regex via `re:` prefix.
- `modes` (`object`) -- Per-mode allow/deny rule sets.

### security.modes.<mode>

- `allow` (`string[]`) -- Commands allowed in this mode. Use `"*"` to allow all.
- `deny` (`string[]`) -- Commands blocked in this mode.

### Rule Matching

Rules are matched against the full command string:

- `"*"` -- matches any command
- `"re:<pattern>"` -- regex match (case-insensitive). Example: `"re:curl\\s+.*\\|\\s*(sh|bash)"`
- Plain text -- exact match or prefix match. `"git"` matches `"git status"`, `"git push"`, etc.

### Decision Order

1. `denyCritical` -- checked first, always wins
2. `modes[mode].deny` -- checked second
3. `modes[mode].allow` -- checked last, command must match at least one allow rule

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
- `ATTACHMENT_TOO_LARGE` -- File exceeds 200KB or image exceeds 5MB
- `ATTACHMENT_TOO_MANY_FILES` -- More than 10 files attached
- `ATTACHMENT_TOO_MANY_IMAGES` -- More than 5 images attached
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
- `RUNTIME_ERROR` -- Unhandled runtime error

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

## CLI Precedence

Configuration values are resolved in this order (first wins):

1. CLI flags (`--model`, `--mode`, `--approval`, `--tools`, `--unsafe`)
2. `agent.json` runtime defaults
3. `agent.auth.json` defaults (`defaultProvider`, `defaultModel`)
4. Hardcoded fallbacks (`gpt-4.1-mini`, `build`, `ask`, `auto`)
