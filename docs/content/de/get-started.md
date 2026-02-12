# Agent CLI Doku

Minimale, professionelle lokale Agent-CLI mit Provider-Setup, Security-Policy, Freigabe-Mechanismus und JSON-Automation.

## Ueberblick

- `agent.js` fuehrt Prompts und Tool-Calls aus.
- `agent-connect.js` konfiguriert Provider und Defaults.
- `agent.json` speichert Runtime-Defaults und Sicherheitsregeln.
- `agent.auth.json` speichert Provider-Credentials und Tokens.

## Einrichtung

Wizard starten:

```bash
node agent-connect.js
```

Direkt mit Provider:

```bash
node agent-connect.js --provider openai
node agent-connect.js --provider moonshot
node agent-connect.js --provider deepseek
node agent-connect.js --provider copilot
```

Im interaktiven Terminal: Auswahl mit Up/Down + Enter.

## Erste Nutzung

```bash
node agent.js -m "Hallo"
```

Mit festem Modell:

```bash
node agent.js -m "Analysiere dieses Projekt" --model copilot/gpt-4o
```

## Wichtige Modi

### Approval

- `ask`: vor jedem Kommando fragen
- `auto`: erlaubte Kommandos direkt ausfuehren
- `never`: Kommandos blockieren

### Tools

- `auto`: mit Tools starten, bei Inkompatibilitaet ohne Tools wiederholen
- `on`: Tool-Calling immer aktiv
- `off`: Tool-Calling deaktiviert

Beispiele:

```bash
node agent.js -m "wie gehts dir?" --model perplexity/sonar --no-tools
node agent.js -m "repo check" --approval ask --mode build
```

### Dateien und Bilder anhaengen

```bash
node agent.js -m "Erklaere diese Datei" --file src/app.ts
node agent.js -m "Beschreibe dieses UI" --model openai/gpt-4o --image screenshot.png
```

Limits:

- Dateien: max 10, max 200KB je Datei
- Bilder: max 5, max 5MB je Bild (`.png`, `.jpg`, `.jpeg`, `.webp`)
- Bild + text-only Modell => `VISION_NOT_SUPPORTED`

## CLI Referenz

```text
node agent.js -m "message" [options]
node agent-connect.js [--provider copilot|deepseek|fireworks|groq|mistral|moonshot|openai|openrouter|perplexity|together|xai]
```

## Fehlerbehebung

- `PROVIDER_NOT_CONFIGURED`: `node agent-connect.js --provider <name>` ausfuehren
- `INTERACTIVE_APPROVAL_JSON`: bei `--json` nur `--approval auto|never` nutzen
- `INTERACTIVE_APPROVAL_TTY`: interaktives Terminal nutzen oder `--approval auto`
