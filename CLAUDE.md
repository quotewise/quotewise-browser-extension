# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) for capturing quotes from social media platforms (currently Twitter/X) and submitting them to the Quotewise backend (api.quotewise.io). Uses OAuth authentication.

## Build & Development Commands

**Always use Bun instead of npm** for this project.

```bash
bun run dev          # Webpack watch build to dist/; reload extension in chrome://extensions
bun run build        # Production bundle (minified)
bun run lint         # ESLint for TypeScript sources
bun run type-check   # tsc --noEmit for static type checking
bun run test         # Jest + ts-jest in jsdom
bun run test -- --coverage          # With coverage report
bun run test -- path/to/file.test.ts  # Run single test file
bun run clean        # Remove dist/
```

After building, load the unpacked extension from `dist/` in `chrome://extensions` (Developer mode enabled).

## Version Bumping

**Production releases**: Only update `manifest.prod.json` (webpack copies this to `dist/manifest.json`).

```bash
# Patch bump for production
# Edit manifest.prod.json version field, then:
bun run build
```

Other version files (for reference only):
- `manifest.dev.json` - dev builds only
- `package.json` - npm metadata, keep in sync manually
- `manifest.json` - unused by webpack

## Architecture

### Data Flow on Tweet Page Load

```
1. Navigate to tweet URL (x.com/user/status/123)
2. Content script activates → TwitterAdapter extracts data
3. TWEET_DATA_EXTRACTED → Service worker
4. Service worker (in parallel, non-blocking):
   a. Stores tweet data in chrome.storage.local
   b. Looks up originator by Twitter handle → caches result
   c. Checks for duplicates (with originator_id + social_handle) → caches result
   d. Updates extension badge (★ new, ✓ collected, + exists)
5. User clicks toolbar → Overlay opens instantly using cached data
```

### Three-Layer Communication Model

```
Content Script (page context)
    ↓ chrome.runtime.sendMessage
Service Worker (background context)
    ↓ fetch with session cookies
Quotewise API (Django backend)
```

### Webpack / MV3 Constraints

**Code splitting is disabled** (`splitChunks: false`). MV3 service workers must be a single file — Chrome only loads the script declared in `manifest.json` and `importScripts()` is unavailable. Webpack's `splitChunks` extracts shared modules into separate chunk files (e.g. `182.js`), which the service worker can't load, causing it to crash on startup. Content scripts have the same single-file constraint. Keep `splitChunks: false` — the bundle size overhead is negligible for an extension.

### Entry Points (webpack)

- `src/background/service-worker.ts` → Background service worker handling messaging, auth monitoring, API delegation, badge updates
- `src/content/index.ts` → Content script orchestrator that selects platform adapters
- `src/popup/popup.ts` → Extension popup (currently disabled in favor of in-page overlay)

### Platform Adapter Pattern

Platform-specific extraction is handled through adapters implementing `PlatformAdapter<TData>`:

```typescript
interface PlatformAdapter<TData> {
  id: Platform;
  matches(location: Location): boolean;
  bootstrap(): Promise<void>;
  teardown(): Promise<void>;
  getLatestData?(): Promise<TData | null>;
}
```

- `src/platforms/twitter/adapter.ts` - Twitter/X DOM extraction (text, author, metrics, tweet ID from article element)
- Add new platforms by implementing `PlatformAdapter` and registering in `ContentOrchestrator`

### Message Types

All inter-context communication uses typed messages from `src/types/chrome.ts`. The `MessageType` enum defines:
- `TWEET_DATA_EXTRACTED` - Content → Background when tweet data extracted
- `SHOW_OVERLAY` - Background → Content to display capture UI
- `LOOKUP_ORIGINATOR_BY_HANDLE` - Lookup originator by social handle
- `CHECK_DUPLICATE` - Check for duplicate quotes (accepts originator_id, source_url, social_handle)
- `SUBMIT_QUOTE` - Submit quote to backend
- `CHECK_AUTH_STATUS` - Check Django session authentication

API-related messages are delegated from service-worker to `api-handler.ts`.

### Caching Strategy

