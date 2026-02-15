# Agent CLI Dokumentation

Ein Zero-Dependency, Multi-Provider KI-Agent fuer das Terminal. Keine Frameworks, keine Server, keine Datenbanken -- nur Node.js und dein bevorzugter KI-Anbieter.

## Warum agent-cli?

- **Zero Dependencies** -- kein `node_modules`, kein Supply-Chain-Risiko
- **11 Provider** -- Anbieter wechseln mit einer Config-Aenderung
- **Security-first** -- konfigurierbare Befehlsrichtlinien verhindern destruktive Operationen
- **Laeuft ueberall** -- SSH, Container, CI, Remote-Server
- **Lokale Config** -- Credentials bleiben auf deinem Rechner

## Wie es funktioniert

agent-cli sendet deinen Prompt an ein KI-Modell ueber die OpenAI-kompatible Chat-Completions-API. Das Modell kann mit reinem Text antworten oder Tool-Calls anfordern. Der Agent unterstuetzt spezialisierte Tools fuer Dateien/Suche/Patches plus `run_command`.

Die Ausfuehrung folgt einer agentischen Schleife:

1. Du sendest einen Prompt
2. Das KI-Modell verarbeitet den Prompt
3. Wenn das Modell Tool-Ausfuehrung braucht, loest es einen Tool-Call aus (z.B. `read_file`, `search_content`, `apply_patch` oder `run_command`)
4. Der Agent prueft den Befehl gegen die Sicherheitsrichtlinien
5. Falls erlaubt, fuehrt der Agent den Befehl aus und sendet die Ausgabe zurueck
6. Das Modell verarbeitet die Ausgabe und loest weitere Tool-Calls aus oder antwortet mit Text
7. Die Schleife laeuft fuer bis zu 5 Runden

Das bedeutet: Die KI kann Dateien inspizieren, Tests ausfuehren, Git-History pruefen und ueber Ergebnisse nachdenken -- alles innerhalb eines einzigen Prompts.

## Voraussetzungen

- Node.js 18+ (20+ empfohlen)
- Internetzugang fuer Provider-APIs
- Kein `npm install` erforderlich

## Installation

```bash
git clone https://github.com/Ad4m2017/agent-cli.git
cd agent-cli
```

Kein Build-Schritt. Keine Paketinstallation.

## Provider konfigurieren

Starte den interaktiven Setup-Wizard:

```bash
node agent-connect.js
```

Im TTY-Terminal: Pfeiltasten und Enter zur Navigation. Der Wizard schreibt:

- Runtime-Defaults und Sicherheitsrichtlinie in `agent.json`
- Provider-Credentials in `agent.auth.json` (Klartext, Dateiberechtigungen auf 0600 gesetzt)

Wizard-Verhalten beinhaltet:

- Provider-Statuslabels (`installed`, `installed, default`, `not configured`)
- Top-Level-Schnellaktion: `Set default provider/model only`
- Optionales Model-Refresh via live Provider-Endpoint `/models`
- Optionales Fallback-Model-Loading von `models.dev`
- Provider-Quelle: `Load provider from models.dev...` (importiert Provider-API-URL und Model-Kandidaten)
- Paged-Navigation fuer lange Listen (`n`/`p` springt um 10)

Konfigurationsdateien werden jetzt atomar geschrieben (Temp-Datei + Rename), um das Risiko beschaedigter JSON-Dateien bei Abbruch waehrend des Schreibens zu reduzieren.

### Direktes Provider-Setup

```bash
node agent-connect.js --provider openai
node agent-connect.js --provider copilot
node agent-connect.js --provider groq
node agent-connect.js --provider deepseek
node agent-connect.js --provider mistral
node agent-connect.js --provider openrouter
node agent-connect.js --provider perplexity
node agent-connect.js --provider together
node agent-connect.js --provider fireworks
node agent-connect.js --provider moonshot
node agent-connect.js --provider xai
node agent-connect.js --provider ollama
node agent-connect.js --provider lmstudio
```

### Copilot-Setup

GitHub Copilot nutzt den OAuth Device Flow. Der Wizard wird:

