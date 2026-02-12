# Konfigurationsreferenz

Vollstaendige Referenz fuer die Konfigurationsdateien `agent.json` und `agent.auth.json`.

## Ueberblick

agent-cli nutzt zwei lokale JSON-Dateien fuer die Konfiguration:

- `agent.json` -- Nicht-geheime Runtime-Defaults und Sicherheitsrichtlinie. Kann committet werden.
- `agent.auth.json` -- Provider-Credentials und Tokens. Niemals committen.

Beide Dateien werden automatisch von `node agent-connect.js` erstellt. Du kannst sie auch manuell bearbeiten.

## Doku neu bauen

Nach Aenderungen an Markdown-Quellen, HTML neu generieren:

```bash
node scripts/build-docs.js
```

## agent.json

Diese Datei steuert Runtime-Verhalten und Sicherheitsrichtlinie. Sie wird mit sinnvollen Defaults vom Setup-Wizard erstellt.

### Vollstaendiges Beispiel

```json
{
  "version": 1,
  "runtime": {
    "defaultProvider": "openai",
    "defaultModel": "openai/gpt-4.1-mini",
    "defaultMode": "build",
    "defaultApprovalMode": "ask",
    "defaultToolsMode": "auto"
  },
  "security": {
    "mode": "build",
    "denyCritical": [
      "rm -rf /",
      "mkfs",
      "shutdown",
      "reboot",
      "poweroff",
      "dd if=",
      "re:curl\\s+.*\\|\\s*(sh|bash)",
      "re:wget\\s+.*\\|\\s*(sh|bash)"
    ],
    "modes": {
      "plan": {
        "allow": ["pwd", "ls", "whoami", "date", "git status", "git branch", "git diff", "git log", "node -v", "npm -v"],
        "deny": ["rm", "sudo", "chmod", "chown", "mv", "cp", "docker", "npm install", "git push"]
      },
      "build": {
        "allow": ["pwd", "ls", "whoami", "date", "git", "node", "npm", "pnpm", "yarn", "bun", "python", "pytest", "go", "cargo", "make", "docker"],
        "deny": ["rm", "sudo", "shutdown", "reboot", "mkfs", "chown"]
      },
      "unsafe": {
        "allow": ["*"],
        "deny": ["rm -rf /", "mkfs", "shutdown", "reboot", "poweroff"]
      }
    }
  }
}
```

### runtime

- `defaultProvider` (`string`) -- Provider-Kennung (z.B. `"openai"`, `"copilot"`, `"groq"`). Wird verwendet wenn `--model` keinen Provider-Prefix hat.
- `defaultModel` (`string`) -- Vollstaendige Modell-Kennung im Format `provider/model` (z.B. `"openai/gpt-4.1-mini"`). Wird verwendet wenn `--model` nicht uebergeben wird.
- `defaultMode` (`string`: `"plan"`, `"build"`, `"unsafe"`) -- Sicherheitsmodus wenn `--mode` nicht uebergeben wird. Standard: `"build"`.
- `defaultApprovalMode` (`string`: `"ask"`, `"auto"`, `"never"`) -- Freigabemodus wenn `--approval` nicht uebergeben wird. Standard: `"ask"`.
- `defaultToolsMode` (`string`: `"auto"`, `"on"`, `"off"`) -- Tools-Modus wenn `--tools` nicht uebergeben wird. Standard: `"auto"`.
- `approvalTimeoutMs` (`number`, optional) -- Timeout in Millisekunden fuer die interaktive Freigabe-Abfrage. 0 oder weggelassen bedeutet kein Timeout.

### security

- `mode` (`string`) -- Aktiver Sicherheitsmodus. Sollte mit `runtime.defaultMode` uebereinstimmen.
- `denyCritical` (`string[]`) -- Befehle die immer blockiert werden, unabhaengig vom Modus. Unterstuetzt Klartext-Matching und Regex via `re:`-Prefix.
- `modes` (`object`) -- Modusspezifische Allow/Deny-Regelsets.

### security.modes.<mode>

- `allow` (`string[]`) -- In diesem Modus erlaubte Befehle. `"*"` fuer alle verwenden.
- `deny` (`string[]`) -- In diesem Modus blockierte Befehle.

### Regel-Matching

Regeln werden gegen den vollstaendigen Befehlsstring gematcht:

