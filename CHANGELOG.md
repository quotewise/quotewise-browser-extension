# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Handle the server's new `inconclusive_unscoped` duplicate-check verdict. A check run
  without an originator skips the trigram pass, so the server no longer claims `new_quote`
  for it. The extension previously fell through to a `default` branch and badged such
  answers as "New" — asserting an absence that was never checked (ADR-0009).

## [1.7.8] - 2026-08-04

### Fixed
- Reordered “Statistics for nerds” metrics to match the capture pipeline, removed
  the unused server-timing field, hid unmeasured values, and labeled duplicate-cache status.

## [1.7.7] - 2026-07-20

First release published to the extension stores (Chrome Web Store, Firefox
Add-ons); AMO previously carried 1.6.4.

### Added
- Firefox support: the WebExtension is built from the same source as Chrome
  (`bun run build:firefox`), with a browser-correct OAuth redirect (ADR-0008).
- `docs/adding-a-platform.md` contributor guide, driven by a single
  `PLATFORM_DEFINITIONS` source of truth.
- `CONTRIBUTING.md`, `SECURITY.md`, and `CODING_STANDARDS.md`.
- MPL-2.0 `LICENSE`.
- Tag-triggered release workflow that attaches the Chrome and Firefox packages
  to the GitHub release.

### Changed
- Platform-neutral UI copy (X / Threads / Bluesky / Substack Notes), replacing
  tweet/Twitter-only language.
- Collapsed the duplicate TWEET/POST internal message types to one vocabulary.

### Removed
- Dead root scaffolding (`test-popup.*`, `test-service-worker.js`), the unused
  staging environment config, and the ghost root `manifest.json`.

## [1.6.4]

### Added
- Capture from X, Threads, Bluesky, and Substack Notes.
- Collection picker and extension feedback entry points.

This is the first release tracked in this changelog; earlier history is in the
git log.

[Unreleased]: https://github.com/quotewise/quotewise-browser-extension/compare/v1.7.8...HEAD
[1.7.8]: https://github.com/quotewise/quotewise-browser-extension/compare/v1.7.7...v1.7.8
[1.7.7]: https://github.com/quotewise/quotewise-browser-extension/compare/v1.6.4...v1.7.7
[1.6.4]: https://github.com/quotewise/quotewise-browser-extension/releases/tag/v1.6.4
