# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read [AGENTS.md](./AGENTS.md) first.** It is the canonical reference for project structure, build/test/release commands, version bumping, coding style, testing layout, PR conventions, and API-contract verification. This file adds architecture context and Claude-specific working rules; if the two ever disagree on build/process facts, AGENTS.md wins.

## Project Overview

Browser extension (Chrome and Firefox, Manifest V3) for capturing quotes from social posts and submitting them to the Quotewise backend (api.quotewise.io). Platform support is adapter-based — `src/platforms/` holds one adapter per supported platform and is the source of truth for which platforms are live. Authenticates via OAuth 2.0 Authorization Code + PKCE, sending an `Authorization: Bearer <token>` header (no session cookies / CSRF).

## Build & Development

**Always use Bun instead of npm** for this project. Commands live in AGENTS.md; the ones you'll reach for constantly:

```bash
bun run dev          # Webpack watch build to dist/; reload extension in chrome://extensions
bun run test -- path/to/file.test.ts  # Run single test file
```

**Version bumping:** never edit version fields by hand — use `bun run bump-version <version|major|minor|patch>` (updates `package.json` and both manifests together) and verify with `bun run version:check`.

After building, load the unpacked extension from `dist/` in `chrome://extensions` (Developer mode enabled).

## Architecture

### Data flow on post page load

```
1. Navigate to a supported post URL
2. Content script's ContentOrchestrator (src/content/orchestrator.ts) selects the
   matching platform adapter, which extracts post data from the DOM
3. POST_DATA_EXTRACTED → Service worker
4. Service worker (in parallel, non-blocking):
   a. Stores post data in chrome.storage.local
   b. Preloads originator lookup + duplicate check → caches results (60s TTL)
   c. Resolves and applies the toolbar icon/badge
5. User clicks toolbar → SHOW_OVERLAY → overlay opens instantly from cached data
```

### Three-Layer Communication Model

```
Content Script (page context)
    ↓ chrome.runtime.sendMessage
Service Worker (background context)
    ↓ fetch with Authorization: Bearer <oauth-token>
Quotewise API (Django backend)
```

All inter-context communication uses typed messages — the `MessageType` enum in `src/types/chrome.ts` is the canonical list (do not work from a remembered subset; read the enum). API-related messages are delegated from the service worker to `api-handler.ts`.

### Webpack / MV3 Constraints

**Code splitting is disabled** (`splitChunks: false`). MV3 service workers must be a single file — Chrome only loads the script declared in `manifest.json` and `importScripts()` is unavailable. Webpack's `splitChunks` extracts shared modules into separate chunk files, which the service worker can't load, causing it to crash on startup. Content scripts have the same single-file constraint. Keep `splitChunks: false` — the bundle size overhead is negligible for an extension.

### Platform Adapter Pattern

Platform-specific extraction is isolated behind the `PlatformAdapter` interface — read it in `src/platforms/types.ts` rather than from memory (it grows members as capture features land). To add a platform: implement the interface, register it in `src/platforms/registry.ts`, and follow `docs/adding-a-platform.md`.

### State & Caching

- **chrome.storage.local**: the current post's extracted data, plus preloaded originator-lookup and duplicate-check results (60s TTL) so the overlay opens without waiting on the network. `src/background/storage-cleanup.ts` prunes periodically; `src/background/privacy-cleanup.ts` clears user-data caches on logout / private mode.
- **In-memory caches** live with their owning components (e.g. the originator lookup cache inside `src/content/ui/components/originator-lookup.ts`).
- **Toolbar icon/badge**: resolved purely by `src/background/icon-state-resolver.ts` from the canonical state table in `src/config/icon-states.ts`, applied by `icon-applicator.ts`. Treat the table as the single source of truth for glyphs and states.

### Environment Configuration

`src/config/environment.ts` manages dev/staging/production settings matching the Django backend, including the OAuth client configuration. Keep domains and environment-specific values in that map — nowhere else.

## Key Files

The filesystem is the source of truth for structure (AGENTS.md has the folder map). Durable entry points:

- `src/background/service-worker.ts` - Service-worker entry: message routing, preloading, icon orchestration
- `src/content/index.ts` + `src/content/orchestrator.ts` - Content-script entry + adapter orchestration
- `src/content/ui/overlay-bar.ts` (+ `components/`) - Shadow-DOM overlay UI orchestrator and its components
- `src/api/quotewise-api.ts` - Quotewise API client (OAuth Bearer-token auth)
- `src/auth/` - OAuth PKCE flow, token storage/refresh, auth state machine/manager
- `src/platforms/` - Adapter registry, shared extraction helpers, per-platform adapters
- `manifest.prod.json` - Shipped manifest (webpack copies it to `dist/manifest.json`)
- `docs/status-and-badging-resolution.md` - Mermaid diagrams: how a duplicate-check result becomes toolbar icon, tray badge, and Submit state
- `docs/adding-a-platform.md` - Checklist for adding a platform adapter

## Issue tracking

External contributors: please use **GitHub issues** and pull requests — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

> Maintainers track work in an internal (private) issue tracker; that setup is not
> part of this repository.

## Bug Reports (CRITICAL)

When user reports a bug, don't start by trying to fix it. Instead:
1. Write a test that reproduces the bug (test should fail)
2. Use subagents to fix the bug and prove it with a passing test

## Type Safety

- Prefer `unknown` over `any` for truly unknown values; use type guards to narrow
- Use `Record<string, unknown>` for generic object shapes
- Chrome messaging APIs (`sendResponse`) require `any` - use eslint-disable comments with explanation
- Generic utilities (debounce, etc.) may need `any` in type parameters for proper inference - wrap with eslint-disable block
- For error casting, use intersection types: `as Error & { name: string }` rather than `as any`

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.
