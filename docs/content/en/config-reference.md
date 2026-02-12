# Config Reference

Complete reference for `agent.json` and `agent.auth.json`.

## Build Docs

Whenever you change markdown docs, rebuild HTML pages:

```bash
node scripts/build-docs.js
```

## agent.json

`agent.json` contains non-secret runtime defaults and security rules.

### runtime

- `defaultProvider` (`string`)
- `defaultModel` (`string`)
- `defaultMode` (`plan|build|unsafe`)
- `defaultApprovalMode` (`ask|auto|never`)
- `defaultToolsMode` (`auto|on|off`)
- `approvalTimeoutMs` (`number`, optional)

### security

- `mode` (`plan|build|unsafe`)
- `denyCritical` (`string[]`)
- `modes.<mode>.allow` (`string[]`)
- `modes.<mode>.deny` (`string[]`)

Decision order:

1. `denyCritical`
2. `modes[mode].deny`
3. `modes[mode].allow`

## agent.auth.json

`agent.auth.json` stores credentials/tokens and provider-specific transport settings.

### OpenAI-compatible provider

- `kind`: `openai_compatible`
- `baseUrl`
- `apiKey`

### GitHub Copilot provider

- `kind`: `github_copilot`
- `githubToken`, `githubRefreshToken`, `githubTokenExpiresAt`
- `copilotToken`, `copilotTokenExpiresAt`
- `oauth`, `api`, `extraHeaders`

## Error Code Reference

### agent.js

- `ATTACHMENT_NOT_FOUND`
- `ATTACHMENT_UNREADABLE`
- `ATTACHMENT_TOO_LARGE`
- `ATTACHMENT_TOO_MANY_FILES`
- `ATTACHMENT_TOO_MANY_IMAGES`
- `ATTACHMENT_TYPE_UNSUPPORTED`
- `VISION_NOT_SUPPORTED`
- `PROVIDER_NOT_CONFIGURED`
- `INTERACTIVE_APPROVAL_JSON`
- `INTERACTIVE_APPROVAL_TTY`
- `TOOLS_NOT_SUPPORTED`
- `AGENT_CONFIG_INVALID`
- `AUTH_CONFIG_INVALID`
- `AGENT_CONFIG_ERROR`
- `AUTH_CONFIG_ERROR`
- `RUNTIME_ERROR`

### agent-connect.js

- `PROVIDER_INVALID`
- `API_KEY_REQUIRED`
- `AUTH_CONFIG_INVALID`
- `AGENT_CONFIG_INVALID`
- `COPILOT_DEVICE_START_FAILED`
- `COPILOT_DEVICE_FLOW_FAILED`
- `COPILOT_DEVICE_CODE_EXPIRED`
- `COPILOT_RUNTIME_TOKEN_FAILED`
- `PROVIDER_UNSUPPORTED`
- `CONNECT_ERROR`
