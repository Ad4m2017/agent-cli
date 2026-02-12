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

OUT=$(node agent.js -m "Run tests and summarize" --json --approval auto --mode build)
echo "$OUT"
```

### Parse JSON Response

```bash
set -euo pipefail

OUT=$(node agent.js -m "Run npm test" --json --approval auto --mode build)
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
  --mode build)

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
$out = node agent.js -m "Run tests and summarize" --json --approval auto --mode build
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
  "--mode", "build",
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
    "--mode", options.mode || "build",
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
const result = await runAgent("Run tests", { mode: "build" });
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
  "mode": "build",
  "approvalMode": "auto",
  "toolsMode": "auto",
  "toolsEnabled": true,
  "toolsFallbackUsed": false,
  "attachments": {
    "files": [],
    "images": []
  },
  "message": "All 42 tests passed successfully.",
  "toolCalls": [
    {
      "name": "run_command",
      "args": { "cmd": "npm test" },
      "result": { "ok": true, "cmd": "npm test", "stdout": "...", "stderr": "" }
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
  "name": "run_command",
  "args": { "cmd": "rm -rf /" },
  "result": {
    "ok": false,
    "blocked": true,
    "mode": "build",
    "policy": { "source": "denyCritical", "rule": "rm -rf /" },
    "error": "BLOCKED: Command not allowed in mode 'build': rm -rf /"
  }
}
```

### Fields Reference

- `ok` (`boolean`) -- Whether the request completed successfully
- `provider` (`string`) -- Provider used for the request
- `model` (`string`) -- Full model identifier (`provider/model`)
- `mode` (`string`) -- Security mode that was active
- `approvalMode` (`string`) -- Approval mode that was active
- `toolsMode` (`string`) -- Tools mode that was configured
- `toolsEnabled` (`boolean`) -- Whether tools were actually sent to the model
- `toolsFallbackUsed` (`boolean`) -- Whether auto-mode fell back to no-tools
- `attachments` (`object`) -- Files and images that were attached
- `message` (`string`) -- Final text response from the AI
- `toolCalls` (`array`) -- All tool calls made during the session
- `timingMs` (`number`) -- Total execution time in milliseconds
- `error` (`string`) -- Error message (only when `ok` is false)
- `code` (`string`) -- Error code (only when `ok` is false)

## Exit Codes

- `0` -- Successful execution
- Non-zero -- Error or blocked operation

For deterministic automation, always parse the JSON `ok` and `code` fields rather than relying on exit codes alone.
