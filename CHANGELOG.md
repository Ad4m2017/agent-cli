# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.5.6] - 2026-02-16

### Changed
- Switched `run_command` to real shell execution for full command compatibility (`pipes`, redirects, chaining, globs) instead of argv tokenization.
- Added cross-platform shell backend handling:
  - Unix/macOS: `sh -lc`
  - Windows: PowerShell primary with `cmd.exe` fallback when a shell backend is unavailable.
- Preserved existing policy/approval/timeout guards while returning execution metadata (`executionMode`, `backend`, `timedOut`).
- Expanded CI with a blocking `shell-smoke` OS matrix (Linux/macOS/Windows) and a scheduled/manual `shell-extended-nightly` matrix job.
- Bumped versions to `1.5.6` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.5.5] - 2026-02-16

### Changed
- Added configurable tool-turn limits via `runtime.maxToolTurns` (default `10`) in `agent.json` and `agent.example.json`.
- Replaced the hardcoded tool-turn limit with validated runtime resolution (`1..200` clamp, invalid values fall back to default `10`).
- Updated connect defaults, unit tests, and config reference docs (EN/DE + generated HTML) for `maxToolTurns`.
- Bumped versions to `1.5.5` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.5.4] - 2026-02-16

### Changed
- Reduced command-policy hot-path overhead by reusing a pre-normalized command string across allow/deny rule checks.
- Simplified sync tool-dispatch lookup in the execution loop to reduce per-call branching overhead.
- Kept behavior unchanged while tightening low-level runtime performance.
- Bumped versions to `1.5.4` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.5.3] - 2026-02-15

### Changed
- Optimized hot-path runtime performance without changing behavior.
- Cached chat tool definitions so they are no longer rebuilt on every run.
- Added a policy regex cache for `re:` rules to avoid repeated regex compilation during command checks.
- Replaced the tool-execution `if/else` chain with a constant executor map and tracked failed tool calls incrementally.
- Bumped versions to `1.5.3` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.5.2] - 2026-02-15

### Changed
- Improved provider selection UX by normalizing provider names (`openai`, `OpenAI`, and ` openai ` resolve consistently).
- Added provider suggestions when a selected provider is not configured, including a list of configured providers in the error message.
- Extended unit tests for provider normalization/suggestion helpers and model selection behavior.
- Bumped versions to `1.5.2` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.5.1] - 2026-02-15

### Added
- Added strict runtime option validation for `--profile`, `--approval`, and `--tools` with clear `INVALID_OPTION` errors and fix hints.
- Added `health` to successful `--json` responses with `retriesUsed`, `toolCallsTotal`, `toolCallsFailed`, and `toolCallFailureRate`.
- Added run-level stats events and a new `QUALITY` section in `--stats` output with retry rate, tool failure rate, and tools-fallback counts.

### Changed
- Unified profile-first wording across CLI help, blocked-command errors, README, and EN/DE docs.
- Updated JSON schema and EN/DE JSON contract/API examples for the new `health` object.
- Updated stats docs to reflect quality metrics in addition to provider/model token breakdowns.
- Bumped versions to `1.5.1` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.5.0] - 2026-02-15

### Changed
- Renamed internal security policy buckets from legacy mode keys (`plan`, `build`, `unsafe`) to profile-aligned keys (`safe`, `dev`, `framework`) across runtime defaults, wizard output, and shipped config templates.
- Updated command policy evaluation to use `security.modes.safe|dev|framework` directly, removing legacy internal mode mapping names.
- Updated tests and docs to reflect the profile-aligned policy keys and JSON examples (`"mode": "dev"`).
- Rebuilt generated documentation pages after the terminology migration.
- Bumped versions to `1.5.0` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.4.0] - 2026-02-15

### Changed
- Removed legacy `--mode` CLI behavior and profile mapping fallbacks; profile selection is now profile-only (`--profile safe|dev|framework`) plus `--unsafe` override.
- Removed legacy-mode metadata references from tests and docs (`legacyModeMappedFrom`, `AGENT_MODE`, and `--mode` usage text).
- Updated unit tests to validate profile-first policy and environment precedence without mode aliases.
- Bumped versions to `1.4.0` in `agent.js`, `agent-connect.js`, and `package.json`.
- Updated README and docs references to `1.4.0`.

## [1.3.9] - 2026-02-15

### Added
- Added `--json-schema` CLI option to print a machine-readable schema for `--json` output.
- Added dedicated JSON contract docs pages:
  - `docs/content/en/json-contract.md`
  - `docs/content/de/json-contract.md`
