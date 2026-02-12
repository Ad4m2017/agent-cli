# Agent CLI Docs

Minimal, professional local agent CLI with provider setup, security policy, approval gates, and JSON automation.

## Overview

- `agent.js` runs prompts and tool calls.
- `agent-connect.js` configures providers and defaults.
- `agent.json` stores runtime defaults and security policy.
- `agent.auth.json` stores provider credentials and tokens.

## Install

No npm package install is required for the agent itself.

Requirements:

- Node.js 18+ (Node.js 20+ recommended)
- Internet access for model providers

## Configure

Run the setup wizard:

```bash
node agent-connect.js
```

Or configure directly:

```bash
node agent-connect.js --provider openai
node agent-connect.js --provider openrouter
node agent-connect.js --provider moonshot
node agent-connect.js --provider deepseek
node agent-connect.js --provider copilot
```

In interactive terminals, you can select providers/models using Up/Down + Enter.

The wizard writes:

- defaults + policy to `agent.json`
- provider secrets to `agent.auth.json`

## Initialize

Run your first prompt:

```bash
node agent.js -m "Hello"
```

Force a specific model/provider:

```bash
node agent.js -m "Analyze this project" --model copilot/gpt-4o
```

## Usage

### Ask Questions

```bash
node agent.js -m "How is auth handled?"
```

### Build Changes

```bash
node agent.js -m "Run tests and summarize failures"
```

### JSON Mode for Scripts

```bash
node agent.js -m "Run tests" --json --approval auto --mode build
```

### Approval Modes

- `ask`: prompt per command execution
- `auto`: execute allowed commands automatically
- `never`: block command execution

Examples:

```bash
node agent.js -m "Check repo" --approval ask
node agent.js -m "Check repo" --approval auto
node agent.js -m "Check repo" --yes
```

### Tools Modes

- `auto`: starts with tools, retries without tools if model/provider rejects tool-calling
- `on`: always sends tool-calling payload
- `off`: disables tool-calling

Examples:

```bash
node agent.js -m "How are you?" --model perplexity/sonar --tools off
node agent.js -m "How are you?" --model perplexity/sonar --tools auto
node agent.js -m "How are you?" --model perplexity/sonar --no-tools
```

### Attach Files and Images

```bash
node agent.js -m "Explain this file" --file src/app.ts
node agent.js -m "Describe this UI" --model openai/gpt-4o --image screenshot.png
```

Limits:

- files: max 10, max 200KB each
- images: max 5, max 5MB each (`.png`, `.jpg`, `.jpeg`, `.webp`)
- image + text-only model => `VISION_NOT_SUPPORTED`

### Security Modes

- `plan`: strict/read-only style allow-list
- `build`: broader development commands
- `unsafe`: wildcard allow, but `denyCritical` still blocks destructive commands

## CLI Reference

```text
node agent.js -m "message" [options]

Options:
  --model <provider/model|model>
  --json
  --mode <plan|build|unsafe>
  --approval <ask|auto|never>
  --tools <auto|on|off>
  --no-tools
  --file <path>
  --image <path>
  --yes
  --unsafe
  --log
  --log-file <path>
  --help
  --version
```

```text
node agent-connect.js [--provider copilot|deepseek|fireworks|groq|mistral|moonshot|openai|openrouter|perplexity|together|xai]
```

## Troubleshooting

- `PROVIDER_NOT_CONFIGURED`: run `node agent-connect.js --provider <name>`
- `INTERACTIVE_APPROVAL_JSON`: use `--approval auto|never` with `--json`
- `INTERACTIVE_APPROVAL_TTY`: run in an interactive terminal or switch to `--approval auto`
- Copilot re-auth: `node agent-connect.js --provider copilot`
