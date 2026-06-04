# Phase 0 Research: Extension Toolbar Icon States

**Feature**: `004-extension-icon-states` | **Date**: 2026-06-04

The spec is already heavily clarified (two Clarifications sessions) and backed by an approved design
doc. There were **no open `NEEDS CLARIFICATION` markers**; the work here is to (a) resolve the
remaining *integration* choices against current library docs (consulted via Context7) and (b)
record the one design-vs-spec tension and the small set of platform gotchas that affect
implementation. Format per decision: **Decision · Rationale · Alternatives considered**.

---

## D1 — SVG→PNG rasterizer: `@resvg/resvg-js`

- **Decision**: Add `@resvg/resvg-js` as a **devDependency** and rasterize the owl master with
  `new Resvg(svg, { fitTo: { mode: 'width', value: N }, shapeRendering: 2 }).render().asPng()`,
  emitting each target size {16, 32, 48, 128} directly (one `Resvg` per size, not one downscale).
- **Rationale** (Context7 `/thx/resvg-js`): Rust-core renderer with **prebuilt per-platform
  binaries** (`@napi-rs`) → CI-portable with no system libs, satisfying FR-062's "faithful,
  CI-portable renderer". `shapeRendering: 2` (geometricPrecision) preserves the 5-path interior
  detail (eyes/nose/feet) the spec requires (FR-061). Rendering each size natively (rather than
  rasterizing once large and downscaling) keeps the 16px glyph crisp.
- **Alternatives considered**:
  - **`sharp`** — also acceptable (spec allows either) and great at resize, but its SVG input path
    goes through librsvg/resvg too and it pulls a larger native footprint; resvg-js is the leaner,
    purpose-built choice here. Kept as the documented fallback.
  - **ImageMagick / `qlmanage`** — **rejected** by the spec/design: poor SVG fidelity (IM) and a
    forced white background + non-portability (`qlmanage`, macOS-only).

## D2 — Icon delivery: pre-rendered PNG via `setIcon({ path })`, not runtime `ImageData`

- **Decision**: Ship the color and grey PNG sets in the bundle and swap with
  `chrome.action.setIcon({ tabId?, path: { 16: 'icons/icon16-grey.png', … } })`. **No**
  `OffscreenCanvas`/`ImageData` generation in the worker.
- **Rationale** (Context7 Chrome `action` ref): `setIcon` accepts a `{size→path}` dict directly; the
  `ImageData`/`OffscreenCanvas` form exists only for *programmatically drawn* icons in a worker
  (where there is no `Image`/`document`). Our artwork is static and pre-rendered, so `path` is
  simplest, fastest, and avoids carrying canvas-draw code in the single-file worker.
- **Alternatives considered**: `OffscreenCanvas` → `getImageData` → `setIcon({ imageData })` — only
  needed if we tinted/composited at runtime. We don't; greyed is a build-time variant (FR-060/062).

## D3 — Art pipeline runs at author-time and PNGs are committed (not a webpack step)

- **Decision**: `scripts/generate-icons.mjs` reads `assets/owl.svg`, writes
  `public/icons/icon{n}.png` + `icon{n}-grey.png`, run via a Bun script
  (`bun run icons`). The generated PNGs are **committed**; `copy-webpack-plugin` continues to copy
  `public/` → `dist/`. CI regenerates and `git diff --exit-code`s the icons to catch drift.
- **Rationale**: Keeps the MV3 webpack build a pure single-file bundle (no native addon in the
  webpack graph; V.3 untouched), makes the assets reproducible and reviewable in PRs (binary diff is
  intentional and gated), and matches the repo's existing pattern (PNGs already live committed under
  `public/icons/`). `@resvg/resvg-js` stays a dev-only dependency, never shipped.
- **Alternatives considered**: a webpack plugin/loader that rasterizes on every build — rejected:
  couples the bundle to a native addon, slows `bun run dev` watch, and risks per-machine binary
  differences leaking into `dist/` without review.

## D4 — Loading indicator is a **static** `●` (spec overrides the design doc's "pulsing")

- **Decision**: Loading = a single static sky `●` `#56B4E9`, set once at check start, cleared/replaced
  on completion. **No animation.** `prefers-reduced-motion` is therefore **moot for the icon**.
- **Rationale**: The design doc (§4.1) wrote "pulsing sky dot … respect `prefers-reduced-motion`",
  but the **2026-06-04 clarification (authoritative)** resolved this to static: MV3 service workers
  can be terminated mid-animation, leaving frozen "debris"; badge/icon state persists in the browser
  process independently of the worker; and `setIcon` is documented for static images. The dominant
  real-world MV3 pattern is a static `'...'`/dot set once and cleared (FR-013). **The spec wins.**
- **Alternatives considered**: a `setInterval`/alarm-driven animation loop — rejected as unreliable
  under SW termination and explicitly discouraged by Chrome; also a needless wake source.

## D5 — Quote-status derives from the **top-level `recommendation`** (hybrid), not re-derived thresholds

- **Decision**: Map per FR-040: **(1)** if **any** match has `in_user_collections: true` →
  **In your collection** (`✓`); **(2)** else map `recommendation` in FR-030 order:
  `attribution_conflict*`→**Conflict** (`⚠`), `duplicate*`→**Exact** (`=`),
  `new_version*`→**Similar** (`~`), `new_quote*`→**New** (`★`). The extension does **not**
  recompute similarity thresholds.
  `matches[].match_type`/`similarity`/`existing_sightings_for_url[]` are retained for the future tray.
