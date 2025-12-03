# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) for capturing quotes from social media platforms (currently Twitter/X) and submitting them to the Quotewise/Quotosaurus backend. Uses Django session authentication via existing quotosaurus.com login.

## Build & Development Commands

```bash
npm run dev          # Webpack watch build to dist/; reload extension in chrome://extensions
npm run build        # Production bundle (minified)
npm run lint         # ESLint for TypeScript sources
npm run type-check   # tsc --noEmit for static type checking
npm test             # Jest + ts-jest in jsdom
npm test -- --coverage          # With coverage report
npm test -- path/to/file.test.ts  # Run single test file
npm run clean        # Remove dist/
```

After building, load the unpacked extension from `dist/` in `chrome://extensions` (Developer mode enabled).

## Architecture

### Three-Layer Communication Model

```
Content Script (page context)
    ↓ chrome.runtime.sendMessage
Service Worker (background context)
    ↓ fetch with session cookies
Quotewise API (Django backend)
```

### Entry Points (webpack)

- `src/background/service-worker.ts` → Background service worker handling messaging, auth monitoring, API delegation
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

- `src/platforms/twitter/adapter.ts` - Twitter/X DOM extraction
- Add new platforms by implementing `PlatformAdapter` and registering in `ContentOrchestrator`

### Message Types

All inter-context communication uses typed messages from `src/types/chrome.ts`. The `MessageType` enum defines message types; API-related messages are delegated from service-worker to `api-handler.ts`.

### Environment Configuration

`src/config/environment.ts` manages dev/staging/production settings matching Django backend. Environment detection uses manifest name, version flags, or domain detection.

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

## Key Files

- `manifest.json` - Extension permissions, content script matching (twitter.com/x.com status pages)
- `src/content/ui/overlay-bar.ts` - In-page capture UI shown via toolbar click
- `src/api/quotewise-api.ts` - Django API client with session auth
- `src/api/csrf-utils.ts` - CSRF token handling for Django
- `src/background/auth-monitor.ts` - Session authentication state monitoring

## Conventions

- PascalCase for classes/enums, camelCase for functions/variables, SCREAMING_SNAKE_CASE for constants/message types
- Keep side effects in entry points; prefer pure helpers in `utils/`
- Match existing 2-space indentation
- Validate Chrome permissions remain minimal; document permission changes in PRs
