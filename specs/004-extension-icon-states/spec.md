# Feature Specification: Extension Toolbar Icon States

**Created**: 2026-06-04
**Status**: Implemented with follow-up tasks pending
**Last Updated**: 2026-06-06 — Added platform-availability ambient state for authenticated users on unsupported sites; requirements/implementation split refreshed after badge/tray synchronization work.

## Overview

The toolbar **action icon** is the extension's only at-a-glance signal. This spec is the canonical,
implementation-driving contract for what that icon MUST communicate and how. It defines a **two-layer model** —
an **ambient artwork layer** (the owl, swapped via `chrome.action.setIcon`) that answers *"can I act here, and is
anything wrong?"*, and a **quote-status badge layer** (`setBadgeText` + `setBadgeBackgroundColor`) that answers
*"what is the status of this quote?"* — plus the precedence between them, the API data each state derives from,
the tooltip (accessible label) copy, and the art-asset pipeline.

The design rationale, sourcing (Chrome `chrome.action` + WCAG), and the full decision history live in the
companion design doc; this spec memorializes the **user stories** and **functional requirements**.
For quick implementation orientation, see the Mermaid diagrams in
[the icon resolver contract](./contracts/icon-state-resolver.md#c11-resolver-state-diagram) and
[the automatic preflight lifecycle contract](./contracts/automatic-preflight-lifecycle.md#lifecycle-state-diagram).

**Scope boundary.** This spec covers the **toolbar icon only**. The in-page **overlay bar** badges are
[Spec 002 — Sighting Status UI](../002-sighting-status-ui/spec.md); the **overlay/tray** owns detailed status
content the icon cannot carry (`similarity` %, platform sightings, conflicting originator, excerpt matches).
This spec only constrains the tray where tray-originator knowledge affects the toolbar icon for the current
tweet. Where 002 uses the coarser `sighting_status`, the icon uses the richer duplicate/preflight status
described below. Current capture support is limited to X/Twitter tweet pages; future social platforms and
general web capture are out of scope for this feature but should fit the same availability model.

## Background

- **Today's gaps (motivation).** `AUTHENTICATED` and `UNAUTHENTICATED` render identically (both set empty badge
  text, so neither color shows — only the tooltip differs); three config sources disagree on the same state
  (`auth-state-machine.ts`, `auth-monitor.ts`, `service-worker.ts`); color is overloaded (green = new *and*
  collected; orange = exists *and* insufficient-priv *and* sighting variants); the duplicate signal collapses
  exact/similar/conflict into one `+`; and `setIcon` is never called (artwork is constant).
- **Color semantics.** Badge colors MUST prioritize user-action semantics over palette uniqueness: green means
  safe/done/no action needed, orange-yellow means caution/review needed, vermillion means broken or risky,
  and blue/sky means available action or transient progress. Exact duplicates therefore share the green
  "safe" family with already-collected items, while similar versions use the caution color because they require
  review.
- **API data already available.** `/v1/quotes/check_duplicate/` → `DuplicateCheckResult` returns, per match:
  `match_type ∈ {exact_url, exact_same_originator, exact_different_originator, near_same_originator,
  near_different_originator, similar}`, a `similarity` (0–100), `in_user_collections`, plus a top-level
  `recommendation` and `existing_sightings_for_url[]` (confirmed in `quotewise/services/quotes/service.py`).
  Every icon state below maps to this existing data — **no backend change**.
- **Platform constraints (verified).** Badge text fits "only about four" characters; `setBadgeTextColor`
  auto-contrasts if unset (do not override); `setIcon` swaps artwork per-tab (PNG only — **SVG unsupported**);
  `setTitle` is the hover tooltip **and** the screen-reader accessible label; tab-scoped settings beat global.
- **Current platform scope.** The only supported capture surface is X/Twitter tweet pages. Authenticated users on
  unsupported sites should see an unavailable/grey ambient state, not the same full-color "capture may be available"
  state used on X/Twitter.

## User Scenarios & Testing

### User Story 1 - Tell at a glance whether I'm signed in and usable here (P1)

A user glances at the toolbar to know whether the extension is usable on this page.

**Why this priority**: Today logged-out is invisible (tooltip-only), and authenticated users can also land on pages
where capture is not supported. Users need to know whether the extension can act here before clicking.

**Acceptance**:
- **When** auth state is `UNAUTHENTICATED`, the system **MUST** swap the artwork to the **greyed owl** (visible
  at a glance, no badge) and set the tooltip "Quotewise — log in to capture quotes".
- **When** auth state is `AUTHENTICATED` on an unsupported site, the system **MUST** swap the artwork to the
  **greyed owl** (no badge) and set the tooltip "Quotewise — capture works on X/Twitter tweets".
- **When** auth state is `AUTHENTICATED` on X/Twitter without a tweet in focus, the artwork **MUST** be the
  full-color owl with no badge and tooltip "Quotewise — open a tweet to capture".
- **When** auth state is `AUTHENTICATED` on a tweet page, the artwork **MUST** be the full-color owl; quote-status
  badges MAY overlay it according to the precedence rules below.
- **When** auth state is transitional (`UNKNOWN`, `CHECKING`, or `AUTHENTICATING`), the artwork **MUST** be the
  full-color owl with **no badge** and neutral tooltip "Quotewise"; it **MUST NOT** claim "ready to capture" or
  show any quote-status badge until `AUTHENTICATED` is confirmed.
- The available and unavailable states **MUST** be distinguishable by the artwork alone, not by tooltip alone.

### User Story 2 - Know a tweet is new and capturable (P1)

A user on a tweet permalink wants to know, without opening the bar, that this quote is not yet in Quotewise.

**Why this priority**: The core "should I capture this?" signal.

**Acceptance**:
- **When** the duplicate check returns no matches (`recommendation: new_quote`), the badge **MUST** show
  `★` on `#0072B2` (blue) with tooltip "New quote — not in Quotewise yet".

### User Story 3 - Know I already collected it (P1)

A user revisits a tweet they've already added to their collection.

**Why this priority**: Prevents duplicate effort; the most reassuring signal ("you have this").

**Acceptance**:
- **When** any returned match has `in_user_collections: true`, the badge **MUST** show `✓` on `#009E73`
  (green) with tooltip "Already in your collection".
- This state **MUST** take precedence over the other quote-status states (§ FR-030).

### User Story 4 - Distinguish an exact duplicate from a similar version (P2)

A user lands on a tweet whose text already exists in Quotewise, and wants to know whether it's the *same*
quote or merely *similar*.

**Why this priority**: "Exact dup" and "a paraphrase/near-version exists" call for different user actions; the
API distinguishes them and the icon should too.

**Acceptance**:
- **When** a match is `exact_url` or `exact_same_originator` (similarity = 1.0) and not in the user's
  collection, the badge **MUST** show `=` on `#009E73` (green), tooltip "Exact match already in Quotewise".
- **When** the best match is `near_same_originator` (0.8 < similarity < 1.0), the badge **MUST** show `~` on
  `#E69F00` (orange), tooltip "Similar version already in Quotewise".
- Exact and similar **MUST** be distinguishable by **shape** (`=` vs `~`) and semantic color family (safe green
  vs caution orange).

### User Story 5 - Be warned when a quote is attributed to someone else (P2)

A user captures a quote that already exists in Quotewise **attributed to a different originator**.

**Why this priority**: Possible misattribution is action-worthy; surfacing it early prevents a wrong submission.

**Acceptance**:
- **When** the best match is `exact_different_originator` or `near_different_originator`
  (`recommendation: attribution_conflict`), the badge **MUST** show `⚠` on `#D55E00` (vermillion), tooltip
  "Heads up — attributed to someone else in Quotewise".

### User Story 6 - See that work is happening, and that errors need action (P3)

A user sees the extension is checking a quote, or that their session needs attention.

**Why this priority**: Avoids a "is it broken or just slow?" gap; errors must be unmissable but not alarmist.

**Acceptance**:
- **While** a duplicate/preflight check is in flight, the badge **MUST** show a **static** `●` on `#56B4E9`
  (sky), tooltip "Quotewise — checking this quote…", set once when the check starts and cleared/replaced on
  completion. The indicator **MUST NOT** be animated (badge/icon animation is unreliable under MV3
  service-worker termination and is discouraged by Chrome).
- **When** auth state is `SESSION_EXPIRED` or `INSUFFICIENT_PRIVILEGES`, the badge **MUST** show `!` on
  `#D55E00` (vermillion) with an actionable tooltip; there **MUST NOT** be a ring around the artwork.

### User Story 7 - Know capture is blocked by a missing originator (P2)

A user lands on a tweet from a handle that Quotewise does not yet recognize.

**Why this priority**: The extension cannot create originators yet, so "new quote" is misleading; capture is
blocked by setup work outside the extension.

**Acceptance**:
- **When** preflight returns `originator.found: false` for the tweet handle, and no higher-priority quote-status
  state applies, the badge **MUST** show `@` on `#E69F00` (orange), tooltip "Originator not in Quotewise — add
  them first".
- When pre-action preload is enabled, the toolbar badge **MUST** reach this state from page-load/SPA preflight
  without requiring the user to open the overlay/tray first. While the combined duplicate/originator preflight is
  still in flight, the worker MAY run one short delayed handle-only originator probe for the same current tweet so a
  missing-originator `@` can render before the 8-second timeout. If pre-action preload is disabled, tweet-specific
  duplicate/originator network checks MUST wait for explicit user engagement.
- Adapter-pushed tweet data (`TWEET_DATA_EXTRACTED`) **MUST** keep its runtime message open until automatic
  preflight/probe has applied the first terminal current-tweet toolbar state, or until the bounded
  preflight/probe/fallback window expires. The toolbar MUST NOT rely on the overlay/tray being open for the final
  `chrome.action` update. The content adapter MUST NOT await that keepalive before returning extracted tweet data
  to the overlay/tray; the tray must be able to render the current tweet while background preflight continues.
- Toolbar and overlay/tray status for the current tweet **MUST** stay synchronized. If the overlay/tray determines
  the current tweet's originator is missing before automatic preflight completes, the toolbar MUST replace Loading
  with `@` promptly.
- If automatic combined preflight times out while the toolbar has the current tweet handle, the toolbar **MUST**
  make a short bounded originator-only fallback check before clearing to a no-status Ready state. A missing
  originator result from that fallback MUST replace Loading directly with `@` and MUST NOT flash an intermediate
  full-color/no-badge state.
- While the overlay/tray is actively checking the current tweet's originator, the toolbar MUST show the Loading
  `●` state. If the tray resolves from fresh preloaded/cached originator data without a new API call, the toolbar
  MUST still reach the same final state promptly.
- When navigating from a parent/head tweet to a reply in the same thread, parent tweet state **MUST NOT** be reused
  for the reply URL. The toolbar MUST bind quote/originator status to the current tweet and MUST prefer Loading or
  no quote-status badge over showing a stale parent badge.
- If the user navigates away from a tweet while a toolbar preflight, tray-originator lookup, or explicit duplicate
  check is still in flight, the late response for the prior tweet **MUST NOT** update the toolbar badge or
  per-tweet caches for the newly current tweet.
- This state **MUST** be terminal for the completed check: Loading `●` MUST be cleared or replaced when the
  current tweet's preflight/lookup result is known.

### Edge Cases

- **Multiple conditions true at once** (e.g. session expired *and* on a known-duplicate tweet): resolve by the
  precedence in FR-030 — the user sees exactly one state.
- **Non-tweet / non-actionable page**: no quote-status badge. On supported X/Twitter pages, the full-color owl
  invites opening a tweet; on unsupported sites, the grey owl indicates capture is unavailable here.
- **Duplicate check fails / `search_metadata.error`**: treat as no quote-status (fall back to ambient Ready);
  never show a misleading collection badge on an errored check.
- **`match_type: similar`** (≤ 0.8, weak): below the duplicate threshold — **MUST NOT** raise an exact/similar
  badge; treated as New for icon purposes (detail, if any, belongs in the tray).
- **Tab switching**: quote-status badges are tab-scoped; switching to a non-tweet tab **MUST NOT** leak the
  prior tab's badge; the system re-resolves on tab activation to restore the newly active tab's own state.
- **Auth transition after quote status**: because Chrome tab-scoped action settings beat global settings, a
  transition to logged-out, auth-pending, ready, or error **MUST** overwrite affected tweet tabs as well as the
  global default so a prior tab-scoped badge/icon cannot survive.

## Requirements

### Functional Requirements

**Two-layer rendering model**
- **FR-001**: Icon state MUST be expressed on two layers: an **ambient artwork** layer (`chrome.action.setIcon`)
  and a **quote-status badge** layer (`setBadgeText` + `setBadgeBackgroundColor`), composed per the precedence
  in FR-030.
- **FR-002**: Quote-status badges MUST be applied **per-tab** (`tabId`); ambient/auth states MAY be global, and
  MUST also overwrite affected tweet tabs during auth transitions so stale tab-scoped badge/icon settings never
  shadow `Logged-out`, `Auth-pending`, `Ready`, or `Error`. Quote-status badges MUST be cleared on non-tweet pages
  so a stale badge never persists.
- **FR-003**: The system MUST NOT call `setBadgeTextColor` (let Chrome auto-contrast the badge text).

**Ambient/system layer**
Loading and Error are semantic system states, not quote-status states. They render as badges on the
full-color owl but live in this group because they answer ambient "is work happening / is auth broken?"
questions and outrank quote-status badges.

- **FR-010**: `AUTHENTICATED` on a supported tweet page with no higher-priority state MUST render the
  **full-color owl**. With a tweet in focus and no quote-status badge, the tooltip MUST be "Quotewise — ready to
  capture"; on supported X/Twitter pages without a tweet in focus, the tooltip MUST be "Quotewise — open a tweet
  to capture".
- **FR-011**: `UNAUTHENTICATED` MUST swap to the **greyed owl** (`icon{n}-grey.png`) via `setIcon`, no badge,
  tooltip "Quotewise — log in to capture quotes".
- **FR-012**: `SESSION_EXPIRED` / `INSUFFICIENT_PRIVILEGES` MUST show the badge `!` on `#D55E00` on the
  full-color owl (no ring), with an actionable tooltip ("…session expired, log in again" /
  "…additional permissions required").
- **FR-012a**: Any Quotewise API response that indicates authentication is required or privileges are insufficient
  MUST be treated as an auth transition for icon presentation. The worker MUST immediately overwrite the sender
  tab's action icon/badge/title with the resolved `SESSION_EXPIRED` or `INSUFFICIENT_PRIVILEGES` Error state so
  stale tab-scoped tweet badges never remain visible while the tray shows a login/permissions-required state.
- **FR-013**: While a duplicate/preflight check is pending, MUST show a **static** `●` on `#56B4E9`, set once
  at check start and cleared/replaced on completion. The indicator MUST NOT be animated — Chrome badges/icons
  are static, an MV3 service worker may be terminated mid-animation (leaving frozen "debris"), and the
  badge/icon state persists in the browser process independently of the worker. (The dominant real-world MV3
  pattern is exactly this: a static `'...'`/dot set once and cleared on completion.)
- **FR-013a**: Automatic toolbar preflight Loading MUST be bound to a specific tab, tweet status ID, and operation
  ID, persisted in `chrome.storage.session`, and backed by an 8-second `chrome.alarms` timeout. The worker MAY start
  one short delayed handle-only originator probe for the same operation while combined preflight remains in flight.
  A probe `found:false` result MUST cache `preloadedOriginator`, clear only automatic Loading for that tweet, and
  apply Missing-originator directly; a probe `found:true` result MUST cache the originator for the tray but keep
  Loading until duplicate/preflight status resolves. If the timed-out operation still matches the current tweet and
  has a handle, timeout MUST replace automatic Loading with a short bounded originator-only fallback before resolving
  to ambient/no-status state. A fallback not-found result MUST apply Missing-originator directly; fallback
  timeout/error may then clear Loading and re-resolve ambient/tweet state. A late combined-preflight result MAY apply
  only if the tab still shows the same tweet. Tray-originator status for the same tweet MUST supersede automatic
  Loading immediately.
- **FR-013c**: For adapter-pushed `TWEET_DATA_EXTRACTED`, the worker MUST hold the asynchronous `sendResponse`
  channel open until automatic preflight/probe/fallback either applies a terminal icon state or reaches a bounded
  keepalive timeout. This MV3 keepalive MUST be scoped to the pushed runtime message path and MUST release pending
  duplicate/preflight bookkeeping if the keepalive expires, so a later current-tweet event can retry.
- **FR-013b**: Any tab-scoped per-tweet response (`PREFLIGHT_CHECK`, `LOOKUP_ORIGINATOR_BY_HANDLE`,
  `ORIGINATOR_LOOKUP_STATUS`, or `CHECK_DUPLICATE`) MUST verify the sender tab's current tweet status ID still
  matches the response `source_url` before writing caches or applying an icon. Stale responses after navigation
  MUST be ignored for icon/cache updates.
- **FR-014**: `UNKNOWN`, `CHECKING`, and `AUTHENTICATING` MUST render an **auth-pending neutral** state:
  full-color owl, no badge, tooltip "Quotewise". They MUST NOT render quote-status badges or the
  "ready to capture" tooltip until `AUTHENTICATED` is confirmed. If a duplicate/preflight check is already in
  flight, the Loading state MUST supersede this neutral state.
- **FR-015**: `AUTHENTICATED` on an unsupported site MUST render an **unsupported-page unavailable** state:
  grey owl, no badge, tooltip "Quotewise — capture works on X/Twitter tweets". It MUST NOT show Ready copy,
  Loading, or quote-status badges for unsupported sites.

**Quote-status badge layer** (rendered on the full-color owl)
- **FR-020**: `recommendation: new_quote` / `new_quote_known_author` (no qualifying duplicate) → `★` on
  `#0072B2`, tooltip "New quote — not in Quotewise yet".
- **FR-021**: any match with `in_user_collections: true` → `✓` on `#009E73`, tooltip "Already in your
  collection".
- **FR-022**: `recommendation: duplicate` / `duplicate_known_author` (match_type correlates `exact_url` /
  `exact_same_originator`, sim = 1.0), not in collection → `=` on `#009E73`, tooltip "Exact match already in
  Quotewise".
- **FR-023**: `recommendation: new_version` / `new_version_known_author` (match_type correlate
  `near_same_originator`) → `~` on `#E69F00`, tooltip "Similar version already in Quotewise".
- **FR-024**: `exact_different_originator` / `near_different_originator`
  (`recommendation: attribution_conflict` / `attribution_conflict_resolved`) → `⚠` on `#D55E00`,
  tooltip "Heads up — attributed to someone else in Quotewise".
- **FR-026**: `originator.found: false` from preflight, with no higher-priority quote-status state, → `@` on
  `#E69F00`, tooltip "Originator not in Quotewise — add them first". This state indicates capture is blocked
  because the Chrome extension cannot create originators yet.
- **FR-025**: A weak `match_type: similar` (≤ 0.8) MUST NOT raise an exact/similar badge. Under FR-040 this is
  enforced automatically — a sub-threshold match yields `recommendation: new_quote*`, mapping to **New**.

**Precedence**
- **FR-030**: When multiple states qualify, the system MUST render exactly one, resolved top-down:
  `Error (SESSION_EXPIRED / INSUFFICIENT_PRIVILEGES)` → `Logged-out (UNAUTHENTICATED)` →
  `Loading (supported current-tweet check)` → `Auth-pending (UNKNOWN / CHECKING / AUTHENTICATING)` →
  `Unsupported page` → `Supported idle` → one quote-status badge in the order
  `In-your-collection > Attribution-conflict > Exact > Similar > Missing-originator > New`.

**Data mapping**
- **FR-040**: Quote-status selection MUST resolve from `DuplicateCheckResult` in this order: **(1)** if **any**
  match has `in_user_collections: true` → **In your collection** (`✓`); **(2)** otherwise map the **top-level
  `recommendation`** (the authoritative backend verdict) to the badge in FR-030 order — `attribution_conflict` /
  `attribution_conflict_resolved` → **Conflict** (`⚠`); `duplicate` / `duplicate_known_author` → **Exact** (`=`);
  `new_version` / `new_version_known_author` → **Similar** (`~`); `new_quote` / `new_quote_known_author` → **New**
  (`★`). The extension MUST NOT re-derive the backend's similarity thresholds. `matches[].match_type`,
  `matches[].similarity`, and `existing_sightings_for_url[]` are retained for the tray, not for icon selection.
  This extends `src/utils/duplicate-status.ts`, which today reads only `sighting_status`.
- **FR-041**: When the duplicate check errors or returns nothing, the system MUST fall back to the ambient
  state and MUST NOT display a quote-status badge.
- **FR-042**: Missing-originator selection MUST resolve from preflight `originator.found === false`, not from
  duplicate recommendation data. It MUST NOT be raised for failed/errored preflight results. The resolver inserts
  Missing-originator after Exact/Similar/Conflict and before New.
- **FR-043**: When pre-action preload is enabled, automatic tweet preflight MUST NOT depend on opening the
  overlay/tray. When tweet data is temporarily unavailable during navigation/rendering, the system MUST make a
  short bounded attempt to resolve the current tweet before giving up. While combined preflight is still pending for
  the current tweet, the system MAY make one short delayed bounded handle-only originator probe so the toolbar can
  reach the same missing-originator state the tray would report before timeout. When combined preflight times out for
  the current tweet, the system MUST make one bounded handle-only originator fallback as a last-resort recovery. When
  pre-action preload is disabled, the system MUST NOT perform duplicate/originator network checks until explicit user
  engagement.
- **FR-044**: Overlay/tray originator status for the current tweet MUST feed the same toolbar state. If the
  overlay/tray determines the current tweet's originator is missing, the toolbar MUST set Missing-originator,
  clear Loading, and apply the tab-scoped `@` badge without waiting for a separate automatic preflight.
- **FR-045**: Tweet-to-tweet SPA navigation MUST bind quote/originator status to the current tweet. Results for a
  different tweet/status URL MUST NOT run duplicate/originator preflight for the current URL and MUST NOT apply the
  stale tweet's quote-status badge.
- **FR-046**: Overlay/tray originator lookup MUST drive toolbar Loading and final-state synchronization. A lookup
  in flight for the current tweet MUST show the tab-scoped Loading `●`; a fresh API, preloaded, or cached tray
  result MUST update the toolbar to the same final current-tweet state promptly. Timeout-driven automatic
  originator fallback MUST apply results through the same current-tweet originator state path.

**Accessibility**
- **FR-050**: Every artwork/badge change MUST be paired with a `setTitle` that is self-contained and meaningful
  out of context (the accessible label; badge text is an image and is not read by AT).
- **FR-051**: Every state MUST be distinguishable by **shape/glyph**, not color alone (WCAG 1.4.1); badge
  glyphs MUST be bold/filled to target ≥ 3:1 non-text contrast at 16px (WCAG 1.4.11). Colors are the
  color-blind-safe Okabe-Ito working set. The 3:1 target is a manual acceptance gate at real toolbar size.

**Art-asset pipeline**
- **FR-060**: The color and grey owl PNGs (`icon{16,32,48,128}.png`, `icon{16,32,48,128}-grey.png`) MUST be
  generated from a single vector master copied into the extension as `assets/owl.svg`.
- **FR-061**: The master MUST be `quotewise.svg` (the 5-path version with explicit eye/nose/feet and an open
  chest), recolored to `beige` and composited on a `#304f50` rounded square. The 2-path `quotewise-light.svg`
  MUST NOT be used (its silhouette drops the interior detail).
- **FR-062**: The grey variant MUST be the owl `#6b7280` on `#e5e7eb`. Rasterization MUST use a faithful,
  CI-portable renderer (`@resvg/resvg-js` or `sharp`); ImageMagick and `qlmanage` MUST NOT be used for the
  SVG→raster step.

**Consolidation & copy**
- **FR-070**: Toolbar state MUST have a single authoritative resolver. No two code paths may set conflicting
  badge/icon values for the same condition, and legacy duplicate presentation sources MUST be retired.
- **FR-071**: Tooltip copy MUST be centralized with the state table and use one voice ("Quotewise — …"); the
  manifest `action.default_title` "Capture Quote" MUST be changed to "Quotewise".

### State → glyph/color reference (canonical)

| State | Layer | Glyph | Color | API trigger |
|---|---|---|---|---|
| Ready | artwork | — (color owl) | — | `AUTHENTICATED` + supported tweet page |
| Supported idle | artwork | — (color owl) | — | `AUTHENTICATED` + supported X/Twitter page, no tweet in focus |
| Unsupported page | artwork | — (grey owl) | grey owl `#6b7280`/`#e5e7eb` | `AUTHENTICATED` + unsupported site |
| Auth pending | artwork | — (color owl) | — | `UNKNOWN` / `CHECKING` / `AUTHENTICATING` |
| Logged out | artwork | — (grey owl) | grey owl `#6b7280`/`#e5e7eb` | `UNAUTHENTICATED` |
| Loading | badge | `●` (static) | `#56B4E9` | check in flight |
| Error | badge | `!` | `#D55E00` | `SESSION_EXPIRED` / `INSUFFICIENT_PRIVILEGES` |
| In your collection | badge | `✓` | `#009E73` | any match `in_user_collections: true` |
| Attribution conflict | badge | `⚠` | `#D55E00` | rec. `attribution_conflict*` (mt. `*_different_originator`) |
| Exact dup exists | badge | `=` | `#009E73` | rec. `duplicate*` (mt. `exact_url`/`exact_same_originator`) |
| Similar version | badge | `~` | `#E69F00` | rec. `new_version*` (mt. `near_same_originator`) |
| Missing originator | badge | `@` | `#E69F00` | preflight `originator.found: false` |
| New | badge | `★` | `#0072B2` | rec. `new_quote*` |

## Success Criteria

- **SC-001**: Unavailable states are visible at a glance — the toolbar owl is greyed when `UNAUTHENTICATED` or
  when the user is authenticated on an unsupported site, and full-color on supported X/Twitter surfaces where
  capture can be opened or performed.
- **SC-002**: A new/capturable tweet, an already-collected tweet, an exact duplicate, a similar version, a
  missing-originator blocker, and an attribution conflict each present a **distinct** icon state (distinct glyph,
  semantic color group, and tooltip; exact and in-collection may share green because both are safe/no-action
  states), verified at 16px.
- **SC-003**: When several conditions hold, exactly one state shows, matching FR-030 precedence (e.g. session
  expired wins over a duplicate badge).
- **SC-004**: Every state is decodable under simulated deuteranopia/protanopia/achromatopsia and exposes a
  correct accessible label via the tooltip.
- **SC-005**: There is a single state resolver; no two code paths set conflicting badge/icon values for the
  same condition.
- **SC-006**: The exact-vs-similar badges are legible and not confusable at real 16px (`=` green vs `~`
  orange).
- **SC-007**: The icon never shows a quote-status badge on a non-tweet page or after a failed duplicate check.
- **SC-008**: An authenticated user on an unsupported site sees grey/no badge with "capture works on X/Twitter
  tweets"; an authenticated user on X/Twitter without a tweet in focus sees full-color/no badge with "open a tweet
  to capture".

## Implementation

Implementation details are intentionally non-normative in this specification. The current implementation plan,
message-flow decisions, state model, and executable work breakdown live in:

- [plan.md](./plan.md) — architecture, file ownership, Chrome/MV3 constraints, and constitution gates.
- [research.md](./research.md) — implementation decisions and alternatives considered.
- [data-model.md](./data-model.md) — resolver inputs, state table, precedence, and lifecycle model.
- [contracts/](./contracts/) — internal resolver/applicator/message contracts.
- [tasks.md](./tasks.md) — dependency-ordered implementation and regression tasks.

## Assumptions

- The Quotewise API continues to return `match_type`, `in_user_collections`, `recommendation`, and
  `existing_sightings_for_url` from `check_duplicate` (backend contract; see Spec 002 for `sighting_status`).
- The toolbar renders the action icon at 16px (32px on HiDPI); the badge holds a single glyph.
- The extension adopts the brand owl as its mascot (resolved — see Decisions).
- Current capture support is X/Twitter only. Future social-platform or general web capture should extend the
  supported-platform detection and reuse the same Unsupported/Supported-idle ambient model.

## Dependencies

- Quotewise API: `check_duplicate` (duplicate/originator data), auth/session status.
- Brand vector `quotewise.svg` (currently in the backend `static/logos/`) to be vendored as `assets/owl.svg`.
- A CI-friendly SVG rasterizer dev dependency (`@resvg/resvg-js` or `sharp`).

## Out of Scope

- **Dropdown tray** — `similarity` %, exact-URL vs same-text, same-vs-other-platform sightings, the conflicting
  originator, and **excerpt/subset** matches. Separate spec; the icon defers detail to it.
- **Excerpt/subset detection** — not a first-class `check_duplicate` signal today (similarity-threshold only;
  substring logic in `text_match.py` is unexposed). Needs backend (`django-api`) work.
- **Auth state machine internals** — only the *presentation* of auth states changes here, not the FSM.
- **Overlay-bar badges** — owned by Spec 002.
- **Non-X/Twitter capture** — future social platforms and general web capture are not included here; unsupported
  sites only receive the grey unavailable toolbar state.

## Clarifications

### Session 2026-06-02 → 2026-06-04
- Q: Which rendering system? → A: **System B (artwork-driven)** — ambient owl artwork + quote-status badge.
- Q: How granular should the duplicate signal be on the icon? → A: **3-way split** — exact / similar / conflict
  (finer platform/similarity detail goes to the tray).
- Q: Glyphs for exact vs similar (legibility at 16px)? → A: **`=` green / `~` orange** — shape differs, and
  color follows the semantic scale: exact is safe/no action, similar requires review/caution.
- Q: Similar color? → A: **`#E69F00`** (Okabe-Ito orange-yellow caution).
- Q: Exact color? → A: **`#009E73`** (Okabe-Ito green), shared with "in collection" because both communicate
  safe/no duplicate action; the glyph and tooltip distinguish the states.
- Q: Error treatment — ring or badge? → A: **Badge `!` only, no ring** (no extra asset; crisp at 16px).
- Q: Conflict and Error share vermillion — acceptable? → A: **Yes** (shape + layer distinguish them).
- Q: Art source — keep raster or adopt the vector? → A: **Adopt the brand owl**, render color + grey from one
  vector master.
- Q: Which vector master? → A: **`quotewise.svg`** (5-path, full interior detail); **not** `quotewise-light.svg`.

### Session 2026-06-04

- Q: Loading indicator — animate the badge, or keep it static given MV3 service-worker termination? → A: **Static** single sky `●`, set once at check start and cleared/replaced on completion; **no animation**. Researched real extensions: the dominant MV3 pattern is a static `'...'`/dot (e.g. `robertknight/ocrs`, `remorses/playwriter`, `crimx/ext-saladict`); animated badge/icon loops are MV2-only and discouraged by Chrome (`setIcon` is for static images), and die with the worker.
- Q: Does the badge derive from per-match `matches[]` or the top-level `recommendation`? → A: **Hybrid (Option A):** show `✓` if any match has `in_user_collections: true`; otherwise map the authoritative top-level `recommendation` in FR-030 order (`attribution_conflict*`→`⚠`, `duplicate*`→`=`, `new_version*`→`~`, `new_quote*`→`★`). The extension does **not** re-derive backend similarity thresholds; `match_type`/`similarity` are retained for the tray (FR-040).

### Session 2026-06-06

- Q: What should the toolbar show when the tweet originator is absent from Quotewise? → A: **Orange `@`** —
  capture is blocked because the extension cannot create originators yet; it is not a new/capturable quote.
- Q: Should tray-originator knowledge affect the toolbar? → A: **Yes, for the current tweet only.** The toolbar
  and overlay/tray must synchronize Loading and final originator state, including fresh cached/preloaded tray
  results.
- Q: How should parent-to-reply SPA transitions behave? → A: **Bind status to the current tweet.** Parent/head
  tweet quote status must not leak onto a reply URL while X is still rendering.
- Q: How does automatic preflight interact with the privacy constitution? → A: **Preflight is governed by the
  pre-action preload setting.** If disabled, duplicate/originator network checks wait for explicit user engagement.
  The early handle-only probe stays inside this boundary and sends only the public handle/platform/source URL.
- Q: What should authenticated users see on sites where capture is not supported? → A: **Grey unavailable owl,
  no badge.** Logged-out and unsupported are both "not usable now" artwork states, distinguished by tooltip:
  "log in to capture quotes" vs. "capture works on X/Twitter tweets." X/Twitter without a tweet in focus remains
  full-color with "open a tweet to capture."

### Decisions
- **Two-layer model (System B)** — the artwork carries the ambient "is this active / is anything wrong?" signal
  (fixing today's invisible logged-out state via `setIcon`); the badge carries quote status. Chosen over
  badge-only (A) and composited-emblem (C).
- **Three-way duplicate split** — surfaces granularity the API already returns (`match_type`), capped per
  NN/g's ~5–7 decodable-state guidance; same-vs-other-platform and `similarity` % are tray detail.
- **Brand-owl adoption** — the extension owl and the website owl were different renditions; the extension adopts
  the brand owl (`quotewise.svg`) so a single vector drives all variants. The 2-path `quotewise-light.svg` is a
  degraded silhouette and is explicitly rejected.
- **Single resolver** — eliminates the three conflicting badge-config sources (the root cause of today's
  nondeterministic appearance).

## Version History

- **2026-06-04 — initial.** Authored from the approved design (`docs/superpowers/specs/2026-06-02-extension-icon-states-design.md`)
  and the brainstorming session (System B, 3-way duplicate split, V4 glyphs, brand-owl pipeline). Tracked by
  qw-eg3c. No implementation yet.
- **2026-06-06 — badge/tray sync refresh.** Captured missing-originator, tray/toolbar synchronization,
  stale parent-to-reply rejection, and preload-setting constraints as product requirements; moved worker/message/cache
  details to plan/research/data-model/contracts.
- **2026-06-06 — platform availability refresh.** Added grey unsupported-site state and supported-idle full-color
  state for authenticated users, scoped to current X/Twitter-only capture support.
