# Implementation Plan: Capture Multiple Passages from the Same Post

**Branch**: `010-multi-passage-capture` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-multi-passage-capture/spec.md`

## Summary

Let a user capture several **distinct passages** (verbatim selections) from one post/source URL,
instead of the current URL-as-one-capture behavior that blocks a second selection with "Already
Captured." The write path already supports one URL → many distinct quotes (verified against
`../quotewise`); the blocker is entirely client-side.

**Technical approach:** (US1, client-only) make the duplicate classification **text-scoped** — pass
the current selection text into `src/utils/duplicate-status.ts` and compare it, normalized (NFKC +
whitespace-collapse + trim), against the passage texts now returned by `existing_sightings_for_url[]`
(ADR-0007, shipped); block only on a normalized-equal match, otherwise allow and reframe the submit
action as "Capture another passage." Re-capture is **selection-driven** (extend the existing
Article-only selection watcher to all posts), not a persistent button. (US2) render an "N passages
captured from this post" panel from `existing_sightings_for_url[]` and show the count on the toolbar
badge via `chrome.action.setBadgeText` + an accessible `setTitle`.

## Technical Context

**Language/Version**: TypeScript 5.3 (strict), ES2020 modules; bundled with Webpack 5.

**Primary Dependencies**: **None at runtime** (`package.json` `dependencies: {}`). Platform surface:
Chrome Extensions **Manifest V3** (`chrome.action`, `chrome.storage.local`, `chrome.runtime`
messaging), DOM Selection/Range API, `String.prototype.normalize('NFKC')`. Build/test tooling only:
`@types/chrome`, Webpack, Jest 29 + `ts-jest` + `jest-environment-jsdom` v30.

**Storage**: `chrome.storage.local` (existing `preloadedDuplicateCheck` cache — invalidated after a
capture; no new keys required).

**Testing**: Jest + ts-jest in jsdom. Deterministic logic test-first; selection driven via the
existing `window.getSelection()` stub (see research D7).

**Target Platform**: Chrome (MV3) on Twitter/X status + article pages (existing content-script match).

**Project Type**: Single-project browser extension (content script + MV3 service worker + shared
utils). No frontend/backend split.

**Performance Goals**: Overlay stays instant — no new network calls on the capture path (reuses the
existing duplicate-check/preload). Classification + normalization are O(passages) string compares
(passages capped at 50 by ADR-0007).

**Constraints**: `splitChunks: false` (MV3 single-file bundles) preserved. No new manifest
permissions. No new pre-action network egress (Art. II). Degrade, don't throw, on API drift (Art. V).

**Scale/Scope**: Small, focused change across ~6 existing source files + 1 new util; ≤50 passages
per URL (backend cap). Twitter/X only.

## Constitution Check

*GATE: evaluated pre-Phase 0 and re-checked post-Phase 1. No violations → Complexity Tracking empty.*

| Article | Gate | Verdict |
|---|---|---|
| I — Capture Integrity | Verbatim excerpt only; exact text shown pre-submit; no editable field; explicit submit | **PASS** — a passage is a verbatim selection (§2 explicitly permits excerpt narrowing); no new text input; existing preview/submit unchanged. |
| II — Privacy | Pre-action egress ⊆ {tweet_id, handle, source_url}; text/writes only on explicit action | **PASS** — no new pre-action calls; badge count reads a new field on the existing preload; text still leaves only on explicit submit (research D5). |
| III — Security & Permissions | No new permissions; validate API-provided URLs | **PASS** — no permission change; `web_url` links scheme-validated via existing `safeHref` (research D6). |
| IV — Observability | Content-free telemetry unaffected | **PASS** — no telemetry change. |
| V — Resilience | Ignore unknown fields; degrade not throw; rebuildable badge state | **PASS** — new fields read defensively with fallbacks; badge state resolves through the existing rebuildable resolver→applicator path (research D6, D8). |
| VI — Quality & Testing | Deterministic logic test-first; DOM/UI characterized | **PASS** — normalize/classify/count are test-first; selection via existing jsdom stub (research D7). |
| VII — User Experience | Quiet, accessible (not color/glyph alone; keyboard; ARIA), honest copy | **PASS** — badge count paired with accessible `setTitle` (Context7 D4); panel links keyboard-operable + ARIA; "N passages captured" copy is honest, no overstatement. |
| VIII — Platform Scope | No speculative multi-platform abstraction | **PASS** — X-only; no adapter changes. |
| IX — Release Discipline | Single-sourced version; kill-switch intact | **PASS** — no version/manifest change; no release-mechanism impact. |

**Result: PASS (no deviations).**

## Project Structure

### Documentation (this feature)

```text
specs/010-multi-passage-capture/
├── spec.md              # Feature spec (clarified 2026-07-02)
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1–D8 (incl. Context7 findings)
├── data-model.md        # Phase 1 — entities + consumed response shape + state
├── quickstart.md        # Phase 1 — build / test / end-to-end verification
├── contracts/
│   └── duplicate-check-consumed.md   # Consumed ADR-0007 response + internal interface changes
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root) — files this feature touches

```text
src/
├── types/api.ts                                  # + existing_sightings_for_url entry {text, short_code, web_url}; + existing_sightings_total
├── utils/
│   └── quote-text.ts                             # NEW — normalizeQuoteText(NFKC + collapse + trim)
├── utils/duplicate-status.ts                     # text-scope classifyDuplicateSighting/classifyMatchResolution (accept current text); passage-count helper
├── content/ui/overlay-bar.ts                     # relax submit block to text-scoped; extend selection watcher to all posts; "Capture another passage" action + notice; refresh cache post-submit
├── content/ui/components/duplicate-badge.ts      # "already captured this passage" vs "adding another" copy/directives; passages panel (snippet + web_url link)
├── background/icon-state-resolver.ts             # thread passage count into presentation (count from utils/duplicate-status.ts)
├── config/icon-states.ts                         # count-badge presentation (text/color) for total ≥ 2
├── background/icon-applicator.ts                 # setBadgeText({text,tabId}) + setBadgeTextColor + accessible setTitle
└── background/service-worker.ts                  # pass existing_sightings_total from cached duplicate-check into resolver/applicator

tests/                                            # mirrors src/ — test-first for utils/*, icon-state-resolver; characterization for overlay-bar/duplicate-badge
├── utils/quote-text.test.ts                      # NEW
├── utils/duplicate-status.test.ts                # text-scoped cases
├── content/ui/overlay-bar.test.ts               # selection-driven add-another; post-submit cache refresh
├── content/ui/duplicate-badge.test.ts?           # panel + copy (match existing file name)
└── background/icon-state-resolver.test.ts        # count badge state
```

**Structure Decision:** Single-project MV3 extension — the change lives in the existing
`src/utils` (pure logic), `src/content/ui` (overlay + badge component), and `src/background`
(icon resolver/applicator/service-worker) layers, plus one new pure helper (`src/utils/quote-text.ts`).
No new entry points, no new modules beyond that helper, no manifest/permission changes. US1
(`duplicate-status.ts` + `overlay-bar.ts` + `duplicate-badge.ts` copy) is shippable independently of
US2 (badge count + passages panel), matching the spec's P1/P2 split.

## Complexity Tracking

> No Constitution violations — nothing to justify.
