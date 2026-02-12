# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

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