1. Einen Device-Code generieren
2. Dich auffordern, eine URL im Browser zu oeffnen
3. Den Code auf GitHub einzugeben
4. Automatisch Tokens austauschen, sobald bestaetigt

Copilot-Tokens sind kurzlebig. Der Agent erneuert sie automatisch vor Ablauf.

## Erster Start

```bash
node agent.js -m "Welche Dateien sind in diesem Verzeichnis?"
```

Bestimmten Provider und Modell erzwingen:

```bash
node agent.js -m "Analysiere dieses Projekt" --model copilot/gpt-4o
node agent.js -m "Erklaere diesen Fehler" --model groq/llama-3.3-70b-versatile
```

## Konzepte

### Tool-Calling

Der Agent stellt dem KI-Modell spezialisierte Tools bereit (`read_file`, `list_files`, `search_content`, `write_file`, `delete_file`, `move_file`, `mkdir`, `apply_patch`) plus `run_command`. Wenn das Modell entscheidet, dass ein Tool bei der Beantwortung hilft, gibt es einen Tool-Call zurueck statt Text. Der Agent fuehrt das Tool aus, sendet die Ausgabe zurueck, und das Modell verarbeitet das Ergebnis.

Das erzeugt eine agentische Schleife, in der die KI:

- Dateien auflisten und lesen kann
- Tests und Linter ausfuehren kann
- Git-Status und History pruefen kann
- Build-Befehle ausfuehren kann
- Laufende Prozesse inspizieren kann

Die Schleife laeuft fuer bis zu 5 Runden, bevor der Agent eine finale Textantwort erzwingt.

### Sicherheitsmodi

Jeder Befehl, den die KI ausfuehren moechte, wird gegen eine dreischichtige Sicherheitsrichtlinie in `agent.json` geprueft:

**Schicht 1: denyCritical** -- blockiert immer katastrophale Befehle, unabhaengig vom Modus:

- `rm -rf /`
- `mkfs`
- `shutdown`, `reboot`, `poweroff`
- `dd if=`
- Pipen von curl/wget in sh/bash

**Schicht 2: Modusspezifische Deny-Regeln** -- blockiert Befehle basierend auf dem aktuellen Modus.

**Schicht 3: Modusspezifische Allow-Regeln** -- nur explizit erlaubte Befehle koennen ausgefuehrt werden.

Auswertungsreihenfolge: denyCritical -> deny -> allow. Ein Befehl muss alle drei Schichten bestehen.

Die drei Modi:

- **plan** -- Nur-Lesen-Erkundung. Nur `ls`, `pwd`, `git status`, `git log`, `node -v`, `npm -v` erlaubt. Destruktive Befehle, Paketinstallationen und Pushes sind blockiert.
- **build** (Standard) -- Normale Entwicklung. Git, Node.js, npm, Python, Docker, Make sind erlaubt. `rm`, `sudo` und System-Level-Befehle sind blockiert.
- **unsafe** -- Breiter Umfang. Alle Befehle erlaubt ausser `denyCritical`-Eintraege. Mit Vorsicht verwenden.

### Freigabemodi (Approval)

Steuert das Human-in-the-Loop-Verhalten fuer die Befehlsausfuehrung:

- **ask** (Standard) -- Der Agent fragt vor jedem Befehl: `Approve? [y/N]`. Erfordert ein TTY-Terminal. Das ist der sicherste Modus fuer interaktive Nutzung.
- **auto** -- Fuehrt richtlinienkonforme Befehle sofort ohne Nachfrage aus. Erforderlich fuer CI/CD und Scripting. Mit `--json` fuer Automation verwenden.
- **never** -- Blockiert jede Befehlsausfuehrung. Die KI kann nur mit Text antworten, nie Befehle ausfuehren.

### Tools-Modi

Steuert, ob Tool-Calling-Payloads in API-Anfragen enthalten sind:

