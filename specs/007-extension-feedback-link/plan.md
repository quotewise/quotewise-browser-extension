# Implementation Plan: Extension Feedback Link

**Branch**: `007-extension-feedback-link` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-extension-feedback-link/spec.md`

## Summary

Add a minimal "Send feedback" action to the extension settings page and directly to the tray Gear menu. Both surfaces open the already-deployed Quotewise feedback page with only approved non-sensitive context (`src=chrome-ext`, extension version, platform), preserving existing account/settings behavior and adding no new permission, storage, or backend work.

## Technical Context

**Language/Version**: TypeScript targeting Chrome Manifest V3

**Primary Dependencies**: Existing Chrome extension APIs, existing extension configuration, existing DOM helpers; no new runtime dependency

**Storage**: N/A; no new persisted state

**Testing**: Jest + ts-jest in jsdom with Chrome APIs mocked in `tests/setup.ts`

**Target Platform**: Chrome extension running on the existing Twitter/X-only capture surface plus the extension options page

**Project Type**: Browser extension with background service worker, content-script Shadow DOM UI, and options page

**Performance Goals**: Feedback action appears with existing settings/menu render and opens the destination immediately on activation; no background preload or network call is added before user action

**Constraints**: No new browser permissions; no OAuth/auth dependency; no quote text, selected text, tweet URL, social handle, user ID, collection name, token, or credential in the feedback destination; no changes to capture submission state

**Scale/Scope**: Two user-visible entry points, one shared URL-building helper, one background-mediated open path, focused unit coverage for settings, tray Gear menu, background message handling, and context sanitization

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Article I - Capture Integrity**: PASS. Feedback is outside quote submission and must not submit, alter, or clear captured text.
- **Article II - Privacy & Data Minimization**: PASS. Only explicit user activation opens feedback; no quote text or user-identifying data is sent; no storage added.
- **Article III - Security & Permissions**: PASS. Existing browser capabilities are sufficient; no new permissions or dependencies.
- **Article IV - Observability**: PASS. No telemetry is added by the extension; the hosted page owns its own triage behavior.
- **Article V - Resilience**: PASS. No correctness-bearing state is added; failed navigation is non-blocking and leaves existing UI usable.
- **Article VI - Quality & Testing**: PASS. Deterministic URL/context logic and UI action wiring are testable before implementation.
- **Article VII - User Experience**: PASS. Actions are explicit, keyboard-operable, honest, and do not inject new UI on page load.
- **Article VIII - Platform Scope**: PASS. Platform context remains `twitter`; no new platform abstraction.
- **Article IX - Release Discipline**: PASS. Version context comes from existing extension version source; no version field edits.

No constitution violations or deviations are required.

## Project Structure

### Documentation (this feature)

```text
specs/007-extension-feedback-link/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── feedback-entrypoints.md
└── tasks.md             # Created later by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── background/
│   └── service-worker.ts          # Opens feedback destination on explicit message
├── content/ui/components/
│   └── account-menu.ts            # Tray Gear/account menu feedback action
├── options/
│   └── index.ts                   # Settings page feedback action
├── types/
│   └── chrome.ts                  # Feedback-open message type
└── utils/
    └── feedback-url.ts            # Shared destination/context builder

tests/
├── background/
│   └── feedback-link.test.ts
├── content/
│   └── account-menu.test.ts
├── options/
│   └── options-page.test.ts
└── utils/
    └── feedback-url.test.ts
```

**Structure Decision**: Keep UI changes within existing extension surfaces. Centralize destination/context construction in `src/utils/feedback-url.ts`, and route both UI actions through a single background message so opening behavior and failure handling are consistent. The tray entry point is the existing Gear/account menu implemented by `src/content/ui/components/account-menu.ts`.

## Complexity Tracking

No constitution violations.
