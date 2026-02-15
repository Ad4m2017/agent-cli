# Script and CI Examples

Use these examples to integrate agent-cli into automation workflows, CI pipelines, and scripts.

## Rules for Automation

- Always use `--json` for parseable output
- Use `--approval auto` or `--approval never` (never `--approval ask`)
- Check the `ok` field in JSON output for success/failure
- Check the `code` field for specific error handling

## Bash

### Basic Usage

```bash
set -euo pipefail

OUT=$(node agent.js -m "Run tests and summarize" --json --approval auto --profile dev)
echo "$OUT"
```

### Parse JSON Response

```bash
set -euo pipefail

OUT=$(node agent.js -m "Run npm test" --json --approval auto --profile dev)
OK=$(echo "$OUT" | jq -r '.ok')
MESSAGE=$(echo "$OUT" | jq -r '.message')

if [ "$OK" = "true" ]; then
  echo "Agent succeeded: $MESSAGE"
else
  ERROR=$(echo "$OUT" | jq -r '.error')
  echo "Agent failed: $ERROR"
  exit 1
fi
```

### Attach Files for Review

```bash
OUT=$(node agent.js \
  -m "Review this file for security issues" \
  --file src/auth.js \
  --json \
  --approval auto \
  --tools off)
echo "$OUT" | jq -r '.message'
```

### Multi-File Context

```bash
OUT=$(node agent.js \
  -m "Compare these implementations and suggest improvements" \
  --file src/old-handler.js \
  --file src/new-handler.js \
  --json \
  --approval never)
echo "$OUT" | jq -r '.message'
```

### CI Pipeline Check

```bash
set -euo pipefail

RESULT=$(node agent.js \
  -m "Run lint and tests. Report pass or fail." \
  --json \
  --approval auto \
  --profile dev)

OK=$(echo "$RESULT" | jq -r '.ok')
TOOLS_USED=$(echo "$RESULT" | jq '.toolCalls | length')
TIMING=$(echo "$RESULT" | jq -r '.timingMs')

echo "Status: ok=$OK, tools=$TOOLS_USED, time=${TIMING}ms"

if [ "$OK" != "true" ]; then
  echo "$RESULT" | jq -r '.error // .message'
  exit 1
fi
```

## PowerShell

### Basic Usage

```powershell
$out = node agent.js -m "Run tests and summarize" --json --approval auto --profile dev
$obj = $out | ConvertFrom-Json

if ($obj.ok) {
    Write-Host "Success: $($obj.message)"
} else {
    Write-Error "Failed: $($obj.error)"
    exit 1
}
```

### With File Attachment

```powershell
$out = node agent.js -m "Review this config" --file config/app.json --json --approval auto --tools off
$obj = $out | ConvertFrom-Json
Write-Host $obj.message
```

## Node.js Child Process

### Synchronous

```js
const { execFileSync } = require("node:child_process");

const raw = execFileSync("node", [
  "agent.js",
  "-m", "Run lint and summarize",
  "--json",
  "--approval", "auto",
  "--profile", "dev",
], { encoding: "utf8" });

const result = JSON.parse(raw);
console.log("ok:", result.ok);
console.log("message:", result.message);
console.log("tool calls:", result.toolCalls.length);
```

### Asynchronous

```js
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

async function runAgent(message, options = {}) {
  const args = [
    "agent.js",
    "-m", message,
    "--json",
    "--approval", options.approval || "auto",
    "--profile", options.profile || "dev",
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.file) {
    args.push("--file", options.file);
  }

  const { stdout } = await execFileAsync("node", args, {
    encoding: "utf8",
    timeout: 30000,
  });

  return JSON.parse(stdout);
}

// Usage
const result = await runAgent("Run tests", { profile: "dev" });
console.log(result.ok, result.message);
```

## Python Subprocess

```python
import json
import subprocess

result = subprocess.run(
    ["node", "agent.js", "-m", "Run tests", "--json", "--approval", "auto"],
    capture_output=True,
    text=True,
    timeout=30,
)

data = json.loads(result.stdout)
if data["ok"]:
    print("Success:", data["message"])
else:
    print("Error:", data.get("error", "unknown"))
```

## JSON Output Contract

### Success Response

