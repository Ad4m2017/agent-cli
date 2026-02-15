# JSON Contract

This page defines the stable `--json` output contract for `agent.js`.

## Top-Level Responses

### Success shape

Guaranteed keys on success:

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

Optional keys on success:

- `legacyModeMappedFrom` (present only when legacy mode aliases were mapped)

### Error shape

Guaranteed keys on error:

- `ok`
- `error`
- `code`

## Tool Call Records

Each entry in `toolCalls` is normalized as:

- `tool`
- `input`
- `ok`
- `result`
- `error`
- `meta`

When `ok` is `false`, `error.code` is always set (fallback: `TOOL_EXECUTION_ERROR`).

## Tool Error Codes

- `TOOL_INVALID_ARGS`
- `TOOL_NOT_FOUND`
- `TOOL_INVALID_PATTERN`
- `TOOL_UNSUPPORTED_FILE_TYPE`
- `TOOL_CONFLICT`
- `TOOL_UNKNOWN`
- `TOOL_EXECUTION_ERROR`

## Machine-Readable Schema

Print the schema used by this contract:

```bash
node agent.js --json-schema
```
