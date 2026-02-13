# agent-cli

[![CI](https://github.com/Ad4m2017/agent-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Ad4m2017/agent-cli/actions/workflows/ci.yml)

Ein Zero-Dependency, Multi-Provider KI-Agent fuer das Terminal. Fuehrt Prompts aus, steuert Shell-Befehle und setzt Sicherheitsrichtlinien durch -- alles von der Kommandozeile, ohne Frameworks, Server oder Datenbanken.

## Warum agent-cli?

Die meisten KI-Coding-Tools binden dich an einen einzelnen Anbieter, brauchen schwere IDE-Plugins oder haengen von Cloud-Services ab. agent-cli geht einen anderen Weg:

- **Zero Dependencies** -- pures Node.js, kein `node_modules`, kein Supply-Chain-Risiko
- **Multi-Provider** -- wechsle zwischen 11 Anbietern (OpenAI, Copilot, DeepSeek, Groq, Mistral, etc.) mit einer Config-Aenderung
- **Security-first** -- konfigurierbare Allow/Deny-Regeln verhindern destruktive Operationen standardmaessig
- **Laeuft ueberall** -- SSH-Sessions, Container, CI-Pipelines, Remote-Server -- ueberall wo Node.js laeuft
- **Lokale Config** -- Credentials verlassen nie deinen Rechner, gespeichert in lokalem JSON mit restriktiven Dateiberechtigungen

## Inhaltsverzeichnis

- [Wie es funktioniert](#wie-es-funktioniert)
- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Schnellstart](#schnellstart)
- [Konzepte](#konzepte)
- [CLI-Referenz](#cli-referenz)
- [Dateien](#dateien)
- [Praxisbeispiele](#praxisbeispiele)
- [Fehlerbehebung](#fehlerbehebung)
- [Dokumentation](#dokumentation)
- [Lizenz](#lizenz)

## Wie es funktioniert

```
Du (Terminal)
  |
  |  node agent.js -m "Finde und behebe den fehlschlagenden Test"
  |
  v
agent.js
  |-- loest Provider + Model aus Config auf
  |-- sendet Prompt an KI via OpenAI-kompatible API
  |-- KI antwortet mit Text oder Tool-Calls
  |-- Tool-Call: run_command
  |     |-- geprueft gegen Sicherheitsrichtlinie (agent.json)
  |     |-- geprueft gegen Freigabemodus (ask/auto/never)
  |     |-- ausgefuehrt via execFile (kein Shell-Injection)
  |     |-- Ergebnis zurueck an KI
  |-- KI antwortet mit finaler Antwort
  v
Ausgabe (Text oder JSON)
```

Der Agent iteriert bis zu 5 Runden: Prompt -> KI-Antwort -> Tool-Ausfuehrung -> KI-Antwort, bis die KI eine finale Textantwort liefert.

## Voraussetzungen

- Node.js 18+ (20+ empfohlen)
- Internetzugang fuer Provider-APIs

Kein `npm install` noetig. Das Projekt hat null Runtime-Dependencies.

## Installation

```bash
git clone https://github.com/Ad4m2017/agent-cli.git
cd agent-cli
```

Das war's. Kein Build-Schritt, keine Paketinstallation.

## Schnellstart

### 1. Provider konfigurieren

```bash
node agent-connect.js
```

Der interaktive Wizard laesst dich einen Provider waehlen, deinen API-Key eingeben und Defaults setzen. Im TTY-Terminal: Pfeiltasten + Enter zur Navigation.

Oder direkt konfigurieren:

```bash
node agent-connect.js --provider openai
node agent-connect.js --provider copilot
node agent-connect.js --provider groq
```

### 2. Ersten Prompt ausfuehren

```bash
node agent.js -m "Welche Dateien sind in diesem Verzeichnis?"
```

### 3. Tool-Calling ausprobieren

```bash
node agent.js -m "Fuehre die Tests aus und fasse die Ergebnisse zusammen" --approval auto
```

Der Agent fuehrt `run_command` Tool-Calls automatisch aus, wenn `--approval auto` gesetzt ist.

## Konzepte

### Tool-Calling

Der Agent stellt dem KI-Modell ein `run_command`-Tool zur Verfuegung. Wenn das Modell entscheidet, dass ein Shell-Befehl bei der Beantwortung helfen wuerde, loest es einen Tool-Call aus. Der Agent fuehrt den Befehl aus, sendet die Ausgabe zurueck an das Modell, und das Modell verarbeitet das Ergebnis in seiner Antwort.

Das erzeugt eine **agentische Schleife**: Die KI kann Dateien inspizieren, Tests ausfuehren, Git-Status pruefen und ueber die Ausgabe nachdenken -- alles innerhalb eines einzigen Prompts.

### Sicherheitsmodi

Jeder Befehl, den die KI ausfuehren moechte, wird gegen eine Sicherheitsrichtlinie in `agent.json` geprueft. Es gibt drei Modi:

| Modus | Zweck | Erlaubt | Blockiert |
|-------|-------|---------|-----------|
| `plan` | Nur-Lesen / Erkundung | `ls`, `pwd`, `git status`, `git log`, `node -v` | `rm`, `sudo`, `docker`, `npm install`, `git push` |
| `build` | Normale Entwicklung | `git`, `node`, `npm`, `python`, `docker`, `make` | `rm`, `sudo`, `shutdown`, `mkfs`, `chown` |
| `unsafe` | Breiter Befehlsumfang | Alles (`*`) | `rm -rf /`, `mkfs`, `shutdown`, `reboot`, `poweroff` |

Unabhaengig vom Modus blockiert eine `denyCritical`-Liste immer katastrophale Befehle wie `rm -rf /`, `mkfs` und das Pipen von curl/wget in eine Shell.

Auswertungsreihenfolge: `denyCritical` -> `mode.deny` -> `mode.allow`.

### Freigabemodi (Approval)

Steuert, ob der Agent Befehle ohne Nachfrage ausfuehren darf:

- **`ask`** (Standard) -- fragt vor jeder Befehlsausfuehrung. Erfordert ein TTY-Terminal.
- **`auto`** -- fuehrt erlaubte Befehle sofort aus. Geeignet fuer Automation und CI.
- **`never`** -- blockiert jede Befehlsausfuehrung. Die KI kann nur mit Text antworten.

### Tools-Modi

Steuert, ob Tool-Calling-Payloads an das KI-Modell gesendet werden:

- **`auto`** (Standard) -- sendet Tools, faellt zurueck auf ohne-Tools wenn das Modell sie ablehnt
- **`on`** -- sendet immer Tools. Schlaegt fehl wenn das Modell sie nicht unterstuetzt.
- **`off`** -- deaktiviert Tool-Calling komplett. Die KI kann nur mit Text antworten.

### Provider

agent-cli nutzt die OpenAI-kompatible `/chat/completions` API fuer alle Provider ausser GitHub Copilot (der OAuth Device Flow + Runtime-Token-Austausch verwendet).

| Provider | Auth-Typ | Modelle |
|----------|----------|---------|
| `openai` | API-Key | gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-5-mini |
| `copilot` | GitHub OAuth | gpt-4o (via Copilot) |
| `deepseek` | API-Key | deepseek-chat, deepseek-reasoner |
| `groq` | API-Key | llama-3.3-70b, mixtral-8x7b |
| `mistral` | API-Key | mistral-small, mistral-large |
| `openrouter` | API-Key | Jedes Modell auf OpenRouter |
| `perplexity` | API-Key | sonar, sonar-pro, sonar-reasoning |
| `together` | API-Key | Llama-3.1-70B, Qwen2.5-72B |
| `fireworks` | API-Key | llama-v3p1-8b, qwen2p5-72b |
| `moonshot` | API-Key | moonshot-v1-8k/32k/128k |
| `xai` | API-Key | grok-2-latest, grok-2-mini |

## CLI-Referenz

### agent.js

```text
node agent.js -m "nachricht" [optionen]

Optionen:
  -m, --message <text>   Prompt ans Modell (erforderlich)
  --model <name>         Modell oder provider/model (z.B. openai/gpt-4.1)
  --config <pfad>        Pfad zu agent.json (Standard: ./agent.json)
  --auth-config <pfad>   Pfad zu agent.auth.json (Standard: ./agent.auth.json)
  --json                 Strukturiertes JSON mit Tool-Call-Details ausgeben
  --mode <name>          Sicherheitsmodus: plan, build, unsafe
  --approval <name>      Freigabemodus: ask, auto, never
  --tools <name>         Tools-Modus: auto, on, off
  --no-tools             Alias fuer --tools off
  --file <pfad>          Textdatei als Kontext anhaengen (wiederholbar, max 10)
  --image <pfad>         Bilddatei anhaengen (wiederholbar, max 5)
  --yes                  Alias fuer --approval auto
  --unsafe               Unsafe-Modus erzwingen (denyCritical-Regeln gelten weiterhin)
  --log                  Fehler-Logging in Datei aktivieren
  --log-file <pfad>      Log-Dateipfad (Standard: ./agent.js.log)
  --verbose              Zusaetzliche Laufzeitdiagnostik ausgeben
  --debug                Detaillierte Diagnostik ausgeben (impliziert --verbose)
  --stream               Assistant-Text streamen, wenn unterstuetzt
  --command-timeout <ms> Tool-Command-Timeout in Millisekunden
  --allow-insecure-http  Nicht-lokale HTTP Provider-Base-URLs erlauben
  -V, --version          Version anzeigen
  -h, --help             Hilfe anzeigen
```

Wenn `-m/--message` fehlt, liest agent-cli den Prompt aus stdin:

```bash
cat prompt.txt | node agent.js --approval auto
```

### agent-connect.js

```text
node agent-connect.js [--provider <name>] [optionen]

Provider: copilot, deepseek, fireworks, groq, mistral,
          moonshot, openai, openrouter, perplexity, together, xai

Optionen:
  --provider <name>  Provider ohne Menue waehlen
  --config <pfad>    Pfad zu agent.json (Standard: ./agent.json)
  --auth-config <pfad> Pfad zu agent.auth.json (Standard: ./agent.auth.json)
  -V, --version   Version anzeigen
  -h, --help      Hilfe anzeigen
```

## Dateien

| Datei | Zweck | Geheim? |
|-------|-------|---------|
| `agent.js` | Haupt-CLI-Runner -- Prompts, Tool-Calls, Ausgabe | Nein |
| `agent-connect.js` | Provider-Setup-Wizard | Nein |
| `agent.json` | Runtime-Defaults + Sicherheitsrichtlinie | Nein |
| `agent.auth.json` | Provider-Credentials und Tokens | **Ja** -- nicht committen |
| `docs/` | Generierte HTML-Dokumentation | Nein |
| `scripts/build-docs.js` | Markdown-zu-HTML Docs-Builder | Nein |

## Praxisbeispiele

### Codebase erkunden

```bash
node agent.js -m "Was macht dieses Projekt? Fasse die Architektur zusammen."
```

### Tests ausfuehren und Fehler analysieren

```bash
node agent.js -m "Fuehre npm test aus und erklaere eventuelle Fehler" --approval auto --mode build
```

### Datei reviewen

```bash
node agent.js -m "Pruefe diese Datei auf Bugs und Verbesserungen" --file src/utils.js
```

### Screenshot beschreiben

```bash
node agent.js -m "Was zeigt dieses UI?" --model openai/gpt-4o --image screenshot.png
```

### Automation in CI

```bash
OUT=$(node agent.js -m "Lint und Tests ausfuehren, Status melden" --json --approval auto --mode build)
echo "$OUT" | jq '.ok'
```

### Verschiedene Provider fuer verschiedene Aufgaben

```bash
# Schnelles Reasoning mit Groq
node agent.js -m "Erklaere diesen Fehler" --model groq/llama-3.3-70b-versatile --no-tools

# Suche-basierte Antworten mit Perplexity
node agent.js -m "Was sind die neuesten Node.js Security-Patches?" --model perplexity/sonar --no-tools

# Voller Agent mit OpenAI
node agent.js -m "Behebe den fehlschlagenden Test" --model openai/gpt-4.1 --approval auto
```

## Fehlerbehebung

| Fehlercode | Ursache | Loesung |
|------------|---------|---------|
| `PROVIDER_NOT_CONFIGURED` | Kein Provider eingerichtet | `node agent-connect.js --provider <name>` ausfuehren |
| `INTERACTIVE_APPROVAL_JSON` | `--approval ask` mit `--json` verwendet | `--approval auto` oder `--approval never` verwenden |
| `INTERACTIVE_APPROVAL_TTY` | `--approval ask` in Nicht-TTY-Umgebung | `--approval auto` verwenden oder interaktives Terminal nutzen |
| `VISION_NOT_SUPPORTED` | Bild an Text-only-Modell angehaengt | Vision-Modell verwenden (gpt-4o, gpt-4.1) oder `--image` entfernen |
| `TOOLS_NOT_SUPPORTED` | `--tools on` mit inkompatiblem Modell | `--tools auto` oder `--no-tools` verwenden |
| `FETCH_TIMEOUT` | Provider-Anfrage hat Timeout erreicht | Erneut versuchen oder anderen Provider/Modell nutzen |
| `RETRY_EXHAUSTED` | Transiente Retries mehrfach fehlgeschlagen | Provider-Status/Netzwerk pruefen und erneut versuchen |
| `INSECURE_BASE_URL` | Oeffentliche `http://` Base-URL blockiert | `https://`, lokalen/privaten Host oder `--allow-insecure-http` nutzen |
| `INVALID_BASE_URL` | Provider-Base-URL ist ungueltig/nicht unterstuetzt | `baseUrl` in der Config korrigieren |
| `COPILOT_DEVICE_CODE_EXPIRED` | OAuth-Code abgelaufen | `node agent-connect.js --provider copilot` erneut ausfuehren |
| `ATTACHMENT_TOO_LARGE` | Datei > 200KB oder Bild > 5MB | Kleinere Datei verwenden oder aufteilen |
| `AUTH_CONFIG_INVALID` | `agent.auth.json` beschaedigt | Datei loeschen und `node agent-connect.js` erneut ausfuehren |

Exit-Codes sind fuer Automation vereinheitlicht:

- `1` generischer Laufzeit-/Connect-Fehler
- `2` agent-config Fehler (`agent.json`)
- `3` auth-config Fehler (`agent.auth.json`)
- `4` Provider-Konfigurations-/Auswahlfehler
- `5` interaktiver Approval-Constraint-Fehler
- `6` Provider-Capability-/Copilot-Flow-Fehler
- `7` Fetch-Timeout
- `8` Retry ausgeschopft
- `9` Attachment-Validierungsfehler

## Dokumentation

Vollstaendige Dokumentation mit Beispielen, Config-Referenz und Architekturdetails:

- Englisch: https://ad4m2017.github.io/agent-cli/
- Deutsch: https://ad4m2017.github.io/agent-cli/de/

Docs lokal bauen:

```bash
node scripts/build-docs.js
```

## Englisches README

Das englische README ist verfuegbar unter [README.md](README.md).

## Version

Aktuelle Version: `1.0.0` -- siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

MIT Lizenz -- siehe [LICENSE](LICENSE) fuer Details.