```json
{
  "ok": true,
  "provider": "copilot",
  "model": "copilot/gpt-4o",
  "profile": "dev",
  "mode": "dev",
  "approvalMode": "auto",
  "toolsMode": "auto",
  "toolsEnabled": true,
  "toolsFallbackUsed": false,
  "health": {
    "retriesUsed": 0,
    "toolCallsTotal": 1,
    "toolCallsFailed": 0,
    "toolCallFailureRate": 0
  },
  "attachments": {
    "files": [],
    "images": []
  },
  "usage": {
    "turns": 2,
    "turns_with_usage": 2,
    "has_usage": true,
    "input_tokens": 1200,
    "output_tokens": 240,
    "total_tokens": 1440
  },
  "message": "All 42 tests passed successfully.",
  "toolCalls": [
    {
      "tool": "run_command",
      "input": { "cmd": "npm test" },
      "ok": true,
      "result": { "ok": true, "cmd": "npm test", "stdout": "...", "stderr": "" },
      "error": null,
      "meta": { "duration_ms": 1180, "ts": "2026-02-15T12:00:00.000Z" }
    }
  ],
  "timingMs": 3200
}
```

### Error Response

```json
{
  "ok": false,
  "error": "Provider 'openai' is not configured. Setup: node agent-connect.js --provider openai",
  "code": "PROVIDER_NOT_CONFIGURED"
}
```

### Blocked Command in Tool Call

```json
{
  "tool": "run_command",
  "input": { "cmd": "rm -rf /" },
  "ok": false,
  "result": null,
  "error": {
    "message": "BLOCKED: Command not allowed for profile 'dev': rm -rf /",
    "code": "TOOL_EXECUTION_ERROR"
  },
  "meta": { "duration_ms": 3, "ts": "2026-02-15T12:00:01.000Z" }
}
```

### Guaranteed vs Optional Fields

Guaranteed in successful `--json` responses:

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

Optional (present only when applicable):

- `error` and `code` -- Present on top-level failure responses (`ok: false`).

For each `toolCalls[]` record:

- Guaranteed: `tool`, `input`, `ok`, `result`, `error`, `meta`
- Optional inside `error`: `code` may come from the tool (falls back to `TOOL_EXECUTION_ERROR`).

### Tool Error Codes

Common tool error codes in normalized tool-call records:

| Code | Meaning | Typical Fix |
|------|---------|-------------|
| `TOOL_INVALID_ARGS` | Missing/invalid tool arguments | Validate tool input payload |
| `TOOL_NOT_FOUND` | File/path target missing | Check the target path exists |
| `TOOL_INVALID_PATTERN` | Invalid regex pattern | Fix regex syntax |
| `TOOL_UNSUPPORTED_FILE_TYPE` | Binary-like file used in text tool | Use a text file or different tool |
| `TOOL_CONFLICT` | Destination/add target already exists | Use overwrite/move or different target |
| `TOOL_UNKNOWN` | Tool name is not registered | Use a supported tool |
| `TOOL_EXECUTION_ERROR` | Generic tool/runtime failure fallback | Inspect tool `error.message` details |

### Fields Reference

- `ok` (`boolean`) -- Whether the request completed successfully
- `provider` (`string`) -- Provider used for the request
- `model` (`string`) -- Full model identifier (`provider/model`)
- `profile` (`string`) -- Effective runtime profile (`safe|dev|framework`)
- `mode` (`string`) -- Effective policy key (same value set as profile: `safe|dev|framework`)
- `approvalMode` (`string`) -- Approval mode that was active
- `toolsMode` (`string`) -- Tools mode that was configured
- `toolsEnabled` (`boolean`) -- Whether tools were actually sent to the model
- `toolsFallbackUsed` (`boolean`) -- Whether auto-mode fell back to no-tools
- `health` (`object`) -- Runtime health summary (`retriesUsed`, `toolCallsTotal`, `toolCallsFailed`, `toolCallFailureRate`)
- `attachments` (`object`) -- Files and images that were attached
- `usage` (`object`) -- Aggregated usage for this run (`turns`, `input_tokens`, `output_tokens`, `total_tokens`, ...)
- `message` (`string`) -- Final text response from the AI
- `toolCalls` (`array`) -- Normalized tool call records (`tool`, `input`, `ok`, `result`, `error`, `meta`)
- `timingMs` (`number`) -- Total execution time in milliseconds
- `error` (`string`) -- Error message (only when `ok` is false)
- `code` (`string`) -- Error code (only when `ok` is false)

## Exit Codes

- `0` -- Successful execution
- Non-zero -- Error or blocked operation

For deterministic automation, always parse the JSON `ok` and `code` fields rather than relying on exit codes alone.
