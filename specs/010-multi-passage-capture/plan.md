# Implementation Plan: Capture Multiple Passages from the Same Post

**Branch**: `010-multi-passage-capture` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-multi-passage-capture/spec.md`

## Summary

Let a user capture several **distinct passages** (verbatim selections) from one post/source URL,
instead of the current URL-as-one-capture behavior that blocks a second selection with "Already
Captured." The write path already supports one URL → many distinct quotes (verified against
the backend); the blocker is entirely client-side.

**Technical approach:** (US1, client-only) make the duplicate classification **text-scoped** — pass
the current selection text into `src/utils/duplicate-status.ts` and compare it, normalized (NFKC +
whitespace-collapse + trim), against the passage texts returned (URL-derived) by
`existing_sightings_for_url[]` (ADR-0007, shipped); block only on a normalized-equal match — and
resolve the "view quote" link from **that matched entry's** validated `web_url`, not `matches[0]`
(G2) — otherwise allow and reframe the submit action as "Capture another passage." Re-capture is
**selection-driven** (extend the existing Article-only selection watcher to all posts), not a
persistent button. The near-match (similar/variant) classifier is also made **selection-text-aware**
(`similar-diff.ts`) so a near-identical selection at an already-known URL reaches the spec-006 path
instead of the removed URL-exact short-circuit (G1).

**Privacy fix (Art. II).** The **automatic (page-load) preflight** (`service-worker.ts`,
`trigger: automatic-preflight`, ~L3558) stops sending `text: postData.text` — its tweet/user-data
egress becomes **`{handle, source_url}`** (⊆ the Article II allowlist), plus the fixed non-identifying
`platform` client constant permitted under Art. II.1 (amendment v1.1.0). Exact per-passage matching runs locally
against the URL-derived `existing_sightings_for_url[]`; the text-bearing fuzzy/similarity lookup
already lives on the **explicit** overlay path (`overlay-bar.ts checkDuplicate` → `CHECK_DUPLICATE`,
which sends `text` at L1918) and the `explicit-duplicate-check` preflight site (~L3369, keeps
`text`), both explicit user actions. This **removes a pre-existing Article II violation** rather
than inheriting it; the passive icon loses only pre-click fuzzy "similar" state (URL-exact still
resolves passively; fuzzy resolves on overlay open / selection).

(US2) render a global "N passages captured from this post" panel from `existing_sightings_for_url[]`
— **display at most 5 snippets + a "+N more" indicator** (from `existing_sightings_total`) — and
show the count on the toolbar badge **only when the distinct count is ≥ 2**, via
`chrome.action.setBadgeText` + an accessible `setTitle`.

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

**Performance Goals**: The overlay opens from cached URL-scoped data (panel, count, exact-match) with
**no blocking network call on open**; a selection change re-runs the **local** exact-match against the
cached list (no network). The text-bearing fuzzy/similar lookup is a **non-blocking** explicit-action
request that updates the similar UI when it returns — it never blocks overlay render or selection
preview (AMB1). Classification + normalization are O(n) string compares over the **≤ 50 returned
entries** per URL (ADR-0007 caps the *returned list*, not the true total) — a bounded, purely local
operation added to the existing cached-render path (no new network work on open).

**Constraints**: `splitChunks: false` (MV3 single-file bundles) preserved. No new manifest
permissions. Pre-action egress is **reduced** to identifier-only — the automatic preflight no longer
sends quote text (Art. II fix). Degrade, don't throw, on API drift; validate arrays + non-negative
integer totals at runtime (Art. V).

**Scale/Scope**: Small, focused change across **~9 existing source files** + 1 new util (+ a CI
drift-check workflow/script for VI.3); **≤ 50 returned
entries** per URL (the backend caps the returned list; the true total may exceed 50 and is surfaced
via "+N more"). Twitter/X only.

## Constitution Check

*GATE: evaluated pre-Phase 0 and re-checked post-Phase 1. No violations → Complexity Tracking empty.*

| Article | Gate | Verdict |
|---|---|---|
| I — Capture Integrity | Verbatim excerpt only; exact text shown pre-submit; no editable field; explicit submit | **PASS** — a passage is a verbatim selection (§2 explicitly permits excerpt narrowing); no new text input; existing preview/submit unchanged. |
| II — Privacy | Pre-action egress ⊆ {tweet_id, handle, source_url}; text/writes only on explicit action | **PASS (compliance fix)** — the automatic (page-load) preflight is made **identifier-only**; the pre-existing `text: postData.text` passive egress is **removed** (FR-014). Text-bearing fuzzy lookup stays on the explicit overlay/`explicit-duplicate-check` paths only. Corrects a pre-existing Article II violation rather than inheriting it (research D5). Store-listing/privacy-policy disclosure re-synced to the identifier-only bound (Art. II.3, task T027). |
| III — Security & Permissions | No new permissions; validate API-provided URLs | **PASS** — no permission change; `web_url` links scheme-validated via existing `safeHref` (research D6). |
| IV — Observability | Content-free telemetry unaffected | **PASS** — no telemetry change. |
| V — Resilience | Ignore unknown fields; degrade not throw; rebuildable badge state | **PASS** — new fields read defensively; arrays validated as arrays and `existing_sightings_total` accepted only as a non-negative integer, neutral degradation on malformed/missing data (FR-011); badge state via the rebuildable resolver→applicator path (research D6, D8). **V.2 kill-switch / min-version is a standing tracked requirement per constitution amendment v1.1.0 — not a per-feature gate until first shipped; deferred, tracked in bead `qw-g4s31`.** |
| VI — Quality & Testing | Deterministic logic test-first; DOM/UI characterized | **PASS** — deterministic logic (normalize / classify / matched-link / count / badge-resolve) is test-first; the in-post-content guard (now on ordinary posts) and the Shadow-DOM passages panel are characterized against **captured-HTML fixtures** (ordinary post + X Article) per VI.2, not jsdom stubs alone (research D7). **VI.3 scheduled live-X drift check is built here (Phase 6, T028–T029; bead `qw-5j5nj`) — a non-blocking scheduled workflow that files an issue on selector drift.** |
| VII — User Experience | Quiet, accessible (not color/glyph alone; keyboard; ARIA), honest copy | **PASS** — badge count paired with accessible `setTitle` (Context7 D4); panel links keyboard-operable + ARIA; "N passages captured" copy is honest, no overstatement. |
| VIII — Platform Scope | No speculative multi-platform abstraction | **PASS** — X-only; no adapter changes. |
| IX — Release Discipline | Single-sourced version; no release-mechanism impact | **PASS** — no version/manifest change; no release-mechanism impact. (The server kill-switch is an Art. V.2 concern, tracked separately above — this row no longer claims it "intact.") |

**Result: PASS for all feature-introduced work.** V.2 (kill-switch) is deferred as a **standing
tracked requirement** per constitution amendment **v1.1.0** (bead `qw-g4s31`; not a per-feature gate
until first shipped). **VI.3 (live-X drift check) is built here** (Phase 6, T028–T029; bead
`qw-5j5nj`). Article II's prior passive text egress was a pre-existing violation this feature
**removes**; store-listing/privacy disclosure re-synced (T027).

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
├── utils/duplicate-status.ts                     # text-scope classifyDuplicateSighting/classifyMatchResolution (accept current text); matched-passage resolver (web_url of the normalized-equal entry, G2); passage-count helper
├── content/ui/overlay-bar.ts                     # relax submit block to text-scoped; extend selection watcher to all posts; "Capture another passage" action + notice; refresh cache post-submit
├── content/ui/components/duplicate-badge.ts      # "already captured this passage" (link = matched entry's web_url) vs "adding another" copy/directives; passages panel — ≤5 snippets + "+N more"
├── content/ui/components/similar-diff.ts         # receive current selection text so near-match at a known URL routes to similar/variant, not URL-exact (G1)
├── background/icon-state-resolver.ts             # thread passage count into presentation (count from utils/duplicate-status.ts); numeric badge only ≥ 2
├── config/icon-states.ts                         # count-badge presentation (text/color) for total ≥ 2
├── background/icon-applicator.ts                 # setBadgeText({text,tabId}) + setBadgeTextColor + accessible setTitle
└── background/service-worker.ts                  # automatic-preflight → identifier-only (drop text: postData.text ~L3558, Art. II fix); pass existing_sightings_total from cached duplicate-check into resolver/applicator

tests/                                            # mirrors src/ — test-first for utils/*, icon-state-resolver; FIXTURE characterization for the selection guard + panel
├── fixtures/                                     # NEW — captured live-X HTML: ordinary post + X Article (in-post-content guard characterization, Art. VI.2, C3)
├── utils/quote-text.test.ts                      # NEW
├── utils/duplicate-status.test.ts                # text-scoped cases + matched-link resolver
├── content/ui/overlay-bar.test.ts               # selection-driven add-another; post-submit cache refresh; identifier-only passive preflight (no text egress)
├── content/ui/components/duplicate-badge.test.ts # panel (≤5 + "+N more") + copy — corrected path (A2)
└── background/icon-state-resolver.test.ts        # count badge state (≥ 2)
```