- `"*"` -- matcht jeden Befehl
- `"re:<pattern>"` -- Regex-Match (case-insensitive). Beispiel: `"re:curl\\s+.*\\|\\s*(sh|bash)"`
- Klartext -- exakter Match oder Prefix-Match. `"git"` matcht `"git status"`, `"git push"`, etc.

### Entscheidungsreihenfolge

1. `denyCritical` -- wird zuerst geprueft, gewinnt immer
2. `modes[mode].deny` -- wird als zweites geprueft
3. `modes[mode].allow` -- wird zuletzt geprueft, Befehl muss mindestens eine Allow-Regel matchen

Wenn ein Befehl `denyCritical` oder `deny` matcht, wird er blockiert. Wenn er keine `allow`-Regel matcht, wird er ebenfalls blockiert.

## agent.auth.json

Diese Datei speichert Provider-Credentials. Dateiberechtigungen werden auf `0600` gesetzt (nur Eigentuemer lesen/schreiben). Diese Datei niemals committen.

### OpenAI-kompatibles Provider-Beispiel

```json
{
  "version": 1,
  "defaultProvider": "openai",
  "defaultModel": "openai/gpt-4.1-mini",
  "providers": {
    "openai": {
      "kind": "openai_compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-..."
    }
  }
}
```

Felder:

- `kind` (`string`) -- Immer `"openai_compatible"` fuer API-Key-Provider.
- `baseUrl` (`string`) -- Provider API Base-URL.
- `apiKey` (`string`) -- Dein API-Key.

### GitHub Copilot Provider-Beispiel

```json
{
  "version": 1,
  "defaultProvider": "copilot",
  "defaultModel": "copilot/gpt-4o",
  "providers": {
    "copilot": {
      "kind": "github_copilot",
      "githubToken": "gho_...",
      "githubRefreshToken": "ghr_...",
      "githubTokenExpiresAt": "2025-01-15T12:00:00.000Z",
      "copilotToken": "tid=...",
      "copilotTokenExpiresAt": "2025-01-15T12:30:00.000Z",
      "oauth": {
        "clientId": "Iv1.b507a08c87ecfe98",
        "accessTokenUrl": "https://github.com/login/oauth/access_token"
      },
      "api": {
        "copilotTokenUrl": "https://api.github.com/copilot_internal/v2/token",
        "baseUrl": "https://api.githubcopilot.com"
      },
      "extraHeaders": {
        "Editor-Version": "vscode/1.85.1",
        "Editor-Plugin-Version": "copilot-chat/0.12.0",
        "User-Agent": "agent.js-copilot"
      }
    }
  }
}
```

Felder:

- `kind` (`string`) -- Immer `"github_copilot"`.
- `githubToken` (`string`) -- GitHub OAuth Access Token.
- `githubRefreshToken` (`string`) -- GitHub OAuth Refresh Token.
- `githubTokenExpiresAt` (`string`) -- ISO-Zeitstempel des GitHub-Token-Ablaufs.
- `copilotToken` (`string`) -- Kurzlebiger Copilot Runtime-Token.
- `copilotTokenExpiresAt` (`string`) -- ISO-Zeitstempel des Copilot-Token-Ablaufs.
- `oauth` (`object`) -- OAuth-Endpoint-Konfiguration.
- `api` (`object`) -- Copilot API-Endpoint-Konfiguration.
- `extraHeaders` (`object`) -- Zusaetzliche Header fuer Copilot API-Anfragen.

### Mehrere Provider

Du kannst mehrere Provider gleichzeitig konfigurieren:

```json
{
  "version": 1,
  "defaultProvider": "openai",
  "defaultModel": "openai/gpt-4.1-mini",
  "providers": {
    "openai": {
      "kind": "openai_compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-..."
    },
    "groq": {
      "kind": "openai_compatible",
      "baseUrl": "https://api.groq.com/openai/v1",
      "apiKey": "gsk_..."
    },
    "copilot": {
      "kind": "github_copilot",
      "githubToken": "gho_..."
    }
  }
}
```

Zwischen Providern wechseln mit `--model provider/model`:

```bash
node agent.js -m "Hallo" --model groq/llama-3.3-70b-versatile
node agent.js -m "Hallo" --model openai/gpt-4.1
```

### Token-Refresh

Copilot-Tokens sind kurzlebig (ca. 25 Minuten). Der Agent erneuert sie automatisch:

