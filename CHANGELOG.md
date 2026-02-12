# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

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
