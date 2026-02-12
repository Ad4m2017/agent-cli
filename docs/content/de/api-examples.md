# Skript- und CI-Beispiele

Diese Beispiele helfen bei stabiler JSON-Automation.

## Regeln fuer Automation

- Immer `--json` verwenden
- `--approval auto` oder `--approval never` nutzen
- `--approval ask` in Automation vermeiden

## Bash

```bash
set -euo pipefail

OUT=$(node agent.js -m "Run tests and summarize" --json --approval auto --mode build)
echo "$OUT"
```

## PowerShell

```powershell
$out = node agent.js -m "Run tests and summarize" --json --approval auto --mode build
$obj = $out | ConvertFrom-Json
$obj.message
```

## JSON Fehlerbeispiel

```json
{
  "ok": false,
  "error": "Interactive approval is not supported with --json. Use --approval auto or --approval never.",
  "code": "INTERACTIVE_APPROVAL_JSON"
}
```

## Exit Handling

- `0`: erfolgreich
- ungleich `0`: Fehler oder blockierte Operation