- **auto** (Standard) -- Sendet Tool-Definitionen an das Modell. Wenn das Modell sie ablehnt (z.B. Perplexity-Modelle), automatischer Retry ohne Tools.
- **on** -- Sendet immer Tool-Definitionen. Gibt `TOOLS_NOT_SUPPORTED`-Fehler zurueck wenn das Modell sie nicht verarbeiten kann.
- **off** -- Sendet nie Tool-Definitionen. Die KI antwortet nur mit Text.

`--no-tools` als Abkuerzung fuer `--tools off` verwenden.

### Provider

Alle Provider ausser Copilot nutzen den Standard-OpenAI-kompatiblen `/chat/completions`-Endpoint. Das bedeutet: jeder OpenAI-kompatible Dienst funktioniert.

- **openai** -- gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini, gpt-5-mini
- **copilot** -- GitHub Copilot via OAuth Device Flow
- **deepseek** -- deepseek-chat, deepseek-reasoner, deepseek-v3
- **groq** -- llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768
- **mistral** -- mistral-small-latest, mistral-medium-latest, mistral-large-latest
- **openrouter** -- Jedes auf OpenRouter verfuegbare Modell
- **perplexity** -- sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro
- **together** -- Llama-3.1-70B-Instruct-Turbo, Qwen2.5-72B-Instruct-Turbo
- **fireworks** -- llama-v3p1-8b-instruct, qwen2p5-72b-instruct
- **moonshot** -- moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
- **xai** -- grok-2-latest, grok-2-mini-latest, grok-beta

### Datei- und Bild-Anhaenge

Dateien und Bilder als Kontext fuer die KI anhaengen:

```bash
node agent.js -m "Pruefe diese Datei" --file src/app.ts
node agent.js -m "Beschreibe dieses UI" --model openai/gpt-4o --image screenshot.png
node agent.js -m "Vergleiche diese" --file a.js --file b.js
```

Limits:

- Standardmaessig gibt es keine hardcodierten Attachment-Limits.
- Optionale Limits mit `--max-file-bytes`, `--max-image-bytes`, `--max-files`, `--max-images` setzen.
- Validierung ist strikt: Werte muessen Integer `>= 0` sein; `0` bedeutet unbegrenzt.
- Dateien muessen weiterhin UTF-8-Text sein.
- Bildformate: `.png`, `.jpg`, `.jpeg`, `.webp`.
- Bilder erfordern ein Vision-faehiges Modell (gpt-4o, gpt-4.1, gpt-5, Gemini). Text-only-Modelle geben `VISION_NOT_SUPPORTED` zurueck.

## Anwendungsbeispiele

### Codebase erkunden

```bash
node agent.js -m "Was macht dieses Projekt? Fasse die Architektur zusammen."
```

### Tests ausfuehren und Fehler analysieren

```bash
node agent.js -m "Fuehre npm test aus und erklaere eventuelle Fehler" --approval auto --profile dev
```

### Bestimmte Datei reviewen

```bash
node agent.js -m "Pruefe diese Datei auf Bugs" --file src/utils.js --no-tools
```

### Verschiedene Provider fuer verschiedene Aufgaben

```bash
# Schnelles Reasoning
node agent.js -m "Erklaere diesen Fehler" --model groq/llama-3.3-70b-versatile --no-tools

# Suche-basierte Antworten
node agent.js -m "Neueste Node.js Security-Patches?" --model perplexity/sonar --no-tools

# Voller Agent-Modus
node agent.js -m "Behebe den fehlschlagenden Test" --model openai/gpt-4.1 --approval auto
```

### JSON-Ausgabe fuer Scripting

```bash
node agent.js -m "Tests ausfuehren" --json --approval auto --profile dev
```

## CLI-Referenz

