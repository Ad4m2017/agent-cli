# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

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
