# Overlay Bar Refactoring Design

## Problem

The extension has ~3,500 lines of dead code from a disabled popup UI, and the active overlay bar (`overlay-bar.ts`, 1,139 lines) inlines all rendering logic for duplicate badges, originator lookup, quote preview, and submit/login actions. This monolithic file caused a wasted edit when we modified the dead `DuplicateDisplay` class instead of the overlay bar's inline rendering.

## Decision

1. Delete all popup-related dead code
2. Decompose the overlay bar into focused components using plain classes (Approach A)

## Dead Code Deletion

Remove entirely:

- `src/popup/popup.ts` (1,678 lines)
- `src/duplicate/duplicate-display.ts` (499 lines)
- `src/duplicate/duplicate-checker.ts` (346 lines)
- `src/search/originator-search.ts` (624 lines)
- `src/lookup/handle-lookup.ts` (233 lines)
- `src/lookup/handle-lookup-display.ts` (184 lines)
- `public/popup.html`, `public/popup.css`
- All corresponding test files
- `popup/popup` webpack entry point and `@popup` path alias

Directories `src/duplicate/`, `src/search/`, `src/lookup/` are deleted entirely.

## Component Architecture

```
src/content/ui/
├── overlay-bar.ts          # Orchestrator: mount, show/hide, state coordination
├── components/
│   ├── quote-preview.ts    # Quote text display, selection handling
│   ├── originator-lookup.ts # Handle lookup with cache + preload
│   ├── duplicate-badge.ts  # Duplicate status badge with Quotewise links
│   └── action-button.ts    # Submit/Login/Retry button
```

### Component Pattern

Each component is a plain class that owns a DOM container element:

```typescript
class DuplicateBadge {
  constructor(container: HTMLElement)
  update(state: { checking: true } | { result: DuplicateCheckResult } | null): void
}
```

### OverlayBar (Orchestrator)

Keeps:
- Shadow DOM mounting and base markup
- `CaptureState` object
- Show/hide/refresh lifecycle
- `sendMessage` helper
- Coordination flow: expandCapture -> auth check -> lookup -> duplicate check -> enable submit

Delegates to components:
- `QuotePreview.update()` for quote text rendering
- `OriginatorLookup.lookup()` for handle lookup with cache/preload
- `DuplicateBadge.update()` for duplicate status display
- `ActionButton.showSubmit()`/`showLogin()` for button state

### Component Interfaces

**QuotePreview** renders into `#quote-preview`:
- `update(text, selectedText)` — shows full text or selection with clear button
- `showSuccess(text, wasPartial)` — shows submitted confirmation
- Callback: `onClearSelection()`

**OriginatorLookup** renders into `#originator-info`, owns originator cache:
- `lookup(handle, preloadedData?)` — returns `{ found, originator, createUrl }`
- Uses `MessageSender` for API calls

**DuplicateBadge** renders into `.quote-preview-row`:
- `update(state)` — shows checking spinner, sighting badges with links, or nothing
- Returns submit button directives (enabled/disabled/warning) via callback or return value

**ActionButton** renders into `.originator-row .section.right`:
- `showSubmit(enabled, text?)` — standard submit button
- `showSubmitWarning(enabled, text)` — warning-style submit
- `showLogin()` — login button with OAuth flow
- Callbacks: `onSubmit()`, `onLogin()`

## UX Impact

None. Same DOM structure, same Shadow DOM, same visual output.

## Testing

- Delete all popup test files
- New component tests in `tests/content/ui/components/`
- Each test: mount real DOM element in jsdom, call `update()`, assert innerHTML and events
