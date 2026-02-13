# Agent CLI Documentation

A zero-dependency, multi-provider AI agent for the terminal. No frameworks, no servers, no databases -- just Node.js and your preferred AI provider.

## Why agent-cli?

- **Zero dependencies** -- no `node_modules`, no supply-chain risk
- **11 providers** -- switch providers with one config change
- **Security-first** -- configurable command policies prevent destructive operations
- **Works everywhere** -- SSH, containers, CI, remote servers
- **Local-only** -- credentials stay on your machine

## How It Works

agent-cli sends your prompt to an AI model via the OpenAI-compatible chat completions API. The model can respond with plain text or request tool calls. Currently, the agent supports one tool: `run_command`, which executes shell commands.

The execution follows an agentic loop:

1. You send a prompt
2. The AI model processes the prompt
3. If the model needs to run a command, it issues a `run_command` tool call
4. The agent checks the command against security policies
5. If allowed, the agent executes the command and sends the output back
6. The model processes the output and either issues more tool calls or responds with text
7. The loop continues for up to 5 turns

This means the AI can inspect files, run tests, check git history, and reason about results -- all within a single prompt.

## Requirements

- Node.js 18+ (20+ recommended)
- Internet access for provider APIs
- No `npm install` required

## Installation

```bash
git clone https://github.com/Ad4m2017/agent-cli.git
cd agent-cli
```

No build step. No package installation.

## Configure a Provider

Run the interactive setup wizard:

```bash
node agent-connect.js
```

In TTY terminals, use arrow keys and Enter to navigate menus. The wizard writes:

- Runtime defaults and security policy to `agent.json`
- Provider credentials to `agent.auth.json` (plaintext, file permissions set to 0600)

Wizard behavior includes:

- Provider status labels (`installed`, `installed, default`, `not configured`)
- Top-level quick action: `Set default provider/model only`
- Optional model refresh via live provider `/models`
- Optional fallback model list loading from `models.dev`
- Provider source option: `Load provider from models.dev...` (imports provider API URL and model candidates)
- Paged list navigation for long menus (`n`/`p` jump by 10)

Config files are now written atomically (temp file + rename) to reduce risk of corrupted JSON if a process is interrupted during write.

### Direct Provider Setup

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

### Copilot Setup

GitHub Copilot uses OAuth device flow. The wizard will:

1. Generate a device code
2. Ask you to open a URL in your browser
3. Enter the code on GitHub
4. Automatically exchange tokens once confirmed

Copilot tokens are short-lived. The agent refreshes them automatically before expiry.

## First Run

```bash
node agent.js -m "What files are in this directory?"
```

Force a specific provider and model:

```bash
node agent.js -m "Analyze this project" --model copilot/gpt-4o
node agent.js -m "Explain this error" --model groq/llama-3.3-70b-versatile
```

## Concepts

### Tool Calling

The agent provides the AI model with a `run_command` tool definition. When the model decides a shell command would help answer your question, it returns a tool call instead of text. The agent executes the command using `execFile` (not `exec` -- this prevents shell injection), sends the output back, and the model incorporates the result.

This creates an agentic loop where the AI can:

- List and read files
- Run tests and linters
- Check git status and history
- Execute build commands
- Inspect running processes

The loop runs for up to 5 turns before the agent forces a final text response.

### Security Modes

Every command the AI wants to execute is checked against a three-layer security policy defined in `agent.json`:

**Layer 1: denyCritical** -- always blocks catastrophic commands regardless of mode:

- `rm -rf /`
- `mkfs`
- `shutdown`, `reboot`, `poweroff`
- `dd if=`
- Piping curl/wget into sh/bash

**Layer 2: Mode-specific deny rules** -- blocks commands based on current mode.

**Layer 3: Mode-specific allow rules** -- only explicitly allowed commands can run.

Evaluation order: denyCritical -> deny -> allow. A command must pass all three layers.

The three modes:

- **plan** -- Read-only exploration. Only `ls`, `pwd`, `git status`, `git log`, `node -v`, `npm -v` are allowed. Destructive commands, package installs, and pushes are blocked.
- **build** (default) -- Normal development. Git, Node.js, npm, Python, Docker, Make are allowed. `rm`, `sudo`, and system-level commands are blocked.
- **unsafe** -- Broad scope. All commands allowed except `denyCritical` items. Use with caution.

### Approval Modes

Controls human-in-the-loop behavior for command execution:

- **ask** (default) -- The agent prompts you before every command: `Approve? [y/N]`. Requires a TTY terminal. This is the safest mode for interactive use.
- **auto** -- Executes policy-allowed commands immediately without prompting. Required for CI/CD and scripting. Use with `--json` for automation.
- **never** -- Blocks all command execution. The AI can only respond with text, never run commands.

### Tools Modes

Controls whether tool-calling payloads are included in API requests:

- **auto** (default) -- Sends tool definitions to the model. If the model rejects them (e.g., Perplexity models), automatically retries without tools.
- **on** -- Always sends tool definitions. Returns `TOOLS_NOT_SUPPORTED` error if the model cannot handle them.
- **off** -- Never sends tool definitions. The AI responds with text only.

Use `--no-tools` as a shorthand for `--tools off`.

### Providers

