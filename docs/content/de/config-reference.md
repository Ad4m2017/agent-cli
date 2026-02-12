# Konfigurationsreferenz

Referenz fuer `agent.json` und `agent.auth.json`.

## Doku bauen

```bash
node scripts/build-docs.js
```

## agent.json

Nicht-sensitive Runtime- und Sicherheitskonfiguration.

### runtime

- `defaultProvider`
- `defaultModel`
- `defaultMode` (`plan|build|unsafe`)
- `defaultApprovalMode` (`ask|auto|never`)
- `defaultToolsMode` (`auto|on|off`)

### security

- `denyCritical`
- `modes.<mode>.allow`
- `modes.<mode>.deny`

Entscheidungsreihenfolge:

1. `denyCritical`
2. `deny`
3. `allow`

## agent.auth.json

Secrets, Tokens und Provider-Transportdaten.

### OpenAI-kompatibel

- `kind: openai_compatible`
- `baseUrl`
- `apiKey`

### GitHub Copilot

- `kind: github_copilot`
- OAuth- und Runtime-Tokens

## Error-Codes

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

### agent-connect.js

- `PROVIDER_INVALID`
- `API_KEY_REQUIRED`
- `COPILOT_DEVICE_START_FAILED`
- `COPILOT_DEVICE_FLOW_FAILED`
- `COPILOT_DEVICE_CODE_EXPIRED`
- `COPILOT_RUNTIME_TOKEN_FAILED`
