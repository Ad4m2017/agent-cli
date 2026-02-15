# Skript- und CI-Beispiele

Diese Beispiele zeigen, wie du agent-cli in Automations-Workflows, CI-Pipelines und Skripte integrieren kannst.

## Regeln fuer Automation

- Immer `--json` fuer parsebaren Output verwenden
- `--approval auto` oder `--approval never` verwenden (nie `--approval ask`)
- Das `ok`-Feld im JSON-Output fuer Erfolg/Fehler pruefen
- Das `code`-Feld fuer spezifische Fehlerbehandlung pruefen

## Bash

### Grundlegende Nutzung

```bash
set -euo pipefail

OUT=$(node agent.js -m "Tests ausfuehren und zusammenfassen" --json --approval auto --profile dev)
echo "$OUT"
```

### JSON-Antwort parsen

```bash
set -euo pipefail

OUT=$(node agent.js -m "npm test ausfuehren" --json --approval auto --profile dev)
OK=$(echo "$OUT" | jq -r '.ok')
MESSAGE=$(echo "$OUT" | jq -r '.message')

if [ "$OK" = "true" ]; then
  echo "Agent erfolgreich: $MESSAGE"
else
  ERROR=$(echo "$OUT" | jq -r '.error')
  echo "Agent fehlgeschlagen: $ERROR"
  exit 1
fi
```

### Dateien fuer Review anhaengen

```bash
OUT=$(node agent.js \
  -m "Pruefe diese Datei auf Sicherheitsprobleme" \
  --file src/auth.js \
  --json \
  --approval auto \
  --tools off)
echo "$OUT" | jq -r '.message'
```

### Multi-Datei-Kontext

```bash
OUT=$(node agent.js \
  -m "Vergleiche diese Implementierungen und schlage Verbesserungen vor" \
  --file src/old-handler.js \
  --file src/new-handler.js \
  --json \
  --approval never)
echo "$OUT" | jq -r '.message'
```

### CI-Pipeline Check

```bash
set -euo pipefail

RESULT=$(node agent.js \
  -m "Lint und Tests ausfuehren. Pass oder Fail melden." \
  --json \
  --approval auto \
  --profile dev)

OK=$(echo "$RESULT" | jq -r '.ok')
TOOLS_USED=$(echo "$RESULT" | jq '.toolCalls | length')
TIMING=$(echo "$RESULT" | jq -r '.timingMs')

echo "Status: ok=$OK, tools=$TOOLS_USED, zeit=${TIMING}ms"

if [ "$OK" != "true" ]; then
  echo "$RESULT" | jq -r '.error // .message'
  exit 1
fi
```

## PowerShell

### Grundlegende Nutzung

```powershell
$out = node agent.js -m "Tests ausfuehren und zusammenfassen" --json --approval auto --profile dev
$obj = $out | ConvertFrom-Json

if ($obj.ok) {
    Write-Host "Erfolg: $($obj.message)"
} else {
    Write-Error "Fehlgeschlagen: $($obj.error)"
    exit 1
}
```

### Mit Datei-Anhang

```powershell
$out = node agent.js -m "Pruefe diese Config" --file config/app.json --json --approval auto --tools off
$obj = $out | ConvertFrom-Json
Write-Host $obj.message
```

## Node.js Child Process

### Synchron

```js
const { execFileSync } = require("node:child_process");

const raw = execFileSync("node", [
  "agent.js",
  "-m", "Lint ausfuehren und zusammenfassen",
  "--json",
  "--approval", "auto",
  "--profile", "dev",
], { encoding: "utf8" });

const result = JSON.parse(raw);
console.log("ok:", result.ok);
console.log("nachricht:", result.message);
console.log("tool calls:", result.toolCalls.length);
```

### Asynchron

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

// Verwendung
const result = await runAgent("Tests ausfuehren", { profile: "dev" });
console.log(result.ok, result.message);
```

## Python Subprocess

```python
import json
import subprocess

result = subprocess.run(
    ["node", "agent.js", "-m", "Tests ausfuehren", "--json", "--approval", "auto"],
    capture_output=True,
    text=True,
    timeout=30,
)

data = json.loads(result.stdout)
if data["ok"]:
    print("Erfolg:", data["message"])
else:
    print("Fehler:", data.get("error", "unbekannt"))
```

## JSON Output Contract

### Erfolgs-Antwort

```json
{
  "ok": true,
  "provider": "copilot",
  "model": "copilot/gpt-4o",
  "profile": "dev",
  "mode": "build",
  "approvalMode": "auto",
  "toolsMode": "auto",
  "toolsEnabled": true,
  "toolsFallbackUsed": false,
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
  "message": "Alle 42 Tests erfolgreich bestanden.",
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

### Fehler-Antwort

```json
{
  "ok": false,
  "error": "Provider 'openai' is not configured. Setup: node agent-connect.js --provider openai",
  "code": "PROVIDER_NOT_CONFIGURED"
}
```

### Blockierter Befehl im Tool-Call

```json
{
  "tool": "run_command",
  "input": { "cmd": "rm -rf /" },
  "ok": false,
  "result": null,
  "error": {
    "message": "BLOCKED: Command not allowed in mode 'build': rm -rf /",
    "code": ""
  },
  "meta": { "duration_ms": 3, "ts": "2026-02-15T12:00:01.000Z" }
}
```

### Felder-Referenz

- `ok` (`boolean`) -- Ob die Anfrage erfolgreich abgeschlossen wurde
- `provider` (`string`) -- Verwendeter Provider
- `model` (`string`) -- Vollstaendige Modell-Kennung (`provider/model`)
- `profile` (`string`) -- Effektives Runtime-Profil (`safe|dev|framework`)
- `mode` (`string`) -- Aktiver Sicherheitsmodus
- `approvalMode` (`string`) -- Aktiver Freigabemodus
- `toolsMode` (`string`) -- Konfigurierter Tools-Modus
- `toolsEnabled` (`boolean`) -- Ob Tools tatsaechlich an das Modell gesendet wurden
- `toolsFallbackUsed` (`boolean`) -- Ob Auto-Modus auf ohne-Tools zurueckgefallen ist
- `attachments` (`object`) -- Angehaengte Dateien und Bilder
- `usage` (`object`) -- Aggregierte Usage fuer diesen Lauf (`turns`, `input_tokens`, `output_tokens`, `total_tokens`, ...)
- `message` (`string`) -- Finale Textantwort der KI
- `toolCalls` (`array`) -- Normalisierte Tool-Call-Records (`tool`, `input`, `ok`, `result`, `error`, `meta`)
- `timingMs` (`number`) -- Gesamte Ausfuehrungszeit in Millisekunden
- `error` (`string`) -- Fehlermeldung (nur wenn `ok` false ist)
- `code` (`string`) -- Fehlercode (nur wenn `ok` false ist)

## Exit-Codes

- `0` -- Erfolgreiche Ausfuehrung
- Ungleich null -- Fehler oder blockierte Operation

Fuer deterministische Automation immer die JSON-Felder `ok` und `code` parsen, anstatt sich nur auf Exit-Codes zu verlassen.