All providers except Copilot use the standard OpenAI-compatible `/chat/completions` endpoint. This means any OpenAI-compatible service works.

- **openai** -- gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini, gpt-5-mini
- **copilot** -- GitHub Copilot via OAuth device flow
- **deepseek** -- deepseek-chat, deepseek-reasoner, deepseek-v3
- **groq** -- llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768
- **mistral** -- mistral-small-latest, mistral-medium-latest, mistral-large-latest
- **openrouter** -- Any model available on OpenRouter
- **perplexity** -- sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro
- **together** -- Llama-3.1-70B-Instruct-Turbo, Qwen2.5-72B-Instruct-Turbo
- **fireworks** -- llama-v3p1-8b-instruct, qwen2p5-72b-instruct
- **moonshot** -- moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
- **xai** -- grok-2-latest, grok-2-mini-latest, grok-beta

### File and Image Attachments

Attach files and images as context for the AI:

```bash
node agent.js -m "Review this file" --file src/app.ts
node agent.js -m "Describe this UI" --model openai/gpt-4o --image screenshot.png
node agent.js -m "Compare these" --file a.js --file b.js
```

Limits:

- Files: max 10, max 200KB each, must be UTF-8 text
- Images: max 5, max 5MB each, formats: `.png`, `.jpg`, `.jpeg`, `.webp`
- Images require a vision-capable model (gpt-4o, gpt-4.1, gpt-5, Gemini). Text-only models return `VISION_NOT_SUPPORTED`.

## Usage Examples

### Explore a codebase

```bash
node agent.js -m "What does this project do? Summarize the architecture."
```

### Run tests and analyze failures

```bash
node agent.js -m "Run npm test and explain any failures" --approval auto --mode build
```

### Review a specific file

```bash
node agent.js -m "Review this file for bugs" --file src/utils.js --no-tools
```

### Use different providers for different tasks

```bash
# Fast reasoning
node agent.js -m "Explain this error" --model groq/llama-3.3-70b-versatile --no-tools

# Search-augmented answers
node agent.js -m "Latest Node.js security patches?" --model perplexity/sonar --no-tools

# Full agent mode
node agent.js -m "Fix the failing test" --model openai/gpt-4.1 --approval auto
```

### JSON output for scripting

```bash
node agent.js -m "Run tests" --json --approval auto --mode build
```

## CLI Reference

```text
node agent.js -m "message" [options]

Options:
  -m, --message <text>   Model prompt (required)
  --model <provider/model|model>
  --config <path>        Path to agent.json (default: ./agent.json)
  --auth-config <path>   Path to agent.auth.json (default: ./agent.auth.json)
  --json
  --mode <plan|build|unsafe>
  --approval <ask|auto|never>
  --tools <auto|on|off>
  --no-tools
  --file <path>          (repeatable)
  --image <path>         (repeatable)
  --yes                  Alias for --approval auto
  --unsafe               Force unsafe mode
  --log                  Enable error logging
  --log-file <path>      Default: ./agent.js.log
  --verbose              Additional runtime diagnostics
  --debug                Detailed diagnostics (implies --verbose)
  --stream               Stream assistant text when supported (disabled in --json and tool turns)
  --command-timeout <ms> Tool command timeout in milliseconds
  --allow-insecure-http  Allow non-local HTTP provider base URLs
  --help
  --version
```

If `-m/--message` is omitted, the prompt is read from stdin:

```bash
cat prompt.txt | node agent.js --approval auto
```

```text
node agent-connect.js [--provider <name>] [--config <path>] [--auth-config <path>] [--help] [--version]
```

## Troubleshooting

- `PROVIDER_NOT_CONFIGURED`: Run `node agent-connect.js --provider <name>`
- `INTERACTIVE_APPROVAL_JSON`: Use `--approval auto` or `--approval never` with `--json`
- `INTERACTIVE_APPROVAL_TTY`: Run in an interactive terminal or use `--approval auto`
- `VISION_NOT_SUPPORTED`: Use a vision model (gpt-4o, gpt-4.1) or remove `--image`
- `TOOLS_NOT_SUPPORTED`: Use `--tools auto` or `--no-tools`
- `FETCH_TIMEOUT`: Provider request exceeded timeout
- `RETRY_EXHAUSTED`: Retries on transient provider failures were exhausted
- `INSECURE_BASE_URL`: Public HTTP base URL rejected (use HTTPS, local/private host, or `--allow-insecure-http`)
- `INVALID_BASE_URL`: Provider base URL is malformed or uses an unsupported protocol
- `COPILOT_DEVICE_CODE_EXPIRED`: Re-run `node agent-connect.js --provider copilot`
- `ATTACHMENT_TOO_LARGE`: File exceeds 200KB or image exceeds 5MB
- `AUTH_CONFIG_INVALID`: Delete `agent.auth.json` and re-run `node agent-connect.js`

Exit code mapping for CI/CD:

- `1` generic runtime/connect error
- `2` agent config error (`agent.json`)
- `3` auth config error (`agent.auth.json`)
- `4` provider configuration/selection error
- `5` interactive approval constraint error
- `6` provider capability / copilot flow error
- `7` fetch timeout
- `8` retry exhausted
- `9` attachment validation error
