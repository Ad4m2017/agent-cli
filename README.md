# agent-cli

A zero-dependency, multi-provider AI agent for the terminal. Runs prompts, executes shell commands, and enforces security policies -- all from the command line, without frameworks, servers, or databases.

## Why agent-cli?

Most AI coding tools lock you into a single provider, require heavy IDE plugins, or depend on cloud services. agent-cli takes a different approach:

- **Zero dependencies** -- pure Node.js, no `node_modules`, no supply-chain risk
- **Multi-provider** -- switch between 11 providers (OpenAI, Copilot, DeepSeek, Groq, Mistral, etc.) with one config change
- **Security-first** -- configurable allow/deny command policies prevent destructive operations by default
- **Works everywhere** -- SSH sessions, containers, CI pipelines, remote servers -- anywhere Node.js runs
- **Local-only config** -- credentials never leave your machine, stored in local JSON with restricted file permissions

## Table of Contents

- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Concepts](#concepts)
- [CLI Reference](#cli-reference)
- [Files](#files)
- [Real-World Examples](#real-world-examples)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [License](#license)

## How It Works

```
You (terminal)
  |
  |  node agent.js -m "find and fix the failing test"
  |
  v
agent.js
  |-- resolves provider + model from config
  |-- sends prompt to AI via OpenAI-compatible API
  |-- AI responds with text or tool calls
  |-- tool call: run_command
  |     |-- checked against security policy (agent.json)
  |     |-- checked against approval mode (ask/auto/never)
  |     |-- executed via execFile (no shell injection)
  |     |-- result sent back to AI
  |-- AI responds with final answer
  v
Output (text or JSON)
```

The agent loops up to 5 turns: prompt -> AI response -> tool execution -> AI response, until the AI provides a final text answer.

## Requirements

- Node.js 18+ (20+ recommended)
- Internet access for provider APIs

No `npm install` required. The project has zero runtime dependencies.

## Installation

```bash
git clone https://github.com/Ad4m2017/agent-cli.git
cd agent-cli
```

That's it. No build step, no package installation.

## Quick Start

### 1. Configure a provider

```bash
node agent-connect.js
```

The interactive wizard lets you pick a provider, enter your API key, and set defaults. In TTY terminals, use arrow keys + Enter to navigate menus.

Or configure directly:

```bash
node agent-connect.js --provider openai
node agent-connect.js --provider copilot
node agent-connect.js --provider groq
```

### 2. Run your first prompt

```bash
node agent.js -m "What files are in this directory?"
```

### 3. Try tool-calling

```bash
node agent.js -m "Run the tests and summarize the results" --approval auto
```

The agent will execute `run_command` tool calls automatically when `--approval auto` is set.

## Concepts

### Tool Calling

The agent provides the AI model with a `run_command` tool. When the model decides a shell command would help answer your question, it issues a tool call. The agent executes the command, sends the output back to the model, and the model incorporates the result into its response.

This creates an **agentic loop**: the AI can inspect files, run tests, check git status, and reason about the output -- all within a single prompt.

### Security Modes

Every command the AI wants to run is checked against a security policy defined in `agent.json`. There are three modes:

| Mode | Purpose | Allowed | Blocked |
|------|---------|---------|---------|
| `plan` | Read-only exploration | `ls`, `pwd`, `git status`, `git log`, `node -v` | `rm`, `sudo`, `docker`, `npm install`, `git push` |
| `build` | Normal development | `git`, `node`, `npm`, `python`, `docker`, `make` | `rm`, `sudo`, `shutdown`, `mkfs`, `chown` |
| `unsafe` | Broad command scope | Everything (`*`) | `rm -rf /`, `mkfs`, `shutdown`, `reboot`, `poweroff` |

Regardless of mode, a `denyCritical` list always blocks catastrophic commands like `rm -rf /`, `mkfs`, and piping curl/wget into shell.

Policy evaluation order: `denyCritical` -> `mode.deny` -> `mode.allow`.

### Approval Modes

Controls whether the agent can execute commands without asking:

- **`ask`** (default) -- prompts you before every command execution. Requires a TTY terminal.
- **`auto`** -- executes allowed commands immediately. Use for automation and CI.
- **`never`** -- blocks all command execution. The AI can only respond with text.

### Tools Modes

Controls whether tool-calling payloads are sent to the AI model:

- **`auto`** (default) -- sends tools, falls back to no-tools if the model rejects them
- **`on`** -- always sends tools. Fails if the model does not support them.
- **`off`** -- disables tool-calling entirely. The AI can only respond with text.

### Providers

agent-cli uses the OpenAI-compatible `/chat/completions` API for all providers except GitHub Copilot (which uses OAuth device flow + runtime token exchange).

| Provider | Auth Type | Models |
|----------|-----------|--------|
| `openai` | API key | gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-5-mini |
| `copilot` | GitHub OAuth | gpt-4o (via Copilot) |
| `deepseek` | API key | deepseek-chat, deepseek-reasoner |
| `groq` | API key | llama-3.3-70b, mixtral-8x7b |
| `mistral` | API key | mistral-small, mistral-large |
| `openrouter` | API key | Any model on OpenRouter |
| `perplexity` | API key | sonar, sonar-pro, sonar-reasoning |
| `together` | API key | Llama-3.1-70B, Qwen2.5-72B |
| `fireworks` | API key | llama-v3p1-8b, qwen2p5-72b |
| `moonshot` | API key | moonshot-v1-8k/32k/128k |
| `xai` | API key | grok-2-latest, grok-2-mini |

## CLI Reference

### agent.js

```text
node agent.js -m "message" [options]

Options:
  -m, --message <text>   Model prompt (required)
  --model <name>         Model or provider/model (e.g. openai/gpt-4.1)
  --json                 Output structured JSON with tool call details
  --mode <name>          Security mode: plan, build, unsafe
  --approval <name>      Approval mode: ask, auto, never
  --tools <name>         Tools mode: auto, on, off
  --no-tools             Alias for --tools off
  --file <path>          Attach a text/code file as context (repeatable, max 10)
  --image <path>         Attach an image file (repeatable, max 5)
  --yes                  Alias for --approval auto
  --unsafe               Force unsafe mode (denyCritical rules still apply)
  --log                  Enable error logging to file
  --log-file <path>      Log file path (default: ./agent.js.log)
  -V, --version          Show version
  -h, --help             Show help
```

### agent-connect.js

```text
node agent-connect.js [--provider <name>] [options]

Providers: copilot, deepseek, fireworks, groq, mistral,
           moonshot, openai, openrouter, perplexity, together, xai

Options:
  -V, --version   Show version
  -h, --help      Show help
```

## Files

| File | Purpose | Secret? |
|------|---------|---------|
| `agent.js` | Main CLI runner -- prompts, tool calls, output | No |
| `agent-connect.js` | Provider setup wizard | No |
| `agent.json` | Runtime defaults + security policy | No |
| `agent.auth.json` | Provider credentials and tokens | **Yes** -- do not commit |
| `docs/` | Generated HTML documentation | No |
| `scripts/build-docs.js` | Markdown to HTML docs builder | No |

## Real-World Examples

### Explore a codebase

```bash
node agent.js -m "What does this project do? Summarize the architecture."
```

### Run tests and analyze failures

```bash
node agent.js -m "Run npm test and explain any failures" --approval auto --mode build
```

### Review a file

```bash
node agent.js -m "Review this file for bugs and improvements" --file src/utils.js
```

### Describe a screenshot

```bash
node agent.js -m "What does this UI show?" --model openai/gpt-4o --image screenshot.png
```

### Automation in CI

```bash
OUT=$(node agent.js -m "Run lint and tests, report status" --json --approval auto --mode build)
echo "$OUT" | jq '.ok'
```

### Use different providers for different tasks

```bash
# Fast reasoning with Groq
node agent.js -m "Explain this error" --model groq/llama-3.3-70b-versatile --no-tools

# Search-augmented answers with Perplexity
node agent.js -m "What are the latest Node.js security patches?" --model perplexity/sonar --no-tools

# Full agent with OpenAI
node agent.js -m "Fix the failing test" --model openai/gpt-4.1 --approval auto
```

## Troubleshooting

| Error Code | Cause | Fix |
|------------|-------|-----|
| `PROVIDER_NOT_CONFIGURED` | No provider set up yet | Run `node agent-connect.js --provider <name>` |
| `INTERACTIVE_APPROVAL_JSON` | `--approval ask` used with `--json` | Use `--approval auto` or `--approval never` |
| `INTERACTIVE_APPROVAL_TTY` | `--approval ask` in non-TTY environment | Use `--approval auto` or run in interactive terminal |
| `VISION_NOT_SUPPORTED` | Image attached to text-only model | Use a vision model (gpt-4o, gpt-4.1) or remove `--image` |
| `TOOLS_NOT_SUPPORTED` | `--tools on` with incompatible model | Use `--tools auto` or `--no-tools` |
| `COPILOT_DEVICE_CODE_EXPIRED` | OAuth code timed out | Re-run `node agent-connect.js --provider copilot` |
| `ATTACHMENT_TOO_LARGE` | File > 200KB or image > 5MB | Use a smaller file or split it |
| `AUTH_CONFIG_INVALID` | Corrupted `agent.auth.json` | Delete the file and re-run `node agent-connect.js` |

## Documentation

Full docs with examples, config reference, and architecture details:

- English: https://ad4m2017.github.io/agent-cli/
- Deutsch: https://ad4m2017.github.io/agent-cli/de/

Build docs locally:

```bash
node scripts/build-docs.js
```

## German README

A full German README is available at [README.de.md](README.de.md).

## Version

Current version: `0.3.1` -- see [CHANGELOG.md](CHANGELOG.md).

## License

MIT License -- see [LICENSE](LICENSE) file for details.
