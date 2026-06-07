# Phase 0 Research: Extension Toolbar Icon States

**Feature**: `004-extension-icon-states` | **Date**: 2026-06-06

The spec is already heavily clarified (two Clarifications sessions) and backed by an approved design
doc. There were **no open `NEEDS CLARIFICATION` markers**; the work here is to (a) resolve the
remaining *integration* choices against current library docs (consulted via Context7) and (b)
record the design-vs-spec tensions and the small set of platform gotchas that affect implementation.
The 2026-06-06 update adds the implementation decisions from missing-originator and tray/toolbar
synchronization regressions. Format per decision: **Decision · Rationale · Alternatives considered**.

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

## D10 — Missing-originator is resolver context, not a duplicate recommendation

- **Decision**: Track `originator.found === false` as tab-scoped resolver context
  (`isOriginatorMissing`) and render `MissingOriginator` (`@ #E69F00`) after Exact/Similar/Conflict
  and before New. Store a short-lived `preloadedOriginator` result for the tray so opening the tray
  does not immediately re-check a known-missing handle.
- **Rationale**: A missing originator blocks capture because the extension cannot create originators
  yet, so showing New (`★`) is misleading. The duplicate API's `recommendation` does not encode this
  blocker; it is preflight/originator state. Keeping it outside `DuplicateCheckResult → QuoteStatus`
  avoids contaminating duplicate mapping with setup-state semantics.
- **Alternatives considered**: map absent originator to New — rejected because it implies capture is
  available; map it to Error — rejected because auth/API are not broken; add it to duplicate-status
  mapping — rejected because the source data is originator preflight, not duplicate recommendation.

## D11 — Automatic extraction retry is bounded and keyed to the current tweet

- **Decision**: When navigation-triggered extraction returns no tweet data or stale data, schedule a
  short bounded retry sequence for the same tweet/status ID. Cancel retries on success, tab close,
  non-tweet navigation, auth-invalid state, or status-ID change.
- **Rationale**: X can update the URL before the reply article is ready. Without a retry, the toolbar
  may never reach MissingOriginator unless the user opens the tray; without current-status scoping, the
  parent/head tweet's duplicate status can leak onto the reply. A bounded retry gives the DOM time to
  catch up without spinning indefinitely under MV3.
- **Alternatives considered**: wait only for `tabs.onUpdated`/history events — rejected because they
  often fire before the target article is rendered; unbounded polling — rejected as a battery/runtime
  risk and inconsistent with MV3 worker lifecycle.

## D12 — Tray-originator lookups feed the toolbar through a status event

- **Decision**: Wrap tray-originator lookup so the toolbar enters Loading while lookup is in flight,
  then re-resolves from the same current-tweet result. If the tray resolves from fresh in-memory,
  preloaded, or cached originator data without making an API call, it still sends a lightweight status
  event to the worker with the current `source_url`.
- **Rationale**: The tray can know the originator state before the background preflight path finishes,
  especially when it uses preloaded/cached data. Without a status event, the tray appears correct while
  the toolbar remains stale for seconds. The `source_url`/status-ID guard ensures a tray result for one
  tweet cannot update another tweet's badge.
- **Alternatives considered**: wait for automatic preflight to eventually converge — rejected because it
  preserves the visible tray/toolbar mismatch; make the tray write `chrome.action` directly — rejected
  because it would reintroduce competing icon writers and violate the single-resolver design.

## D12a — Slow combined preflight falls back to handle-only originator lookup

- **Decision**: When automatic combined preflight hits its bounded timeout on the same current tweet, and the
  worker still has the tweet handle, start one short internal `LOOKUP_ORIGINATOR_BY_HANDLE` fallback. Apply the
  fallback response through the same originator state path used by tray lookups, and ignore it if a newer tray or
  navigation operation supersedes it.
- **Rationale**: The tray can often report missing-originator quickly because it uses the handle-only endpoint,
  while closed-toolbar automatic status was previously limited to the slower combined preflight. Clearing Loading
  to a no-badge Ready state before the later `@` made the toolbar briefly claim no action was needed. The fallback
  preserves the existing bounded timeout while letting the toolbar converge with the tray without requiring a click.
- **Alternatives considered**: extend the combined-preflight timeout — rejected because it keeps a misleading blue
  dot longer and still does not use the faster handle-only path; clear immediately to Ready — rejected because it
  causes the observed Ready-to-`@` flash; make the tray write toolbar state directly — still rejected by D12.

## D12b — Missing-originator can use a delayed handle-only probe before timeout

- **Decision**: Shortly after automatic combined preflight starts, run one bounded
  `LOOKUP_ORIGINATOR_BY_HANDLE` probe only if the same automatic operation is still current. A probe `found:false`
  result caches `preloadedOriginator`, clears automatic Loading, and applies `@`; `found:true` only warms the tray
  cache and keeps Loading until duplicate/preflight status resolves.