- **Rationale**: The backend (`_classify_match`/`_generate_recommendation` in
  `quotewise/services/quotes/service.py`) is the authority; re-deriving thresholds client-side would
  duplicate and drift from backend logic. `in_user_collections` is a per-match fact the top-level
  recommendation doesn't encode, so it is checked first (and is the most reassuring signal, top of
  the quote-status precedence). Verified the fields exist in `src/types/api.ts:DuplicateCheckResult`.
- **Alternatives considered**: select purely from `matches[].match_type` — rejected (FR-040): forces
  the extension to own threshold semantics and re-rank matches; the spec keeps that server-side.

## D6 — `setBadgeTextColor` is **never** called (let Chrome auto-contrast)

- **Decision**: Set only `setBadgeText` + `setBadgeBackgroundColor` (+ `setTitle`); never
  `setBadgeTextColor` (FR-003).
- **Rationale** (Context7 Chrome `action` ref): `setBadgeTextColor` is Chrome 110+ and **auto-picks a
  contrasting text color when left unset**. Overriding risks a worse contrast than Chrome's own
  computation and adds a needless call. The chosen Okabe-Ito backgrounds are picked for ≥3:1
  non-text contrast (FR-051) with the auto text color.
- **Alternatives considered**: force white/black badge text — rejected: brittle across the palette and
  redundant with the platform default.

## D7 — Scoping: quote-status badges per-`tabId`; ambient/auth global; explicit clears

- **Decision**: Quote-status (`★ ✓ = ~ ⚠`) and Loading (`●`) are applied with `{ tabId }`. Ambient
  artwork (color/grey owl), auth-pending, and auth-error (`!`) set a **global default**, then auth
  transitions also overwrite affected tweet tabs with `{ tabId }` so a prior tab-scoped badge/icon
  cannot shadow LoggedOut/AuthPending/Ready/Error. On a non-tweet page or tab switch away from a
  tweet (`tabs.onActivated`), the worker MUST **clear** the tab badge
  (`setBadgeText({ tabId, text: '' })`) and reset the icon to the ambient state so no stale per-tab
  badge leaks (FR-002, SC-007, edge cases).
- **Rationale** (Context7 Chrome `action` ref): tab-scoped settings take priority over global, so a
  per-tab quote badge naturally overlays the global ambient state for that tab while other tabs show
  ambient only. The same precedence means a later global auth update cannot clear a tab-specific
  quote badge or color icon; auth changes must global-set the default and then tab-overwrite affected
  tweet tabs.
- **Alternatives considered**: everything global — rejected: the current bug (one tab's badge
  bleeding onto others) traces partly to inconsistent scoping; the spec mandates per-tab quote state.

## D8 — Single resolver authority; delete the three legacy config sources

- **Decision**: New `src/background/icon-state-resolver.ts` (pure) owns FR-010..FR-030; a thin
  `icon-applicator` is the only caller of `chrome.action`. **Delete**
  `auth-monitor.getBadgeConfig`/`updateBadgeState`/`updateBadgeFromAuthStatus`,
  `auth-state-machine.getStateBadgeText/Color` (the presentation halves; keep the FSM), and
  `service-worker`'s `updateExtensionIconForTweetPage`,
  `updateCollectionBadgeForTweet`, `getCollectionBadgeConfig`, `updateCollectionBadge`.
- **Rationale**: The root cause of today's nondeterministic appearance is three sources writing the
  same surface with different colors/text; whoever writes last wins (design §1, FR-070, SC-005).
  One pure resolver + one applicator makes the surface deterministic and exhaustively testable.
- **Alternatives considered**: refactor in place across three files — rejected: leaves the
  last-writer-wins race; the spec requires *one* authority.

## D9 — Badge glyph rendering risk at 16px (the one platform gotcha to verify)

- **Decision**: Use the spec's glyph set `★ ✓ = ~ ⚠ ! ●`. During implementation, **render-test each
  glyph at real 16px and 32px (HiDPI)** in the toolbar; if `⚠` (U+26A0) renders as a color emoji or
  `~`/`=` look thin, fall back within the *same shape family* (e.g. force text presentation, or a
  bolder substitute) — never change color-only.
- **Rationale**: Badge text is rendered by Chrome's own text layout; some glyphs (notably `⚠`) can
  trigger emoji presentation, and thin marks (`~`, `=`) can wash out — both affect FR-051 (≥3:1
  non-text contrast) and SC-006 (exact-vs-similar legibility). This is the only behavior the docs
  can't guarantee; it's a manual verification gate, not a code unknown.
- **Alternatives considered**: drawing glyphs into the icon via OffscreenCanvas for pixel control —
  rejected as overkill; revisit only if a glyph proves unrenderable as badge text.

---

## Resolved inputs (no backend work)

`DuplicateCheckResult` (`src/types/api.ts`) already carries `recommendation` (8 values),
`matches[].match_type`, `matches[].in_user_collections`, `matches[].similarity`, and
`existing_sightings_for_url[]` — confirmed this session. `AuthState` (7 values) and `TabContext`
(tabId, isTweetPage, isLoading) are the other inputs. Every spec state maps to existing data; the
plan introduces **no** new API call, permission, or storage key.

## Outstanding manual-verification gates (carried to quickstart/tasks, not blockers)

1. Glyph legibility at 1× and 2× (D9).
2. Color decodability under Chrome DevTools "Emulate vision deficiencies" (deuteranopia/protanopia/
   achromatopsia) — SC-004.
3. Generated greyed PNG set is visibly desaturated and correctly dimensioned — asserted by the asset
   test, eyeballed once on load.
