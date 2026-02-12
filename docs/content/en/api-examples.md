# Script and CI Examples

Use these examples for automation with stable JSON output.

## Rules for Automation

- Always use `--json`.
- Use `--approval auto` or `--approval never`.
- Do not use `--approval ask` in automation.

## Bash

```bash
set -euo pipefail

OUT=$(node agent.js -m "Run tests and summarize" --json --approval auto --mode build)
echo "$OUT"
```

Attach a file:

```bash
OUT=$(node agent.js -m "Review this file" --file src/app.ts --json --approval auto --tools off)
echo "$OUT"
```

## PowerShell

```powershell
$out = node agent.js -m "Run tests and summarize" --json --approval auto --mode build
$obj = $out | ConvertFrom-Json
$obj.message
```

## Node.js Child Process

```js
const { execFileSync } = require("node:child_process");

const raw = execFileSync("node", [
  "agent.js",
  "-m",
  "Run lint and summarize",
  "--json",
  "--approval",
  "auto",
  "--mode",
  "build",
], { encoding: "utf8" });

const result = JSON.parse(raw);
console.log(result.ok, result.message);
```

## JSON Output Contract

Success example:

```json
{
  "ok": true,
  "provider": "copilot",
  "model": "copilot/gpt-4o",
  "mode": "build",
  "approvalMode": "auto",
  "toolsMode": "auto",
  "message": "Summary...",
  "toolCalls": [],
  "timingMs": 320
}
```

Error example:

```json
{
  "ok": false,
  "error": "Interactive approval is not supported with --json. Use --approval auto or --approval never.",
  "code": "INTERACTIVE_APPROVAL_JSON"
}
```

```json
{
  "ok": false,
  "error": "Model 'perplexity/sonar' is likely text-only. Image attachments require a vision-capable model.",
  "code": "VISION_NOT_SUPPORTED"
}
```

## Exit Handling

- `0`: successful execution
- non-zero: error or blocked operation

Always parse `ok` and `code` for deterministic automation behavior.