- Added deterministic mock-provider end-to-end smoke suite in `test/agent-e2e.test.js` covering `read_file`, `search_content`, `apply_patch`, and `run_command`.
- Added explicit CI execution for the e2e smoke suite in `.github/workflows/ci.yml`.

### Changed
- Expanded API examples/docs with guaranteed vs optional JSON fields and documented tool error codes.
- Updated blocked-tool examples to use `TOOL_EXECUTION_ERROR` in normalized tool-call records.
- Bumped versions from `1.3.8` to `1.3.9` in `agent.js`, `agent-connect.js`, and `package.json`.
- Updated README version labels in `README.md` and `README.de.md`.

## [1.3.8] - 2026-02-15

### Added
- Added deterministic mock-provider end-to-end smoke tests in `test/agent-e2e.test.js` for `read_file`, `search_content`, `apply_patch`, and `run_command` tool flows.
- Added explicit CI execution of the e2e smoke suite in `.github/workflows/ci.yml`.
- Extended API examples/docs with a clearer JSON contract section (guaranteed vs optional fields) and documented tool error codes.
- Added `--json-schema` CLI option to print a machine-readable schema for `--json` output.
- Added dedicated JSON contract docs page (`docs/content/en/json-contract.md`, `docs/content/de/json-contract.md`).

### Changed
- Updated API examples to use `TOOL_EXECUTION_ERROR` for blocked tool-call examples.
- Bumped versions from `1.3.7` to `1.3.8` in `agent.js`, `agent-connect.js`, and `package.json`.
- Updated README version labels in `README.md` and `README.de.md`.

## [1.3.7] - 2026-02-15

### Added
- Added explicit tool-level error codes for specialized tools: `TOOL_INVALID_ARGS`, `TOOL_NOT_FOUND`, `TOOL_INVALID_PATTERN`, `TOOL_UNSUPPORTED_FILE_TYPE`, `TOOL_CONFLICT`, `TOOL_UNKNOWN`, `TOOL_EXECUTION_ERROR`.

### Changed
- Standardized specialized tool failure responses to include a stable `code` field.
- Tool call normalization now guarantees a fallback error code (`TOOL_EXECUTION_ERROR`) when a failing tool does not provide one.
- Updated unit tests to validate tool error-code behavior.
- Bumped versions from `1.3.6` to `1.3.7` in `agent.js`, `agent-connect.js`, and `package.json`.
- Updated README version labels in `README.md` and `README.de.md`.

## [1.3.6] - 2026-02-15

### Added
- Added JSON tool-call normalization (`tool`, `input`, `ok`, `result`, `error`, `meta`) for consistent automation parsing.
- Added profile-resolution metadata in JSON output via optional `legacyModeMappedFrom` when legacy mode aliases are used.

### Changed
- Hardened file tool write path with atomic text writes.
- Hardened `apply_patch` with stricter operation validation and prechecks for `add`/`update` semantics.
- Refined runtime profile precedence (`--profile`/`AGENT_PROFILE`/config first, legacy `--mode` as fallback mapping).
- Updated README/docs examples to use profile-first CLI usage (`--profile dev`) and documented normalized JSON contracts.
- Bumped versions from `1.3.5` to `1.3.6` in `agent.js`, `agent-connect.js`, and `package.json`.

## [1.3.5] - 2026-02-15

### Added
- Added specialized built-in tools in `agent.js`: `read_file`, `list_files`, `search_content`, `write_file`, `delete_file`, `move_file`, `mkdir`, and `apply_patch`.
- Added runtime profiles via `--profile` and config `runtime.profile`: `safe`, `dev`, `framework`.

### Changed
- Kept `--mode` (`plan|build|unsafe`) as a legacy alias mapped to profiles for backward compatibility.
- JSON output now includes `profile` (effective runtime profile).
- Bumped versions from `1.3.4` to `1.3.5` in `agent.js`, `agent-connect.js`, and `package.json`.
- Updated README and docs to describe profile-based runtime selection and the expanded toolset.

## [1.3.4] - 2026-02-15

### Changed
- `--stats` text output now uses a boxed pretty layout (`OVERVIEW`, `PROVIDER USAGE`, `MODEL USAGE`).
- Stats token suffixes now use uppercase compact units (`K`, `M`, `B`).
- Stats box width is now terminal-aware with dynamic sizing (max 56 columns, min 24 columns).
- Version bumped from `1.3.3` to `1.3.4` in `agent.js`, `agent-connect.js`, and `package.json`.
- README version labels updated in `README.md` and `README.de.md`.

