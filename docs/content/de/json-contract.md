# JSON-Vertrag

Diese Seite definiert den stabilen `--json`-Output-Vertrag von `agent.js`.

## Top-Level Antworten

### Erfolgs-Form

Garantierte Keys bei Erfolg:

- `ok`
- `provider`
- `model`
- `profile`
- `mode`
- `approvalMode`
- `toolsMode`
- `toolsEnabled`
- `toolsFallbackUsed`
- `attachments`
- `usage`
- `message`
- `toolCalls`
- `timingMs`

Optionale Keys bei Erfolg:

- Keine

### Fehler-Form

Garantierte Keys bei Fehlern:

- `ok`
- `error`
- `code`

## Tool-Call-Records

Jeder Eintrag in `toolCalls` wird normalisiert als:

- `tool`
- `input`
- `ok`
- `result`
- `error`
- `meta`

Wenn `ok` `false` ist, ist `error.code` immer gesetzt (Fallback: `TOOL_EXECUTION_ERROR`).

## Tool-Fehlercodes

- `TOOL_INVALID_ARGS`
- `TOOL_NOT_FOUND`
- `TOOL_INVALID_PATTERN`
- `TOOL_UNSUPPORTED_FILE_TYPE`
- `TOOL_CONFLICT`
- `TOOL_UNKNOWN`
- `TOOL_EXECUTION_ERROR`

## Maschinenlesbares Schema

Schema ausgeben, das diesen Vertrag beschreibt:

```bash
node agent.js --json-schema
```
