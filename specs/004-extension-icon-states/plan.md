# Implementation Plan: Extension Toolbar Icon States

**Branch**: `004-extension-icon-states` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-extension-icon-states/spec.md`

## Summary

Replace today's three conflicting, badge-only icon-config sources with a **single deterministic
resolver** that drives the MV3 toolbar action across a **two-layer model**: an ambient **owl
artwork** layer (`chrome.action.setIcon`, color vs. greyed) and a **quote-status badge** layer
(`setBadgeText` + `setBadgeBackgroundColor`). The resolver is a pure function of
`(AuthState, DuplicateCheckResult | null, TabContext)` → `IconPresentation`, applied per the
FR-030 precedence, including a neutral auth-pending state for `UNKNOWN`/`CHECKING`/`AUTHENTICATING`
that does not flash "ready to capture". Quote-status selection is wired from the API's authoritative top-level
`recommendation` plus `in_user_collections` (extending `src/utils/duplicate-status.ts`, which today
reads only `sighting_status`). A new build-time **art pipeline** rasterizes one vector master
(`assets/owl.svg`, from the brand `quotewise.svg`) into the color and `-grey` PNG sets via
`@resvg/resvg-js`. The target model also includes platform availability (grey unavailable on
unsupported sites, full-color idle on X/Twitter), the missing-originator blocker (`@`), toolbar/tray
synchronization for originator lookup state, and tweet-status-ID scoping so X thread SPA navigation cannot leak
a parent tweet badge onto a reply. No backend change — every state maps to existing auth, URL/platform, duplicate,
and originator preflight data.

Follow-up timeout synchronization: automatic combined preflight now has a same-tweet timeout fallback to the
handle-only originator lookup path. A missing-originator fallback result uses the same toolbar state application as
the tray and replaces Loading directly with `@`, avoiding a transient Ready/no-badge presentation.

Follow-up missing-originator promptness: automatic combined preflight now also schedules a short delayed
handle-only originator probe while the same preflight operation remains in flight. A probe not-found result clears
only automatic Loading and applies `@` before the timeout; a probe found result warms `preloadedOriginator` while
leaving Loading in place for duplicate/preflight status.

Follow-up MV3 lifetime synchronization: adapter-pushed tweet-data messages now keep the runtime response channel
open until automatic preflight/probe/fallback applies the first terminal icon state or reaches the bounded keepalive
timeout, so closed-tray toolbar updates do not depend on opening the overlay/tray.

Follow-up tray responsiveness: the content adapter now fires that pushed background message asynchronously and
returns extracted tweet data to the overlay/tray immediately, so the MV3 keepalive does not surface temporary
"No tweet detected" UI while originator preflight is still running.

**Integration best-practices basis** (consulted via Context7 this session):
- **`chrome.action`** — `setIcon` takes a `{size→path}` dict with an optional `tabId`; pre-rendered
  PNGs delivered by `path` need no `OffscreenCanvas`/`ImageData` in the worker. `setBadgeText`,
  `setBadgeBackgroundColor`, `setTitle` each accept an optional `tabId` (tab-scoped beats global).
  `setBadgeTextColor` (Chrome 110+) auto-contrasts when unset → **we must not call it** (FR-003).
- **`@resvg/resvg-js`** — `new Resvg(svg, { fitTo:{mode:'width',value:N}, shapeRendering:2 }).render().asPng()`;
  prebuilt per-platform Rust binaries make it CI-portable (FR-062), unlike ImageMagick/`qlmanage`.

## Technical Context

**Language/Version**: TypeScript 5.3 (`target`/`module` ES2020, `strict: true`; `lib` ES2020 + DOM)

**Primary Dependencies**: Runtime — none (zero `dependencies` today; the resolver is pure TS over
the `chrome.action` API). Build/dev — **`@resvg/resvg-js`** (new devDependency, SVG→PNG rasterizer);
existing webpack 5 + `copy-webpack-plugin` (copies `public/` → `dist/`), ts-loader.

**Storage**: `chrome.storage.session` (existing `AuthStateData` via `AuthStateManager`) and
`chrome.storage.local` (existing `currentTweet`, `preloadedDuplicateCheck`, `preloadedOriginator`).
Icon/badge state is rendered from inputs, never persisted. In-memory retry/in-flight/status maps are
disposable optimizations and must be rebuildable after service-worker restart (Constitution V.1).

**Testing**: Jest + ts-jest in jsdom (`jest.config.js`); Chrome APIs mocked in `tests/setup.ts`.
New: resolver truth-table unit tests, duplicate-status mapping tests, applicator scoping/clear tests,
asset-pipeline checks, and service-worker/content regressions for missing originators, tray/toolbar
sync, late X rendering, and parent-to-reply stale data.

**Target Platform**: Chrome (Manifest V3) — `chrome.action` reference APIs; toolbar renders the
action icon at 16px (32px HiDPI), badge holds a single glyph (~4 char ceiling).

**Project Type**: Single-project browser extension (MV3). Background service worker + content
script, each bundled to a single file (`splitChunks: false`, Constitution V.3).

**Performance Goals**: Icon/badge update is O(1) and effectively instantaneous; the resolver does no
I/O. Automatic preflight may perform duplicate/originator lookup only when the user-controlled
pre-action preload setting allows it. The early handle-only probe sends only public
`{handle, platform, source_url}`. If preload is disabled, tweet-specific duplicate/originator network checks wait for
explicit user engagement.

**Constraints**: PNG only for `setIcon` (SVG unsupported); badge text is an image (not read by AT) →
every change pairs a self-contained `setTitle` (FR-050, Constitution VII.2). Resolver MUST be a pure
function so it is exhaustively testable and survives worker termination (rebuildable, V.1). No badge
animation — MV3 workers terminate mid-animation (FR-013, static `●`).

**Scale/Scope**: 13 canonical states (Ready, Supported-idle, Unsupported-page, Auth-pending, Logged-out,
Loading, Error, New, In-collection, Conflict, Exact, Similar, Missing-originator) over `AuthState (7) ×
DuplicateCheckResult.recommendation (8) × TabContext`. The canonical table has 14 title rows because Error has separate
session-expired and insufficient-privilege tooltips. One new resolver module, one extended util,
one build script, one new asset (greyed owl) per size, and a
manifest `default_title` copy change. Consolidation deletes/retires three legacy config paths.

**Unknowns**: None remaining — see [research.md](./research.md) (all design tensions, including the
design doc's "pulsing" loading dot vs. the spec's clarified **static** dot, are resolved there).

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0. Re-checked 2026-06-06 after
automatic preflight and tray/toolbar synchronization were added.*

Only the articles this feature can touch are gated; the rest are N/A (no capture submission,
permission, or multi-platform changes).

- **Article I — Capture Integrity**: N/A to extraction, but **PASS-by-construction**: the icon is a
  read-only signal; it MUST NOT pre-fill or submit, and on a failed/empty duplicate check it falls
  back to the ambient state and shows **no** quote-status badge (FR-041, SC-007) — never a misleading
  "collected"/"exact" badge. ✅ No silent best-guess.
- **Article II — Privacy & Data Minimization**: **GATED.** Automatic duplicate/originator preflight is
  allowed only under the user-controlled preload setting and must send only public identifiers
  before explicit user engagement. The delayed handle-only probe is governed by the same preload boundary and sends
  only public `{handle, platform, source_url}`. This feature must not introduce writes. If the preload setting is
  absent in the installed build, either add and honor it before shipping automatic preflight or disable automatic
  preflight until explicit user engagement.
- **Article III — Security & Permissions**: **PASS.** No new manifest permission (icon swap uses
  bundled assets + `chrome.action`, already implied by `action`). New dep `@resvg/resvg-js` is
  **dev-only** (build-time raster), carries a one-line PR justification, and is lockfile-pinned
  (III.2). No token/secret touches this code path (III.3).
- **Article IV — Observability**: **PASS.** Resolver/title strings are derived from state enums and
  truncated quote previews already shown to the user; diagnostics must strip tokens, handles, and full tweet text.
  *(Carry-over: existing titles embed a 50-char quote preview — kept, as it is user-visible content,
  not telemetry.)*
- **Article V — Resilience**: **PASS.** Resolver is pure and stateless; no correctness-bearing state
  in memory (V.1). Handler caches for in-flight checks, per-tab duplicate results, missing originators,
  and extraction retries are disposable and keyed to the current tweet/status ID. Handlers stay idempotent —
  re-resolving the same inputs yields the same icon (re-entrant under SW termination). `setIcon`/badge are tolerant of `DuplicateCheckResult` shape
  drift: unknown `recommendation`/`match_type` fall back to **New**/ambient, never throw (V.2). No
  webpack `splitChunks` change (V.3).
- **Article VI — Quality & Testing**: **PASS (TDD).** The resolver and the duplicate-status mapping
  are deterministic logic → **test-first** (VI.1): failing truth-table + mapping tests before
  implementation. The art pipeline is characterized by an asset check (dimensions + greyed-set
  desaturation), not guessed (VI.2).
- **Article VII — User Experience**: **PASS.** Icon is the ambient signal; no on-load injected UI
  (VII.1, unchanged). Unsupported sites use grey/no badge rather than implying capture is available. Every state is
  glyph+color redundant (WCAG 1.4.1 / FR-051) and exposes a correct accessible label via `setTitle` (VII.2).
  Copy is honest, single-voice "Quotewise — …"; no overstated "verified" claims (VII.3).
- **Article VIII — Platform Scope**: **PASS.** Twitter/X is the only supported capture platform in this feature.
  Unsupported sites are represented by an ambient unavailable state; no speculative multi-platform abstraction is
  introduced.
- **Article IX — Release Discipline**: **NOTE.** Manifest `default_title` changes ("Capture Quote"
  → "Quotewise") in `manifest.prod.json`/`manifest.dev.json` plus root `manifest.json` for local
  consistency (prod/dev are build-effective; root is not copied by webpack) — keep all in sync
  (single-source rule). No version-field change required by this feature itself.

**Result: PASS with one gated dependency — automatic preflight must honor the preload preference before
shipping as a passive network behavior. Complexity Tracking updated below.**

## Project Structure

### Documentation (this feature)

```text
specs/004-extension-icon-states/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — state model, enums, precedence, mapping tables
├── quickstart.md        # Phase 1 — build icons, load unpacked, walk the states, run tests
├── contracts/           # Phase 1 — internal/asset contracts
│   ├── icon-state-resolver.md     # pure resolver fn + chrome.action application contract
│   ├── duplicate-status-mapping.md# recommendation/in_user_collections → QuoteStatus
│   └── icon-assets.md             # SVG master → PNG set pipeline contract
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
src/
├── background/
│   ├── icon-state-resolver.ts        # NEW — single authority: (AuthState, DuplicateCheckResult|null,
│   │                                  #       TabContext) → IconPresentation (pure, no chrome.* calls)
│   ├── icon-applicator.ts            # NEW (or folded into service-worker) — applies IconPresentation
│   │                                  #       via chrome.action.setIcon/setBadge*/setTitle, including
│   │                                  #       auth-transition tab overwrites
│   ├── service-worker.ts             # EDIT — call resolver; DELETE updateExtensionIconForTweetPage,
│   │                                  #       updateCollectionBadgeForTweet, getCollectionBadgeConfig,
│   │                                  #       updateCollectionBadge; own supported-platform detection,
│   │                                  #       tweet-status-ID scoped preflight, retry,
│   │                                  #       duplicate/missing-originator cache, and tray lookup sync
│   └── auth-monitor.ts               # EDIT — REMOVE getBadgeConfig/updateBadgeState/
│                                      #       updateBadgeFromAuthStatus (duplicate source)
├── auth/
│   └── auth-state-machine.ts         # EDIT — retire presentation halves (getStateBadgeText/Color);
│                                      #         resolver owns presentation. Keep FSM/transitions.
├── content/ui/components/
│   └── originator-lookup.ts          # EDIT — pass source_url and notify worker when fresh cached/preloaded
│                                      #         originator state resolves for the current tweet
├── platforms/twitter/
│   └── adapter.ts                    # EDIT — reject cached/visible parent tweet data after reply navigation
├── utils/
│   └── duplicate-status.ts           # EDIT — add match_type + in_user_collections → QuoteStatus
│                                      #         mapping (keep existing sighting classifier for tray)
├── config/
│   └── icon-states.ts                # NEW — canonical state→{glyph,color,title} table (single voice)
└── types/
    └── api.ts                        # (reference only — DuplicateCheckResult already has the fields)