## [1.3.3] - 2026-02-15

### Added
- `--stats` now supports optional top-N model filtering via positional argument: `--stats N`.
- `--stats` without a number keeps the default behavior of showing all models.

### Changed
- Help and docs now show `--stats [N]` usage in CLI examples.
- Version bumped from `1.3.2` to `1.3.3` in `agent.js`, `agent-connect.js`, and `package.json`.
- README version labels updated in `README.md` and `README.de.md`.

## [1.3.2] - 2026-02-15

### Added
- `--json` responses now include a `usage` object for the current run (aggregated across turns): `turns`, `turns_with_usage`, `has_usage`, `input_tokens`, `output_tokens`, `total_tokens`.

### Changed
- Version bumped from `1.3.1` to `1.3.2` in `agent.js`, `agent-connect.js`, and `package.json`.
- README version labels updated in `README.md` and `README.de.md`.

## [1.3.1] - 2026-02-15

### Added
- `--stats` text output now includes `input_tokens` and `output_tokens` in `By Provider` and `By Model` sections.
- Human-readable token formatting added to stats text output (raw + compact values, e.g. `12345 (12.3k)`).

### Changed
- Version bumped from `1.3.0` to `1.3.1` in `agent.js`, `agent-connect.js`, and `package.json`.
- README and docs updated to reflect enhanced `--stats` output.

## [1.3.0] - 2026-02-15

### Added
- Optional local usage stats logging in `agent.js`:
  - new `runtime.usageStats` config (`enabled`, `file`, `retentionDays`, `maxBytes`)
  - append-only NDJSON events with timestamp, provider/model, request count, token counts, and `has_usage`
  - new `--stats` CLI output for aggregated request/token usage

### Changed
- Usage stats retention/size compaction now runs only in `--stats` mode to keep normal request performance unaffected.
- Version bumped from `1.2.1` to `1.3.0` in `agent.js`, `agent-connect.js`, and `package.json`.
- README version labels and CLI reference updated in `README.md` and `README.de.md`.

## [1.2.1] - 2026-02-14

### Fixed
- `agent.js` now correctly honors `runtime.allowInsecureHttp` from `agent.json` (while preserving CLI/env override priority).

### Changed
- Version bumped from `1.2.0` to `1.2.1` in `agent.js`, `agent-connect.js`, and `package.json`.
- README version labels updated in `README.md` and `README.de.md`.

## [1.2.0] - 2026-02-14

### Added
- Optional neutral system prompt behavior in `agent.js`:
  - new `--system-prompt` CLI flag
  - new `AGENT_SYSTEM_PROMPT` environment override
  - when unset or empty, no `system` role message is sent
- Optional attachment limit controls (no hardcoded defaults):
  - new CLI flags: `--max-file-bytes`, `--max-image-bytes`, `--max-files`, `--max-images`
  - new env overrides: `AGENT_MAX_FILE_BYTES`, `AGENT_MAX_IMAGE_BYTES`, `AGENT_MAX_FILES`, `AGENT_MAX_IMAGES`
  - new runtime config keys: `runtime.attachments.maxFileBytes`, `runtime.attachments.maxImageBytes`, `runtime.attachments.maxFiles`, `runtime.attachments.maxImages`
  - strict validation (`integer >= 0`, `0 = unlimited`) with new error code: `ATTACHMENT_LIMIT_INVALID`
- New committed baseline config sample: `agent.example.json`
- Repository hygiene updates:
  - `.gitignore` now documents secrets/logs and ignores optional local overrides (`agent.local*.json`)

### Changed
- Attachment handling now defaults to unlimited unless limits are explicitly configured.
- Help output and EN/DE docs updated for new neutral prompt and attachment limit options.
- Version bumped from `1.1.0` to `1.2.0` in `agent.js`, `agent-connect.js`, `package.json`, and README version labels.

### Tests
- Expanded `test/agent.test.js` coverage for:
  - new CLI argument parsing
  - env override precedence for system prompt and attachment limits
  - strict attachment limit validation helpers

## [1.1.0] - 2026-02-13

### Added
- Major `agent-connect.js` wizard UX upgrade with zero dependencies:
  - provider status labels in menu (`installed`, `installed, default`, `not configured`)
  - new top-level action menu (`Setup/reconfigure`, `Set default provider/model only`, `Exit`)
  - quick default-switch flow without full reconfiguration
