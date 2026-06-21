# Implementation Plan: Multi-Platform Quote Capture

## Summary

Refactor extension capture from X-specific tweet data to platform-neutral post data, then add flag-gated adapters for Threads, Bluesky, and Substack Notes. Backend contracts are canonical in `../quotewise/.worktrees/api-enhancements/docs/platform-dom-verification.md` and ADRs 0001-0004.

## Implementation

- Add `CapturedPostData`, platform metadata, source identity helpers, and a registry filtered by runtime platform flags.
- Migrate content orchestration, overlay lookup/preflight/submit, background automatic preflight, duplicate cache, and diagnostics to use platform/source identity.
- Preserve legacy Twitter fields and message aliases during migration so current X behavior and tests remain stable.
- Add conservative permalink adapters for Threads, Bluesky, and Substack Notes; keep their flags disabled until live audit passes.
- Add all requested hosts to manifests and document that release approval must match enabled host scope.

## Test Plan

- `bun run type-check`
- `bun run lint`
- `bun run test -- --runInBand`
- `bun run build`
- `bun run version:check`

## Promotion

Non-X platform flags can default on only after the live-browser matrix passes and raw probe JSON plus verdict summaries are committed for that platform.

