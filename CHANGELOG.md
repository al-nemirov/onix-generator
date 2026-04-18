# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.4.0] - 2026-04-18

### Added
- `GET /api/validate` — pre-export validation endpoint. Reports books
  missing ONIX-required fields (ISBN, title, language, contributors,
  publisher) and warns on missing prices/subjects. Useful for catching
  problems before submitting a feed to Bookwire or other distributors.

### Changed / Security
- `esc()` now strips XML 1.0-illegal control characters (U+0000–U+001F
  except tab/LF/CR, plus U+007F) before output. Prevents corrupted
  Excel cells from producing non-well-formed ONIX XML.
- API key authentication now uses `crypto.timingSafeEqual` instead of
  `===`, eliminating a timing side-channel on key comparison.
- `package.json` version synchronised with the actual project history
  (was stuck at 1.0.0 despite multiple feature releases).

### Dependencies
- `npm audit`: 0 vulnerabilities.

## [1.3.0] - 2026-03

- i18n (EN/ES/DE/RU), security audit fixes, misc bug fixes.

## [1.2.0] - 2026-03

- Bookwire compliance: 10 critical fixes for ONIX XML generation.

## [1.1.0] - 2026-02

- API auth, rate limits, input validation, security headers.

## [1.0.0] - 2026-02

- Initial public release.