- Local provider presets added:
  - `ollama` (`http://localhost:11434/v1`)
  - `lmstudio` (`http://localhost:1234/v1`)
- Custom provider setup flow for unknown providers:
  - normalized provider slug
  - configurable OpenAI-compatible base URL
  - optional API key
- Model discovery and selection improvements:
  - optional live `/models` discovery
  - optional fallback to `models.dev`
  - manual comma-separated model entry fallback
  - persistent `enabledModels` storage per provider
  - `Custom model...` option in default-model selection
- New provider source option in setup menu:
  - `Load provider from models.dev...` with provider API URL import (`api`) and model candidates
- Large menu usability improvements:
  - paginated windowed menu rendering
  - jump navigation (`n`/`p` and PageDown/PageUp) by 10 entries
  - terminal-width label truncation for long provider/model lines

### Changed
- OpenAI connect flow simplified back to API-key setup only (removed interim ChatGPT browser/headless auth mode paths)
- Copilot setup now supports model refresh/discovery and stores `enabledModels`
- "Set default provider/model only" flow now offers optional model refresh from live provider/models.dev before picking default
- Runtime request auth headers in `agent.js` are only sent when token/key exists, improving compatibility with local no-key endpoints
- Version bumped from `1.0.0` to `1.1.0` in `agent.js`, `agent-connect.js`, and `package.json`

### Tests
- Expanded connect and runtime test coverage for:
  - menu pagination/windowing/truncation helpers
  - models.dev provider/model mapping helpers
  - provider status labeling and local alias normalization
- Total tests increased to 248 (all passing)

## [1.0.0] - 2026-02-13

### Added
- v1.0 release hardening checks across critical runtime paths (config I/O, provider runtime creation, tool execution, stdin flow)
- Extended local-model HTTP policy support in `agent.js`:
  - accepts `.localhost` hostnames
  - accepts local IPv6 ranges (`::1`, `fc00::/7`, `fe80::/10`)
- Additional regression tests for:
  - environment override precedence (`AGENT_COMMAND_TIMEOUT`, `AGENT_ALLOW_INSECURE_HTTP`)
  - local/private host detection edge cases
  - unsupported URL protocol rejection in base URL validation

### Changed
- Version bumped from `0.9.0` to `1.0.0` in `agent.js`, `agent-connect.js`, and `package.json`
- README version references updated (EN/DE)
- Test count increased from 231 to 234

### Notes
- Zero-dependency architecture remains unchanged (Node.js built-ins only)
- Existing CLI behavior remains backward compatible; 1.0 focuses on stability and production readiness

## [0.9.0] - 2026-02-13

### Added
- stdin prompt support: when `-m/--message` is omitted, `agent.js` now reads the prompt from stdin (pipe mode)
- Configurable tool command timeout for `run_command` execution:
  - `runtime.commandTimeoutMs` in `agent.json` (default `10000`)
  - `--command-timeout <ms>` CLI override
  - `AGENT_COMMAND_TIMEOUT` env override
- Base URL validation for providers:
  - supports `https://` everywhere
  - allows `http://` for local/private hosts (`localhost`, loopback, RFC1918)
  - supports explicit override with `--allow-insecure-http` / `AGENT_ALLOW_INSECURE_HTTP`
- New error codes in `agent.js`:
  - `INVALID_BASE_URL`
  - `INSECURE_BASE_URL`

### Changed
- `createProviderRuntime()` now validates provider base URLs before requests
- `runCommandTool()` now uses resolved command timeout instead of fixed 10s
- Version bumped from `0.8.0` to `0.9.0` in `agent.js`, `agent-connect.js`, and `package.json`
- Test count increased from 215 to 231

### Tests
- Added tests for:
  - new CLI flags (`--command-timeout`, `--allow-insecure-http`)
  - timeout resolution precedence and bounds
  - local/private HTTP host detection
  - provider base URL validation rules
  - stdin message resolution behavior
  - new env override behavior (`AGENT_COMMAND_TIMEOUT`, `AGENT_ALLOW_INSECURE_HTTP`)

## [0.8.0] - 2026-02-13

### Added
- Atomic JSON write helper (`writeJsonAtomic`) in both `agent.js` and `agent-connect.js` (temp file + rename) to avoid partial/corrupted config writes
- Config path hardening helper (`validateConfigPath`) in both CLIs:
  - validates parent directory exists
  - validates parent is a directory
  - rejects config paths that point to directories
- New unit tests for atomic writes and config path validation in both test suites

