# Implementation Plan: Capture Overlay Tray — Cleanup, Privacy, Progress & Variant Flow

**Branch**: `005-capture-overlay-tray` | **Date**: 2026-06-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-capture-overlay-tray/spec.md`

## Summary

Spec 005 iterates the in-page **capture-overlay-tray** (Shadow-DOM bar on x.com/twitter.com tweet pages) and
adds the extension's first **settings/options page** plus the constitution-mandated privacy controls. Five themes,
all **client-only** (no backend change required for P1/P2):

1. **Declutter** — delete the engagement-metric/author-date chip row (`buildMetaChips()` in
   `overlay-bar.ts:410-433`); the raw metrics keep flowing to developers only through the existing
   `GET_DIAGNOSTICS` / `debugLog` channel, gated by `DEBUG_MODE` (`config/environment.ts:34`).
2. **Privacy & account control** — surface the existing `OAUTH_LOGOUT` flow in a new options page and a tray
   account menu; add a global **Private mode** that suppresses *all* capture/pre-action background network calls
   (the Article II.1 user-controlled-preload switch), with a one-time first-run notice rendered inside the
   overlay on the first eligible explicit open (never on page load — Article VII.1).
3. **Progress** — staged status text ("Checking…" → "Submitting…" → "Confirming…") on the submit flow, gated by a
   ~400 ms debounce so fast captures show nothing; spinner suppressed under `prefers-reduced-motion`.
4. **Predictable controls** — re-anchor refresh/close to the top-right, **top-aligned**, of the whole tray across
   collapsed and expanded states.
5. **Provenance-aware "similar" flow** — replace the read-only near-match badge with a **word-level diff** of
   captured-vs-on-record text (the on-record `matches[].text` is already returned by the API), plus a date-gated
   "add earlier sighting" action that stays disabled until the API exposes the matched record's published date.

**Technical approach**: persist device/account preferences in `chrome.storage.sync` under a **single `settings`
object key** (Context7-verified quota/best-practice), with every surface (service worker, content tray, options
page) reacting to `chrome.storage.onChanged` for `area === 'sync'` so FR-053 ("takes effect without manual reload")
holds with zero polling. Private mode gates the existing automatic-preflight entry points in `service-worker.ts`.
The toolbar gains one new **Paused** state folded into spec-004's single authoritative resolver. No new manifest
permission and **no new runtime dependency** — the word-level diff is a hand-rolled, test-first LCS util.

## Technical Context

**Language/Version**: TypeScript 5.3 (`target`/`module` ES2020, `strict: true`; `lib` ES2020 + DOM). Same toolchain
as spec 004.

**Primary Dependencies**: Runtime — **none added** (the repo has zero `dependencies`; the word-level diff is
hand-rolled per Article III.2). Build/dev — existing webpack 5 + `ts-loader` + `copy-webpack-plugin`. The options
page is a new webpack entry (`options/index.ts`) bundled to a single file (Constitution V.3); its HTML ships via
`copy-webpack-plugin` from `public/options.html` (no `html-webpack-plugin` needed — keeps the build pattern uniform).

**Storage**:
- **`chrome.storage.sync`** (NEW) — one `settings` object: `{ privateMode, autoAddToCollection, defaultCollectionId,
  firstRunNoticeShown }`. Roams across the user's signed-in Chrome devices (Clarification 2026-06-07). Quotas
  (Context7): 512 items / 102 400 bytes total / 8 192 bytes/item / 1 800 writes·hr⁻¹ / 120 writes·min⁻¹ — a single
  small object is far inside every limit.
- **`chrome.storage.local`** (existing) — user-identifying cache: `currentTweet`, `preloadedOriginator`,
  `preloadedDuplicateCheck`, `lastAuthCheck`, `originator_search_history`, `authState`, and the `oauth_*` token keys.
- Capture progress / Private-mode-gating decisions are derived at request time, never persisted.

**Testing**: Jest + ts-jest in jsdom (`jest.config.js`); Chrome APIs mocked in `tests/setup.ts` (extend, don't
redefine — `tests/setup.ts` already stubs `chrome.runtime.getManifest` → `Quotewise [DEV]`). New suites:
- **Deterministic (test-first, Article VI.1)**: settings store get/set/merge + `onChanged` propagation; Private-mode
  gate on the preflight entry points; logout/clear-data cache-wipe vs. preference-preservation; Paused resolver
  truth-table rows; staged-progress phase machine + debounce; word-level diff algorithm; add-sighting date-gate.
- **Characterization (Article VI.2)**: tray markup snapshots proving the metric row is gone, controls are top-right
  in both collapsed/expanded states, and the diff renders against captured HTML/text fixtures.

**Target Platform**: Chrome (Manifest V3). Adds an `options_ui` surface (full page) alongside the existing
background service worker + content script; the toolbar icon click still opens the in-page overlay (no popup).

**Project Type**: Single-project browser extension (MV3). Background + content + (new) options entry, each bundled
to a single file (`splitChunks: false`).

**Performance Goals**: Settings reads are O(1) `chrome.storage.sync.get`; cross-surface propagation is event-driven
(`onChanged`), not polled. The Private-mode gate is a boolean check before any capture/preflight scheduling — when
ON it **eliminates** preflight/duplicate/originator egress (SC-005), while auth-maintenance traffic such as token
refresh/session checks may continue. Staged progress only renders after a ~400 ms debounce so the fast path has zero
added work/flicker.

**Constraints**:
- **Article II.1**: Private mode ON ⇒ zero capture/pre-action egress for passive browsing *and* on overlay open
  (overlay shows an explicit **"Check now"**; Clarification 2026-06-07). Auth-maintenance traffic is excluded from
  the preload switch; quote text / writes only on explicit submit.
- **Article VII.1**: no UI injected on page load — the first-run notice renders inside the overlay on the first
  eligible explicit open.
- **Article VII.2/VII.3**: all new UI keyboard-operable, status by glyph/text (not color alone), visible focus,
  ARIA labels, honors `prefers-reduced-motion`/`prefers-contrast`, honest non-manipulative copy.
- **Article III.3**: no token/cookie/secret in any log, error, or diagnostic produced by logout/clear-data.
- Toolbar badge text is an image (not read by AT) → the Paused state pairs a self-contained `setTitle`.

**Scale/Scope**: ~6 tray/component edits (`overlay-bar.ts` + 3 components), 1 new options surface (HTML + entry +
3-ish view modules), 1 new settings-store module, 1 new word-diff util, Private-mode gating at ~3 service-worker
entry points, logout/clear-data cache-wipe wiring, and a spec-004 amendment (one new `ICON_STATES.Paused` + one
resolver branch + resolver input for `privateMode`). One manifest change (`options_ui`) across the three manifests.

**Unknowns**: None remaining — resolved in [research.md](./research.md). The single hard external blocker
(matched-record **published date** for FR-080..082 / US9) is tracked as a dependency, not a NEEDS CLARIFICATION; the
add-sighting action ships **hidden/disabled** until the django-api field lands.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0. Re-checked after Phase 1 design (below).*

This feature is the constitution's own privacy lever made real, so most articles are directly engaged.

- **Article I — Capture Integrity (NON-NEGOTIABLE)**: **PASS-by-construction.** No editable quote field is added
  (I.2). The word-level diff is *read-only* presentation of captured vs. on-record text; it never alters the text
  to be submitted, and the overlay still shows the exact submit text (I.2). Auto-add-to-collection (US7) attaches a
  collection to the *create* call but does not touch the quote text and still requires explicit submit (I.3). The
  add-sighting action (US9) is honestly labelled and gated; it never silently submits (I.3).
- **Article II — Privacy & Data Minimization**: **CORE OF THIS FEATURE.** Private mode IS the Article II.1
  user-controlled preload switch: when ON it suppresses **all** capture/pre-action calls
  (preflight/duplicate/originator), for passive browsing *and* overlay open, until explicit "Check now"/capture
  (FR-040/041/044, SC-005). Auth-maintenance traffic such as token refresh/session checks is excluded so the user can
  remain logged in. Default OFF (= preload ON), honored globally. Logout + "Clear my data" wipe tokens **and** all
  user-identifying cache and the account-bound `defaultCollectionId`, preserving only device prefs (FR-031/033,
  II.2). Pre-action egress stays limited to `{tweet_id, handle, source_url}`; quote text only on submit (II.1). ✅
  Gated & satisfied.
- **Article III — Security & Permissions**: **PASS.** **No new manifest permission** — `options_ui`, settings, and
  collections reuse existing `storage` + host access (FR-101, SC-010). **No new runtime dependency** — the diff is
  hand-rolled (III.2). No token/secret reaches logs/errors/telemetry in any new flow (FR-034, III.3). Lockfile stays
  committed/pinned. (Standing TODO: `cookies` permission removal — *already absent* in all three manifests, verified;
  no action needed here.)
- **Article IV — Observability**: **PASS.** The developer metrics retained via `GET_DIAGNOSTICS`/`debugLog` stay
  `DEBUG_MODE`-gated and out of production-visible UI and out of content-bearing telemetry (FR-002, SC-001). New
  diagnostics must strip tokens/handles/full tweet text (IV).
- **Article V — Resilience**: **PASS.** Settings live in `chrome.storage.sync` (authoritative, survives SW restart);
  the `firstRunNoticeShown` flag persists so the notice never re-fires after a worker restart, and the trigger is
  derived at overlay open from `authenticated && !privateMode && !firstRunNoticeShown` rather than a second
  "checks have run" flag (FR-043, V.1). The Private-mode gate and progress machine read/derive state, holding
  nothing correctness-bearing only in memory.
  Logout-in-flight race: a logged-out state MUST win over a late preflight response repopulating caches (edge case),
  preserving idempotent/re-entrant handlers (V.1). API drift: missing `matches[].text` → degrade to read-only badge;
  missing published date → hide add-sighting (V.2). No `splitChunks` change (V.3).
- **Article VI — Quality & Testing**: **PASS (TDD).** All deterministic logic (settings store, Private-mode gate,
  logout wipe, Paused resolver, progress/debounce machine, word-diff, date-gate) is **test-first** (VI.1). Tray/diff
  UI is covered by fixture-based characterization snapshots (VI.2). Any bug found mid-implementation begins with a
  failing repro (VI.2).
- **Article VII — User Experience**: **CORE.** No on-load injection — first-run notice appears only inside the
  overlay on explicit open (FR-043, VII.1). Top-anchored controls and the overlay cause no host-page layout shift
  and stay dismissable (FR-010/011, VII.1). Every new affordance is keyboard-operable, glyph/text-redundant (diff
  markers + Paused glyph, not color), visible-focus, ARIA-labelled, honoring reduced-motion/contrast (FR-011/022/
  072/100, VII.2). Copy is honest: progress never shows success before confirmation; the add-sighting label reflects
  what the backend actually does (a *sighting*, not a fabricated "variant") (FR-022/023/083, VII.3).
- **Article VIII — Platform Scope**: **PASS.** Twitter/X only; all changes live in shared tray/settings code or
  behind the existing `TwitterAdapter`. No speculative multi-platform abstraction (VIII).
- **Article IX — Release Discipline**: **PASS.** The `options_ui` key is added consistently across
  `manifest.json` / `manifest.prod.json` / `manifest.dev.json` (single-source rule). No version-field change is
  required by this feature itself (version bump happens at release per CLAUDE.md).

**Result: PASS.** No deviations — Complexity Tracking is empty. The only constraint is an *external* dependency
(matched-record published date) that gates US9/FR-080..082 to a hidden/disabled state; this is honest degradation,
not a constitution violation.

## Project Structure

### Documentation (this feature)

```text
specs/005-capture-overlay-tray/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature spec (input)
├── research.md          # Phase 0 — decisions & best-practice rationale
├── data-model.md        # Phase 1 — settings, progress, diff, paused entities
├── quickstart.md        # Phase 1 — how to build/load/verify each story
├── contracts/           # Phase 1 — surface contracts (see below)
│   ├── settings-storage.md          # chrome.storage.sync schema + onChanged sync
│   ├── messages.md                  # new MessageType additions
│   ├── options-page.md              # options_ui surface + tray account menu
│   ├── private-mode-and-toolbar.md  # Private-mode gating + Paused state (spec-004 amendment)
│   ├── progress-and-submit.md       # staged progress phase machine + debounce
│   └── similar-diff.md              # word-level diff + add-sighting date-gate
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
src/
├── content/
│   ├── ui/
│   │   ├── overlay-bar.ts                  # EDIT: drop buildMetaChips() row (FR-001);
│   │   │                                   #       re-anchor refresh/close top-right top-aligned (FR-010);
│   │   │                                   #       host first-run notice + account menu + "Check now"
│   │   └── components/
│   │       ├── quote-preview.ts            # EDIT: keyboard/focus/reduced-motion hardening (FR-011/100)
│   │       ├── duplicate-badge.ts          # EDIT: near-match → render word-diff + view link, no % (FR-070..073)
│   │       ├── action-button.ts            # EDIT: staged progress states + retry (FR-020..023)
│   │       ├── originator-lookup.ts        # (unchanged behavior; gated by Private mode upstream)
│   │       ├── account-menu.ts             # NEW: tray account menu (logout, private toggle, open settings) (FR-051)
│   │       ├── first-run-notice.ts         # NEW: one-time in-overlay notice (FR-043)
│   │       ├── progress-indicator.ts       # NEW: debounced staged-progress view (FR-020..022)
│   │       └── similar-diff.ts             # NEW: word-diff renderer + add-sighting affordance (FR-070..083)
│   └── common.ts
├── options/                                # NEW surface (webpack entry)
│   ├── index.ts                            # options page controller (account, logout, private, clear-data, collections)
│   └── views/                              # (optional) small view helpers
├── settings/
│   └── settings-store.ts                   # NEW: typed chrome.storage.sync wrapper + onChanged subscription (FR-053)
├── utils/
│   ├── word-diff.ts                        # NEW: hand-rolled LCS word-level diff (no dep) (FR-070)
│   ├── debounce.ts                         # REUSE for staged progress (FR-021)
│   └── duplicate-status.ts                 # (reuse mapping for near-match detection)
├── background/
│   ├── service-worker.ts                   # EDIT: Private-mode gate on preflight entry points (FR-040/044);
│   │                                       #       OPEN_OPTIONS_PAGE / CHECK_NOW / SETTINGS_* / CLEAR_DATA routing;
│   │                                       #       logout cache-wipe + in-flight-after-logout guard (FR-031/032)
│   ├── icon-state-resolver.ts              # EDIT (spec-004): add Paused branch + privateMode input (FR-090/091)
│   ├── storage-cleanup.ts                  # EDIT: centralize the user-identifying cache key set (logout/clear reuse)
│   └── api-handler.ts                      # EDIT: collections list + create-with-collection delegation (US7)
├── config/
│   ├── icon-states.ts                      # EDIT (spec-004): add ICON_STATES.Paused (grey owl + ‖) (FR-090)
│   └── environment.ts                      # (reuse DEBUG_MODE for metric diagnostics gating, FR-002)
├── api/
│   └── quotewise-api.ts                    # EDIT: thread collection id into submit; reuse listCollections() (US7)
└── types/
    ├── chrome.ts                           # EDIT: new MessageType members; Settings type
    └── api.ts                              # EDIT: optional matched-record quote_date (US9, when API ships)

public/
└── options.html                            # NEW: options page shell (copied to dist/ via copy-webpack-plugin)

manifest.json / manifest.prod.json / manifest.dev.json
                                            # EDIT: add "options_ui": { "page": "options.html", "open_in_tab": true }

webpack.config.js                           # EDIT: add 'options/index' entry + copy public/options.html
```

**Structure Decision**: Single-project MV3 extension, unchanged. The work fits the existing layout: tray edits stay
in `content/ui/**`, the new settings surface is an isolated `options/` entry (single-file bundle, V.3), shared
state goes through a new `settings/settings-store.ts` consumed by all three contexts via `chrome.storage` +
`onChanged`, and the toolbar change is a minimal amendment to spec-004's already-authoritative
`icon-state-resolver.ts` / `icon-states.ts` (no parallel resolver introduced — preserves the single-resolver
contract from 004).

## Complexity Tracking

> No constitutional violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