1. Prueft ob der Copilot-Token noch gueltig ist (mit 60-Sekunden-Puffer)
2. Falls abgelaufen, holt einen neuen Copilot-Token mit dem GitHub Access Token
3. Falls der GitHub-Token ebenfalls abgelaufen ist (HTTP 401), erneuert ihn mit dem Refresh Token
4. Speichert aktualisierte Tokens in `agent.auth.json`

Wenn alle Tokens abgelaufen sind und der Refresh fehlschlaegt: `node agent-connect.js --provider copilot` erneut ausfuehren.

## Error-Code-Referenz

### agent.js Fehler

- `ATTACHMENT_NOT_FOUND` -- Dateipfad existiert nicht
- `ATTACHMENT_UNREADABLE` -- Datei nicht als UTF-8-Text lesbar
- `ATTACHMENT_TOO_LARGE` -- Datei ueberschreitet 200KB oder Bild ueberschreitet 5MB
- `ATTACHMENT_TOO_MANY_FILES` -- Mehr als 10 Dateien angehaengt
- `ATTACHMENT_TOO_MANY_IMAGES` -- Mehr als 5 Bilder angehaengt
- `ATTACHMENT_TYPE_UNSUPPORTED` -- Bildformat nicht in: .png, .jpg, .jpeg, .webp
- `VISION_NOT_SUPPORTED` -- Bild an Text-only-Modell angehaengt
- `PROVIDER_NOT_CONFIGURED` -- Provider nicht in agent.auth.json gefunden
- `INTERACTIVE_APPROVAL_JSON` -- `--approval ask` mit `--json` nicht moeglich
- `INTERACTIVE_APPROVAL_TTY` -- `--approval ask` ohne TTY nicht moeglich
- `TOOLS_NOT_SUPPORTED` -- Modell unterstuetzt kein Tool-Calling (mit `--tools on`)
- `AGENT_CONFIG_INVALID` -- agent.json ist kein gueltiges JSON
- `AUTH_CONFIG_INVALID` -- agent.auth.json ist kein gueltiges JSON
- `AGENT_CONFIG_ERROR` -- agent.json konnte nicht gelesen werden
- `AUTH_CONFIG_ERROR` -- agent.auth.json konnte nicht gelesen werden
- `RUNTIME_ERROR` -- Unbehandelter Laufzeitfehler

### agent-connect.js Fehler

- `PROVIDER_INVALID` -- Unbekannter Provider-Name
- `API_KEY_REQUIRED` -- Leerer API-Key beim Setup
- `AUTH_CONFIG_INVALID` -- agent.auth.json ist kein gueltiges JSON
- `AGENT_CONFIG_INVALID` -- agent.json ist kein gueltiges JSON
- `COPILOT_DEVICE_START_FAILED` -- GitHub Device Flow konnte nicht gestartet werden
- `COPILOT_DEVICE_FLOW_FAILED` -- Device Flow Authentifizierung fehlgeschlagen
- `COPILOT_DEVICE_CODE_EXPIRED` -- Device Code abgelaufen bevor Benutzer bestaetigt hat
- `COPILOT_RUNTIME_TOKEN_FAILED` -- GitHub-Token konnte nicht gegen Copilot-Token getauscht werden
- `COPILOT_RUNTIME_TOKEN_MISSING` -- Copilot-Token-Antwort war leer
- `COPILOT_TOKEN_MISSING` -- Kein Access Token in Device-Flow-Antwort
- `PROVIDER_UNSUPPORTED` -- Provider-Typ nicht unterstuetzt
- `SELECT_OPTIONS_EMPTY` -- Wizard-Menue hat keine Optionen
- `INTERRUPTED` -- Benutzer hat Ctrl+C waehrend des Wizards gedrueckt
- `CONNECT_ERROR` -- Unbehandelter Fehler waehrend des Setups

## CLI-Prioritaet

Konfigurationswerte werden in dieser Reihenfolge aufgeloest (erstes gewinnt):

1. CLI-Flags (`--model`, `--mode`, `--approval`, `--tools`, `--unsafe`)
2. `agent.json` Runtime-Defaults
3. `agent.auth.json` Defaults (`defaultProvider`, `defaultModel`)
4. Hardcodierte Fallbacks (`gpt-4.1-mini`, `build`, `ask`, `auto`)