### Changed
- Config persistence now uses atomic writes:
  - `agent.js`: `saveProviderConfig`
  - `agent-connect.js`: `saveConfig`, `saveAgentConfig`
- Config loaders now validate file paths before reading:
  - `agent.js`: `loadAgentConfig`, `loadProviderConfig`
  - `agent-connect.js`: `loadConfig`, `loadAgentConfig`
- Version bumped from `0.7.0` to `0.8.0` in `agent.js`, `agent-connect.js`, and `package.json`
- Test count increased from 209 to 215

## [0.7.0] - 2026-02-13

### Added
- New CLI flags in `agent.js`: `--config`, `--auth-config`, `--verbose`, `--debug`, `--stream`
- New CLI flags in `agent-connect.js`: `--config`, `--auth-config`
- Config path override support for both CLIs (`--config`, `--auth-config`) with absolute/relative path resolution
- Streaming output mode for assistant text (`--stream`) with safe gating:
  - disabled automatically for `--json`
  - disabled automatically while tools are enabled
  - enabled only for known streaming-capable providers
- Automatic fallback from streaming to non-streaming request when provider/model rejects stream mode
- Centralized log sanitization via `redactSensitiveText()` in both CLIs
- Runtime logger abstraction in `agent.js` (`createLogger`) with levels:
  - verbose (`--verbose`)
  - debug (`--debug`, implies verbose)
- Standardized error helper functions in both CLIs:
  - `getErrorCode()`
  - `getExitCodeForError()`
- Stable process exit-code matrix for automation:
  - `1` generic runtime/connect error
  - `2` agent config error
  - `3` auth config error
  - `4` provider config/selection error
  - `5` interactive approval constraint
  - `6` provider capability / copilot flow error
  - `7` fetch timeout
  - `8` retry exhausted
  - `9` attachment validation error

### Changed
- Retry diagnostics in `fetchWithRetry()` now use optional logger callback instead of unconditional `stderr` writes
- Top-level error output in both CLIs is standardized to `Error [CODE]: ...`
- Error logging now redacts sensitive values (tokens, API keys, authorization values)
- `createChatCompletion()` now supports stream and non-stream flows through one API
- Version bumped from `0.6.0` to `0.7.0` in `agent.js`, `agent-connect.js`, and `package.json`
- Documentation refreshed in EN/DE for new flags, streaming behavior, and exit-code mapping

### Tests
- Expanded test coverage for new parser options, config path resolution, streaming helper logic, redaction, logger behavior, and exit-code mapping
- Total tests increased to 209 (all passing)

## [0.6.0] - 2026-02-13

### Added
- **Retry with exponential backoff** for chat completion requests — automatic retry on HTTP 500/502/503 with configurable max retries (default 3) and backoff delays (1s → 2s → 4s, capped at 30s)
- **HTTP 429 rate limit handling** — respects `Retry-After` header (delta-seconds and HTTP-date formats), falls back to exponential backoff when header is absent
- **`FETCH_TIMEOUT` retry** — timeout errors during chat completion now trigger retries instead of immediate failure
- `parseRetryAfter()` pure helper — parses `Retry-After` header into milliseconds with configurable cap
- `fetchWithRetry()` wrapper — builds on top of `fetchWithTimeout`, used only for the chat completion call; OAuth/token calls remain single-attempt
- `RETRY_EXHAUSTED` error code — thrown when all retry attempts fail
- **Environment variable overrides** for CI/CD pipelines:
  - `AGENT_MODEL` — override default model (e.g. `openai/gpt-4.1`)
  - `AGENT_API_KEY` — override API key (allows running without `agent.auth.json`)
  - `AGENT_MODE` — override security mode (`plan`/`build`/`unsafe`)
  - `AGENT_APPROVAL` — override approval mode (`ask`/`auto`/`never`)
- `applyEnvOverrides()` pure function — applies env vars to CLI opts with correct priority: CLI flag > env var > config file > default
- **Env-only runtime creation** — when `AGENT_API_KEY` is set but no provider entry exists in `agent.auth.json`, the runtime is created from env vars alone (enables CI/CD without config files)
- 22 new unit tests: `parseRetryAfter` (8), `fetchWithRetry` (8), `applyEnvOverrides` (6)

### Changed
- `createChatCompletion()` now uses `fetchWithRetry` instead of `fetchWithTimeout` — transparent retry on transient failures, zero performance impact in the happy path
- Retry progress logged to stderr (`Retry 1/3 after 1000ms (HTTP 503)`)
- Version bumped from 0.5.0 to 0.6.0 across all three locations (agent.js, agent-connect.js, package.json)
- Test count increased from 153 to 175
- 3 new exported functions: `parseRetryAfter`, `fetchWithRetry`, `applyEnvOverrides` (total: 27 from agent.js)

