# Implementation Plan: Per-Capture Collection Picker & Add-to-Collection for Existing Quotes

**Branch**: `009-collection-picker` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-collection-picker/spec.md`

## Summary

Add a multi-select collection picker beside the capture action so a user files a new quote into chosen existing collection(s) — overriding their default for that capture only — and surface, on already-captured quotes, which of the user's collections already hold the quote plus an add-to-more affordance (membership-only). Auto-add/default settings also gain a second surface in the overlay dropdown (one shared synced value), and the toolbar badge reflects real membership after an add.

Technical approach: a new pure seed/reconcile helper + a `CollectionPicker` UI component in the existing Shadow-DOM overlay; one new idempotent backend endpoint (`POST /v1/collections/{id}/quotes/`) called once per target collection (best-effort, per-collection feedback); a `member_collections` field added to the duplicate-check response; collection list fetched ONLY on explicit picker open and cached in `storage.local` (rebuildable, ~5 min TTL) — never preloaded on page load (Article II.1) — and the last-used set persisted in `storage.sync` (written once per completed add, only when changed — well inside the 120/min write limit). No new npm dependencies and no new manifest permissions.

## Technical Context

**Language/Version**: TypeScript (strict) on Chrome Manifest V3; Bun for tooling.

**Primary Dependencies**: None new. Platform: `chrome.storage.sync`/`chrome.storage.local`, `chrome.action` (badge), `chrome.runtime` messaging. Build: Webpack (`splitChunks: false`). Test: Jest + ts-jest (jsdom).

**Storage**:
- `chrome.storage.sync` — existing `Settings` (adds `lastUsedCollectionIds: string[]`; reuses `autoAddToCollection`, `defaultCollectionId`). Synced, persistent. Written once per completed add, only when the set changes (per context7: sync allows 120 writes/min, 1800/hr — over-limit writes fail immediately; this usage is orders of magnitude under).
- `chrome.storage.local` — collection-list cache `{ collections, default_collection_id, ts }` with ~5 min TTL, populated on explicit picker open (NOT page-load preload — Article II.1). Rebuildable disposable cache (Article V).

**Testing**: Jest/jsdom. Deterministic logic (seed precedence, stale reconcile, partial-failure aggregation, badge resolution) is test-first (Article VI.1); the picker UI is fixture-characterized (Article VI.2).

**Target Platform**: Chrome MV3 extension, active on X/Twitter status pages.

**Project Type**: Browser extension (single project, existing `src/` layout).

**Performance Goals**: On a warm cache (list fetched within ≈ 5 min) the picker renders synchronously with no network round trip and no spinner; a cold open MAY show a brief loading state. No collection fetch ever occurs on tweet-page load.

**Constraints**: Single-file SW/content bundles (`splitChunks: false`); no new permissions/dependencies (Article III); `storage.sync` write-rate and 8 KB/item limits respected; collection-list cache and last-used set wiped on logout/private/clear-data (Article II.2); store-listing/privacy-policy disclosure (Article II.3) reviewed for the new collection fetch/cache and synced last-used set (task T025).

**Scale/Scope**: Per-user; collections typically tens, not thousands; last-used set is a small `string[]` (far under 8 KB/item and the 512-item cap).

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1 design.*

- **I — Capture Integrity**: PASS. Picker governs destination only; no editable quote-text field (FR-006). Selections staged until explicit capture (FR-005). Capture survives any collection-filing failure (FR-013) — strengthens, not weakens, integrity.
- **II — Privacy & Data Minimization**: PASS. The collection list is fetched ONLY on explicit picker open (FR-022) — never as a passive pre-action call — so pre-action egress stays limited to `{tweet_id, handle, source_url}` (II.1). Cache + synced last-used set wiped on logout/private/clear-data (FR-024, II.2). Disclosure of the new fetch/cache/synced last-used set is reviewed against the store listing + privacy policy (II.3, task T025).
- **III — Security & Permissions**: PASS. No new manifest permission; no new runtime dependency; no token/secret in new logs or copy.
- **IV — Observability**: PASS. No new telemetry; any added diagnostics stay content-free.
- **V — Resilience**: PASS. Idempotent membership add (FR-014) survives retries and mid-flight SW termination; collection-list cache is rebuildable (`storage.local`); last-used-set loss is non-correctness-bearing (just resets pre-selection); API client ignores the new `member_collections` field on old builds and treats it as absent when missing.
- **VI — Quality & Testing**: PASS, with TDD obligations recorded above for the deterministic helpers; picker characterized via fixtures.
- **VII — User Experience**: PASS. Overlay-only UI (quiet presence preserved); FR-026 (WCAG 2.1 AA: keyboard, glyph+text, focus, ARIA, no layout shift) and FR-027 (honest copy) carried into all new UI.
- **VIII — Platform Scope**: PASS. No platform-adapter changes; no multi-platform abstraction added.
- **IX — Release Discipline**: PASS. No version-source or manifest changes beyond a normal release bump.

No violations require justification — Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/009-collection-picker/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (frozen API contract)
│   └── collections-api.md
└── checklists/
    └── requirements.md  # from /speckit-specify
```

### Source Code (repository root) — files this feature touches

```text
src/
├── content/ui/
│   ├── overlay-bar.ts                      # orchestrate picker; staged selection; submit/add; partial-failure UI; badge update (replaces hardcoded 'exists_not_collected')
│   └── components/
│       ├── collection-picker.ts            # NEW — multi-select list, read-only "Already in", empty state, manual Refresh
│       ├── collection-seed.ts              # NEW — pure: seed precedence (last-used→default→blank) + stale reconcile (test-first)
│       ├── account-menu.ts                 # add Auto-add toggle + default-collection selector (dropdown surface)
│       └── duplicate-badge.ts              # already-captured: show member_collections + "add to more"
├── settings/settings-store.ts              # add lastUsedCollectionIds; normalize/get/update
├── api/quotewise-api.ts                    # NEW addQuoteToCollection(); member_collections typing
├── background/
│   ├── service-worker.ts                   # badge after add (no collection page-load preload)
│   ├── api-handler.ts                      # route ADD_QUOTE_TO_COLLECTION; LIST_COLLECTIONS = fetch-on-open + storage.local cache (+ force-refresh)
│   └── privacy-cleanup.ts                  # wipe collection cache + last-used set
└── types/
    ├── api.ts                              # DuplicateCheckResult.matches[].member_collections; AddToCollection req/result
    └── chrome.ts                           # MessageType.ADD_QUOTE_TO_COLLECTION; Settings.lastUsedCollectionIds

tests/                                      # mirror: collection-seed (unit, test-first), settings-store, api client, picker fixtures, badge resolver
```

**Structure Decision**: Single existing extension project. The only new files are one UI component (`collection-picker.ts`), one pure helper (`collection-seed.ts`), and their tests; everything else extends existing modules following their current patterns (component composition under `overlay-bar.ts`, message routing in `api-handler.ts`, fetch-on-open + `storage.local` cache reusing the existing originator/duplicate cache pattern).

## Complexity Tracking

> No Constitution Check violations — nothing to justify.