**Structure Decision:** Single-project MV3 extension — the change lives in the existing
`src/utils` (pure logic), `src/content/ui` (overlay + badge component), and `src/background`
(icon resolver/applicator/service-worker) layers, plus one new pure helper (`src/utils/quote-text.ts`).
No new entry points, no new modules beyond that helper, no manifest/permission changes. US1
(`duplicate-status.ts` + `overlay-bar.ts` + `duplicate-badge.ts` copy) is shippable independently of
US2 (badge count + passages panel), matching the spec's P1/P2 split.

## Complexity Tracking

> No **feature-introduced** Constitution violations. One **standing gate** is deferred; the other is
> built here:

| Gate | State in repo | Disposition |
|---|---|---|
| **V.2** — server kill-switch / min-version signal | Absent (no mechanism in `src/`) | **Standing tracked requirement** per constitution amendment **v1.1.0** — not a per-feature gate until first shipped; deferred, tracked in bead `qw-g4s31`. |
| **VI.3** — scheduled live-X drift-check workflow | Absent (only push/PR CI in `.github/workflows/ci.yml`) | **Built in this feature** (Phase 6, T028–T029; bead `qw-5j5nj`) — scheduled, non-blocking, files an issue on selector drift. |

> **Article II** previously carried a real violation — the automatic preflight sent `text: postData.text`
> on page load. This feature **removes** it (Constitution Check II, research D5), so no Article II
> deviation remains to justify.