## [0.5.0] - 2026-02-13

### Added
- `fetchWithTimeout()` helper with `AbortController`-based timeout in both `agent.js` (30s default, 120s for chat completions) and `agent-connect.js` (30s default)
- `FETCH_TIMEOUT` error code in both files — all 6 `fetch()` calls now have timeout protection
- `SIGINT`/`SIGTERM` signal handlers for graceful shutdown (exit codes 130/143) in both files
- Warning message when maximum tool-call turns (5) exhausted without final answer
- 6 new unit tests: `fetchWithTimeout` timeout/passthrough/success (agent.js), `fetchWithTimeout` timeout/success (agent-connect.js), `isVisionUnsupportedError` false-positive regression test

### Fixed
- **Operator-precedence bug** in `isVisionUnsupportedError` — previously any error containing the word "vision" (e.g. "revision not found") was misidentified as a vision-unsupported error; now requires both "vision" and "not supported" in the message
- **Corrupted JSON config handling** — `JSON.parse` in all 4 config loaders (`loadAgentConfig`/`loadProviderConfig` in both files) now wrapped in try/catch with clear coded error messages instead of raw `SyntaxError` stack traces

### Changed
- Version bumped from 0.4.0 to 0.5.0 across all three locations (agent.js, agent-connect.js, package.json)
- `fetchWithTimeout` exported from both files for testability
- Test count increased from 147 to 153

## [0.4.0] - 2026-02-13

### Added
- `package.json` — project manifest with bin entries, test script, engines >=18.0.0 (zero runtime dependencies preserved)
- `.editorconfig` — consistent formatting across editors (UTF-8, 2-space indent, LF)
- `ERROR_CODES` constant objects in both `agent.js` (16 codes) and `agent-connect.js` (14 codes), replacing scattered hardcoded strings
- `module.exports` for pure functions in both main files (23 from agent.js, 7 from agent-connect.js)
- `require.main === module` guard in both files — CLI behavior unchanged when run directly, functions importable for testing
- 147 unit tests using `node:test` (`test/agent.test.js` with 114 tests, `test/agent-connect.test.js` with 33 tests)
- GitHub Actions CI workflow for automated test runs on push and PR

### Changed
- Version bumped from 0.3.1 to 0.4.0 across all three locations (agent.js, agent-connect.js, package.json)
- Error messages in both files now reference centralized `ERROR_CODES` constants instead of inline strings

### Improved
- Documentation (README.md, README.de.md) rewritten with USPs, architecture diagrams, concept explanations, and troubleshooting tables
- All docs pages (get-started, config-reference, api-examples) expanded and maintained in both EN and DE

## [0.3.1] - 2026-02-13

### Added
- Comprehensive documentation UI/UX improvements
- Scroll-spy for table of contents with active state highlighting
- Copy-to-clipboard buttons for all code blocks
- Icon-based sun/moon theme toggle
- Fixed position controls (language/theme) for always-visible access
- Mobile-optimized sticky controls layout
- Sidebar close button (X) for mobile navigation
- Accessibility features (skip-link, focus-visible, reduced-motion support)
- Print stylesheet support

### Changed
- Refactored CSS with design system (spacing, typography, shadows, animations)
- Improved responsive design for all screen sizes
- Updated all HTML templates with modern structure
- Better z-index hierarchy for mobile navigation

### Fixed
- Mobile controls layout (Menu left, Theme+Language right)
- Content spacing to prevent overlap with fixed controls
- Hide sidebar close button on desktop

## [0.3.0] - 2026-02-12

### Added
- File attachments via `--file` (repeatable) with strict validation.
- Image attachments via `--image` (repeatable) for vision-capable models.
- Tools mode flags `--tools auto|on|off` and alias `--no-tools`.
- Multilingual docs source structure with English default and German optional pages.
- MIT license (`LICENSE`).

### Changed
- `agent.js` and `agent-connect.js` runtime/help output standardized to English.
- Docs language switch updated to a responsive flag dropdown.
- Provider catalog in setup wizard expanded and sorted alphabetically.

### Fixed
- Docs language switch path issues between EN and DE pages.
- Mobile docs layout and navigation behavior.

### Security
- Attachment handling uses hard size/type limits and clear error codes.
- Local backups exclude `agent.auth.json`.
