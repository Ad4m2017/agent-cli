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
- `health`
- `attachments`
- `usage`
- `message`
- `toolCalls`
- `timingMs`

Optional keys on success:

- None

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

## Health Summary

`health` is always present on success and contains:

- `retriesUsed` (`number`) -- Number of fetch retries used for chat completion requests.
- `toolCallsTotal` (`number`) -- Total number of tool calls executed.
- `toolCallsFailed` (`number`) -- Number of tool calls with `ok: false`.
- `toolCallFailureRate` (`number`) -- `toolCallsFailed / toolCallsTotal` (0 when no tool calls).

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