assets/
└── owl.svg                           # NEW — vector master, vendored from backend quotewise.svg

public/icons/                         # GENERATED + committed (copy-webpack-plugin → dist/icons/)
├── icon{16,32,48,128}.png            # color owl (regenerated from owl.svg)
└── icon{16,32,48,128}-grey.png       # NEW — greyed owl (#6b7280 on #e5e7eb)

scripts/
└── generate-icons.mjs                # NEW — resvg rasterize owl.svg → public/icons/*.png

manifest.prod.json / manifest.dev.json / manifest.json   # EDIT — action.default_title → "Quotewise"
                                                        # (prod/dev build-effective; root consistency-only)

tests/
├── background/
│   ├── icon-state-resolver.test.ts   # NEW — truth-table over AuthState × DuplicateCheckResult + ties
│   ├── icon-applicator.test.ts       # NEW — chrome.action scoping, icon paths, auth-transition clears
│   └── check-duplicate-badge.test.ts # EDIT — missing-originator, preflight retry, tray sync, stale data
├── content/ui/components/
│   └── originator-lookup.test.ts     # EDIT — source_url and cached/preloaded status notification
├── platforms/
│   └── twitter-adapter.test.ts       # EDIT — parent-to-reply stale data rejection
├── utils/
│   └── duplicate-status.test.ts      # EDIT — add match_type/in_user_collections mapping cases
└── assets/
    └── icon-pipeline.test.ts         # NEW — generated PNGs: dimensions + greyed-set desaturation
```

**Structure Decision**: Single-project MV3 extension (existing layout). The feature's center of
gravity is `src/background/` (the worker owns `chrome.action`), with the **pure resolver** isolated
from the **applicator** so the decision logic is unit-tested without Chrome mocks and the thin
applicator is the only code touching `chrome.action`. The canonical state table lives in
`src/config/` next to environment config. Generated PNGs are committed under `public/icons/` (the
existing copy-webpack source), with rasterization as a standalone `scripts/` step run via Bun — not
a webpack build step — to keep the MV3 single-file bundle untouched (V.3) and the assets reproducible
and diffable in CI.

## Complexity Tracking

> Automatic preflight is useful but constitution-gated because it can perform passive duplicate/originator
> lookups. The implementation must preserve the privacy boundary below.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Passive duplicate/originator lookup before opening the tray, including the delayed handle-only missing-originator probe | Provides the only ambient toolbar signal allowed by Article VII and lets Missing-originator render without forcing a click or waiting for the full timeout | Disabling all preload would make the toolbar misleading or blank until explicit engagement; instead, the preload preference must control this path and egress must stay limited to public identifiers |
