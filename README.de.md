# agent.js + agent-connect.js (Deutsch)

Minimales lokales CLI-Agent-Projekt mit separatem Setup-Wizard.

- `agent.js` fuehrt Prompts und Tool-Calls aus.
- `agent-connect.js` richtet Provider und Defaults ein.

## Schnellstart

```bash
node agent-connect.js --provider copilot
node agent.js -m "Hallo"
```

Im interaktiven Terminal unterstuetzt der Wizard die Auswahl mit Up/Down + Enter.

## Doku bauen

```bash
node scripts/build-docs.js
```

## Wichtige Hinweise

- `agent.auth.json` enthaelt Klartext-Secrets. Nicht committen.
- Standard-Doku ist Englisch in `docs/index.html`.
- Deutsche Doku liegt unter `docs/de/index.html`.

## Lizenz

MIT Lizenz - siehe [LICENSE](../LICENSE) Datei für Details.