```text
node agent.js -m "nachricht" [optionen]

Optionen:
  -m, --message <text>   Prompt ans Modell (erforderlich)
  --model <provider/model|model>
  --config <pfad>        Pfad zu agent.json (Standard: ./agent.json)
  --auth-config <pfad>   Pfad zu agent.auth.json (Standard: ./agent.auth.json)
  --json
  --profile <safe|dev|framework>
  --mode <plan|build|unsafe>   # Legacy-Alias
  --approval <ask|auto|never>
  --tools <auto|on|off>
  --no-tools
  --file <pfad>          (wiederholbar)
  --image <pfad>         (wiederholbar)
  --system-prompt <text> Optionaler System-Prompt (leer deaktiviert die System-Role)
  --max-file-bytes <n>   Integer >= 0, 0 = unbegrenzt
  --max-image-bytes <n>  Integer >= 0, 0 = unbegrenzt
  --max-files <n>        Integer >= 0, 0 = unbegrenzt
  --max-images <n>       Integer >= 0, 0 = unbegrenzt
  --yes                  Alias fuer --approval auto
  --stats [N]            Usage-Statistiken anzeigen (alle Modelle oder Top N)
  --json-schema          JSON-Schema fuer --json-Output ausgeben
  --unsafe               Unsafe-Modus erzwingen
  --log                  Fehler-Logging aktivieren
  --log-file <pfad>      Standard: ./agent.js.log
  --verbose              Zusaetzliche Laufzeitdiagnostik
  --debug                Detaillierte Diagnostik (impliziert --verbose)
  --stream               Assistant-Text streamen wenn unterstuetzt (deaktiviert bei --json und Tool-Turns)
  --command-timeout <ms> Tool-Command-Timeout in Millisekunden
  --allow-insecure-http  Nicht-lokale HTTP Provider-Base-URLs erlauben
  --help
  --version
```

Usage-Stats sind optional ueber `runtime.usageStats.enabled=true` in `agent.json`.
Die `--stats` Text-Ausgabe zeigt Gesamtwerte plus Aufschluesselungen nach Provider/Model mit Rohwerten und kompakter Form (z.B. `12345 (12.3k)`).

Wenn `-m/--message` fehlt, wird der Prompt aus stdin gelesen:

```bash
cat prompt.txt | node agent.js --approval auto
```

```text
node agent-connect.js [--provider <name>] [--config <path>] [--auth-config <path>] [--help] [--version]
```

## Fehlerbehebung

- `PROVIDER_NOT_CONFIGURED`: `node agent-connect.js --provider <name>` ausfuehren
- `INTERACTIVE_APPROVAL_JSON`: `--approval auto` oder `--approval never` mit `--json` verwenden
- `INTERACTIVE_APPROVAL_TTY`: Interaktives Terminal nutzen oder `--approval auto` verwenden
- `VISION_NOT_SUPPORTED`: Vision-Modell (gpt-4o, gpt-4.1) verwenden oder `--image` entfernen
- `TOOLS_NOT_SUPPORTED`: `--tools auto` oder `--no-tools` verwenden
- `FETCH_TIMEOUT`: Provider-Anfrage hat Timeout erreicht
- `RETRY_EXHAUSTED`: Retries bei transienten Provider-Fehlern ausgeschopft
- `INSECURE_BASE_URL`: Oeffentliche HTTP-Base-URL abgelehnt (HTTPS, lokalen/privaten Host oder `--allow-insecure-http` nutzen)
- `INVALID_BASE_URL`: Provider-Base-URL ist ungueltig oder nutzt ein nicht unterstuetztes Protokoll
- `COPILOT_DEVICE_CODE_EXPIRED`: `node agent-connect.js --provider copilot` erneut ausfuehren
- `ATTACHMENT_LIMIT_INVALID`: Ungueltiger Limit-Wert (muss Integer >= 0 sein)
- `ATTACHMENT_TOO_LARGE`: Anhang ueberschreitet konfiguriertes Byte-Limit
- `AUTH_CONFIG_INVALID`: `agent.auth.json` loeschen und `node agent-connect.js` erneut ausfuehren

Exit-Code-Mapping fuer CI/CD:

- `1` generischer Laufzeit-/Connect-Fehler
- `2` agent-config Fehler (`agent.json`)
- `3` auth-config Fehler (`agent.auth.json`)
- `4` Provider-Konfigurations-/Auswahlfehler
- `5` interaktiver Approval-Constraint-Fehler
- `6` Provider-Capability-/Copilot-Flow-Fehler
- `7` Fetch-Timeout
- `8` Retry ausgeschopft
- `9` Attachment-Validierungsfehler
