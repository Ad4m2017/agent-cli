# agent.js + agent-connect.js

Minimal local CLI agent with a separate provider setup wizard.

- `agent.js` runs prompts and tool calls.
- `agent-connect.js` configures providers and defaults.
- No server, no framework, no database.

## Files

- `agent.js`: main runner
- `agent-connect.js`: setup wizard
- `agent.json`: runtime defaults + security policy
- `agent.auth.json`: provider credentials/tokens (plaintext)
- `docs/content/en/*.md`: English docs source
- `docs/content/de/*.md`: German docs source (optional)
- `docs/index.html`: generated English docs (default)
- `docs/de/index.html`: generated German docs
- `scripts/build-docs.js`: markdown -> HTML docs builder
- `.gitignore`: ignores secret/log files

## Requirements

- Node.js 18+ (20+ recommended)
- Internet access for provider APIs

## Quick Start

```bash
node agent-connect.js --provider copilot
node agent.js -m "Hello"
```

In interactive terminals, the setup wizard supports Up/Down + Enter menus.

## Documentation

Live docs:

- EN: https://ad4m2017.github.io/agent-cli/
- DE: https://ad4m2017.github.io/agent-cli/de/

Build docs from markdown sources:

```bash
node scripts/build-docs.js
```

Open in browser:

```text
docs/index.html
docs/api-examples.html
docs/config-reference.html
docs/de/index.html
docs/de/api-examples.html
docs/de/config-reference.html
```

## CLI

### `agent.js`

```text
node agent.js -m "message" [options]

Options:
  -m, --message <text>   Model prompt (required)
  --model <name>         Model or provider/model
  --json                 Output JSON with tool details
  --log                  Log errors to file
  --log-file <path>      Log path (default: ./agent.js.log)
  --mode <name>          Security mode (plan/build/unsafe)
  --approval <name>      Approval mode (ask/auto/never)
  --tools <name>         Tools mode (auto/on/off)
  --no-tools             Alias for --tools off
  --file <path>          Attach text/code file (repeatable)
  --image <path>         Attach image file (repeatable)
  --yes                  Alias for --approval auto
  --unsafe               Force unsafe mode (critical deny rules still apply)
  -V, --version          Show version
  -h, --help             Show help
```

### `agent-connect.js`

```text
node agent-connect.js [--provider <name>] [options]
```

Supported providers (alphabetical):

- `copilot`
- `deepseek`
- `fireworks`
- `groq`
- `mistral`
- `moonshot`
- `openai`
- `openrouter`
- `perplexity`
- `together`
- `xai`

## Notes

- `agent.auth.json` contains plaintext secrets. Do not commit this file.
- Attachment limits:
  - files: max 10, max 200KB each
  - images: max 5, max 5MB each (`.png`, `.jpg`, `.jpeg`, `.webp`)
- Images require a vision-capable model. Otherwise the CLI returns `VISION_NOT_SUPPORTED`.
- Current version: `0.3.0`

## Optional German README

If you prefer German project docs, see `README.de.md`.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Version

Current version: `0.3.0`

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