- **Rationale**: The combined preflight remains the authoritative duplicate-status source, but missing-originator
  status can often be known earlier from the lighter handle endpoint. Delaying the probe avoids duplicate requests
  when combined preflight is fast, while still preventing a closed-tray `●` from lingering until the 8-second timeout.
- **Alternatives considered**: start the second request immediately — rejected because fast combined preflight would
  create avoidable duplicate traffic; wait for the timeout-only fallback — rejected because it leaves known
  missing-originator tweets in Loading too long; let `found:true` clear Loading — rejected because duplicate status is
  still unknown.

## D12c — Adapter-pushed tweet data keeps the worker alive through first icon result

- **Decision**: For the content adapter's pushed `TWEET_DATA_EXTRACTED` message, the service worker holds
  `sendResponse` until the automatic preflight/probe/fallback path has applied the first terminal current-tweet icon
  state, or until the bounded preflight/probe/fallback window expires. The adapter fires that message asynchronously
  and returns extracted data to callers immediately. Scope this keepalive to the pushed runtime-message path;
  background-initiated extraction remains nonblocking.
- **Rationale**: In MV3, responding immediately to the pushed tweet-data message removes the active message port
  while the tray is closed. The service worker can then go idle before the final `chrome.action` write, even though
  opening the tray masks the issue by sending another message and keeping the worker alive. Awaiting that held
  response inside the content adapter blocks overlay/tray rendering and can surface a temporary "No tweet detected"
  state while preflight is still running.
- **Alternatives considered**: rely only on `chrome.alarms` — rejected because alarms help timeout recovery but do
  not keep the normal successful API response path alive; make every tab-update extraction await the whole window —
  rejected because it blocks background fallback/retry handlers unnecessarily; make the tray wait for the keepalive —
  rejected because current tweet data is already available locally; add a tray-only refresh — rejected because
  closed-tray toolbar status is a core requirement.

## D13 — Passive preflight is privacy-gated by the preload preference

- **Decision**: Automatic duplicate/originator preflight may run only when the user-controlled
  pre-action preload setting allows it. The delayed handle-only probe stays inside that boundary and sends only
  public `{handle, platform, source_url}`. Writes remain explicit-action only.
- **Rationale**: Article II permits preloading to make the overlay/tray feel instant, but requires a
  global setting to disable all pre-action network calls. The toolbar's ambient status can use preload
  only within that privacy boundary.
- **Alternatives considered**: always preload — rejected by the constitution; never preload — rejected
  because it leaves the toolbar unable to provide the ambient signal required by Article VII until the
  user clicks.

## D14 — Unsupported sites use grey unavailable artwork, not a badge

- **Decision**: For authenticated users outside the current supported capture surface, render the grey
  owl with no badge and tooltip "Quotewise — capture works on X/Twitter tweets". On supported X/Twitter
  pages without a tweet in focus, render the full-color owl with no badge and tooltip "Quotewise — open
  a tweet to capture".
- **Rationale**: The extension currently captures only X/Twitter tweets. A full-color "ready" state on
  unsupported domains implies capture may work there; a badge would consume the quote-status channel for
  a platform-level availability issue. Grey/no badge cleanly says "not usable here" while the tooltip
  distinguishes unsupported-site from logged-out.
- **Alternatives considered**:
  - Treat unsupported pages as Ready — rejected because it overstates availability.
  - Add an unsupported-site badge — rejected because badges are reserved for auth/work/quote status and
    would add another glyph to decode at 16px.
  - Hide or disable the extension action entirely — rejected because Chrome action visibility is less
    predictable and tooltip feedback is useful.

---

## Resolved inputs (no backend work)

`DuplicateCheckResult` (`src/types/api.ts`) already carries `recommendation` (8 values),
`matches[].match_type`, `matches[].in_user_collections`, `matches[].similarity`, and
`existing_sightings_for_url[]` — confirmed this session. `AuthState` (7 values) and `TabContext`
(tabId, isSupportedPlatform, isTweetPage, isCheckInFlight, isOriginatorMissing, current tweet/status URL) are the
other inputs. Every spec state maps to existing data; the plan introduces **no** new backend endpoint or
permission. The existing `preloadedOriginator`/`preloadedDuplicateCheck` storage entries are transient
cache hints, not authoritative icon state.

## Outstanding manual-verification gates (carried to quickstart/tasks, not blockers)

1. Glyph legibility at 1× and 2× (D9).
2. Color decodability under Chrome DevTools "Emulate vision deficiencies" (deuteranopia/protanopia/
   achromatopsia) — SC-004.
3. Generated greyed PNG set is visibly desaturated and correctly dimensioned — asserted by the asset
   test, eyeballed once on load.
4. Automatic preflight honors the pre-action preload setting; the delayed handle-only probe sends only public
   `{handle, platform, source_url}`.