- **In-memory cache** (`originatorCache` in overlay-bar.ts): Session-lifetime cache for originator lookups by handle
- **chrome.storage.local**:
  - `currentTweet` - Current tweet data for popup/overlay access
  - `preloadedOriginator` - Originator lookup result (60s TTL)
  - `preloadedDuplicateCheck` - Duplicate check result (60s TTL)

### Environment Configuration

`src/config/environment.ts` manages dev/staging/production settings matching Django backend. Environment detection uses manifest name, version flags, or domain detection.

## Directory Structure

```
src/
├── api/                 # API client and utilities
│   ├── quotewise-api.ts # Main API client (auth, search, duplicate check, submit)
│   └── csrf-utils.ts    # CSRF token handling for Django
├── auth/                # Authentication utilities
│   ├── auth-checker.ts  # Auth status checking
│   └── login-handler.ts # Login flow handling
├── background/          # Service worker components
│   ├── service-worker.ts # Main entry, message routing, badge updates
│   ├── api-handler.ts   # API message delegation
│   ├── auth-monitor.ts  # Session monitoring
│   └── storage-cleanup.ts # Periodic storage cleanup
├── content/             # Content script
│   ├── index.ts         # ContentOrchestrator entry point
│   ├── common.ts        # Shared utilities (cleanUrl, parseNumber, etc.)
│   └── ui/
│       └── overlay-bar.ts # In-page capture UI with originator lookup
├── config/
│   └── environment.ts   # Environment detection and config
├── duplicate/           # Duplicate checking components
│   ├── duplicate-checker.ts  # Duplicate check logic and state
│   └── duplicate-display.ts  # Duplicate check UI rendering
├── lookup/              # Originator lookup components
│   ├── handle-lookup.ts      # Handle lookup logic and state
│   └── handle-lookup-display.ts # Handle lookup UI rendering
├── platforms/           # Platform adapters
│   ├── types.ts         # PlatformAdapter interface
│   └── twitter/
│       └── adapter.ts   # Twitter/X DOM extraction
├── popup/
│   └── popup.ts         # Extension popup (disabled)
├── search/              # Search components
│   └── originator-search.ts
├── types/               # TypeScript type definitions
│   ├── api.ts           # API request/response types
│   ├── auth.ts          # Auth types
│   ├── chrome.ts        # Extension message types, TwitterData
│   └── index.ts         # Re-exports
└── utils/
    ├── validators.ts    # Input validation
    └── debounce.ts      # Debounce utility
```

## Path Aliases

Use these webpack/tsconfig aliases instead of deep relative imports:
- `@api` → `src/api`
- `@types` → `src/types`
- `@content` → `src/content`
- `@popup` → `src/popup`
- `@background` → `src/background`
- `@config` → `src/config`
- `@platforms` → `src/platforms`

## Testing

Tests live in `tests/` mirroring src structure. Chrome APIs are mocked in `tests/setup.ts`—extend those mocks rather than redefining. Tests run in jsdom environment.

### Bug Reports (CRITICAL)
When user reports a bug, don't start by trying to fix it. Instead:
1. Write a test that reproduces the bug (test should fail)
2. Use subagents to fix the bug and prove it with a passing test

## Key Files

- `manifest.json` - Extension permissions, content script matching (twitter.com/x.com status pages)
- `src/content/ui/overlay-bar.ts` - In-page capture UI with originator lookup, duplicate check display, quote submission
- `src/api/quotewise-api.ts` - Django API client with session auth
- `src/api/csrf-utils.ts` - CSRF token handling for Django
- `src/background/service-worker.ts` - Message routing, preloading, badge updates
- `src/background/api-handler.ts` - API message handling
- `src/platforms/twitter/adapter.ts` - Tweet data extraction from DOM

## Conventions

- PascalCase for classes/enums, camelCase for functions/variables, SCREAMING_SNAKE_CASE for constants/message types
- Keep side effects in entry points; prefer pure helpers in `utils/`
- Match existing 2-space indentation
- Validate Chrome permissions remain minimal; document permission changes in PRs

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
