# Feature Specification: Extension Toolbar Icon States

**Created**: 2026-06-04
**Status**: Designed (pre-implementation)
**Last Updated**: 2026-06-04 — Authored from the approved icon-state design (`docs/superpowers/specs/2026-06-02-extension-icon-states-design.md`); tracked by qw-eg3c

## Overview

The toolbar **action icon** is the extension's only at-a-glance signal. This spec is the canonical,
implementation-driving contract for what that icon MUST communicate and how. It defines a **two-layer model** —
an **ambient artwork layer** (the owl, swapped via `chrome.action.setIcon`) that answers *"can I act here, and is
anything wrong?"*, and a **quote-status badge layer** (`setBadgeText` + `setBadgeBackgroundColor`) that answers
*"what is the status of this quote?"* — plus the precedence between them, the API data each state derives from,
the tooltip (accessible label) copy, and the art-asset pipeline.

The design rationale, sourcing (Chrome `chrome.action` + WCAG), and the full decision history live in the
companion design doc; this spec memorializes the **user stories** and **functional requirements**.

**Scope boundary.** This spec covers the **toolbar icon only**. The in-page **overlay bar** badges are
[Spec 002 — Sighting Status UI](../002-sighting-status-ui/spec.md); the future **dropdown tray** (which carries
the detail the icon cannot — `similarity` %, platform sightings, conflicting originator, excerpt matches) is a
separate spec. Where 002 uses the coarser `sighting_status`, the icon uses the richer `match_type` (§ Background).

## Background

- **Today's gaps (motivation).** `AUTHENTICATED` and `UNAUTHENTICATED` render identically (both set empty badge
  text, so neither color shows — only the tooltip differs); three config sources disagree on the same state
  (`auth-state-machine.ts`, `auth-monitor.ts`, `service-worker.ts`); color is overloaded (green = new *and*
  collected; orange = exists *and* insufficient-priv *and* sighting variants); the duplicate signal collapses
  exact/similar/conflict into one `+`; and `setIcon` is never called (artwork is constant).
- **API data already available.** `/v1/quotes/check_duplicate/` → `DuplicateCheckResult` returns, per match:
  `match_type ∈ {exact_url, exact_same_originator, exact_different_originator, near_same_originator,
  near_different_originator, similar}`, a `similarity` (0–100), `in_user_collections`, plus a top-level
  `recommendation` and `existing_sightings_for_url[]` (confirmed in `quotewise/services/quotes/service.py`).
  Every icon state below maps to this existing data — **no backend change**.
- **Platform constraints (verified).** Badge text fits "only about four" characters; `setBadgeTextColor`
  auto-contrasts if unset (do not override); `setIcon` swaps artwork per-tab (PNG only — **SVG unsupported**);
  `setTitle` is the hover tooltip **and** the screen-reader accessible label; tab-scoped settings beat global.

## User Scenarios & Testing

### User Story 1 - Tell at a glance whether I'm signed in (P1)

A user glances at the toolbar to know whether the extension is usable on this page.

**Why this priority**: Today logged-out is invisible (tooltip-only); users click a dead extension and get
confused. This is the most common ambiguity.

**Acceptance**:
- **When** auth state is `UNAUTHENTICATED`, the system **MUST** swap the artwork to the **greyed owl** (visible
  at a glance, no badge) and set the tooltip "Quotewise — log in to capture quotes".
- **When** auth state is `AUTHENTICATED`, the artwork **MUST** be the full-color owl.
- The greyed and full-color states **MUST** be distinguishable by the artwork alone, not by tooltip alone.

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
  collection, the badge **MUST** show `=` on `#E69F00` (orange), tooltip "Exact match already in Quotewise".
- **When** the best match is `near_same_originator` (0.8 < similarity < 1.0), the badge **MUST** show `~` on
  `#CC79A7` (purple), tooltip "Similar version already in Quotewise (NN% match)".
- Exact and similar **MUST** be distinguishable by **both** shape (`=` vs `~`) and color (orange vs purple).

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
- **While** a duplicate/preflight check is in flight, the badge **MUST** show a pulsing `●` on `#56B4E9`
  (sky), tooltip "Quotewise — checking this quote…". The animation **MUST** respect `prefers-reduced-motion`
  (static dot fallback).
- **When** auth state is `SESSION_EXPIRED` or `INSUFFICIENT_PRIVILEGES`, the badge **MUST** show `!` on
  `#D55E00` (vermillion) with an actionable tooltip; there **MUST NOT** be a ring around the artwork.

### Edge Cases

- **Multiple conditions true at once** (e.g. session expired *and* on a known-duplicate tweet): resolve by the
  precedence in FR-030 — the user sees exactly one state.
- **Non-tweet / non-actionable page**: no quote-status badge; the icon shows the ambient state only (Ready or
  Logged-out), tooltip "Quotewise".
- **Duplicate check fails / `search_metadata.error`**: treat as no quote-status (fall back to ambient Ready);
  never show a misleading collection badge on an errored check.
- **`match_type: similar`** (≤ 0.8, weak): below the duplicate threshold — **MUST NOT** raise an exact/similar
  badge; treated as New for icon purposes (detail, if any, belongs in the tray).
- **Tab switching**: quote-status badges are tab-scoped; switching to a non-tweet tab **MUST NOT** leak the
  prior tab's badge.

## Requirements

### Functional Requirements

**Two-layer rendering model**
- **FR-001**: Icon state MUST be expressed on two layers: an **ambient artwork** layer (`chrome.action.setIcon`)
  and a **quote-status badge** layer (`setBadgeText` + `setBadgeBackgroundColor`), composed per the precedence
  in FR-030.
- **FR-002**: Quote-status badges MUST be applied **per-tab** (`tabId`); ambient/auth states MAY be global, and
  MUST be cleared on non-tweet pages so a stale badge never persists.
- **FR-003**: The system MUST NOT call `setBadgeTextColor` (let Chrome auto-contrast the badge text).

**Ambient artwork layer**
- **FR-010**: `AUTHENTICATED` (and no quote in focus) MUST render the **full-color owl**, no badge, tooltip
  "Quotewise — ready to capture".
- **FR-011**: `UNAUTHENTICATED` MUST swap to the **greyed owl** (`icon{n}-grey.png`) via `setIcon`, no badge,
  tooltip "Quotewise — log in to capture quotes".
- **FR-012**: `SESSION_EXPIRED` / `INSUFFICIENT_PRIVILEGES` MUST show the badge `!` on `#D55E00` on the
  full-color owl (no ring), with an actionable tooltip ("…session expired, log in again" /
  "…additional permissions required").
- **FR-013**: While a duplicate/preflight check is pending, MUST show a pulsing `●` on `#56B4E9`; the animation
  MUST honor `prefers-reduced-motion`.

**Quote-status badge layer** (rendered on the full-color owl)
- **FR-020**: `recommendation: new_quote` (no matches) → `★` on `#0072B2`, tooltip "New quote — not in
  Quotewise yet".
- **FR-021**: any match with `in_user_collections: true` → `✓` on `#009E73`, tooltip "Already in your
  collection".
- **FR-022**: `exact_url` or `exact_same_originator` (sim = 1.0), not in collection → `=` on `#E69F00`, tooltip
  "Exact match already in Quotewise".
- **FR-023**: `near_same_originator` (0.8 < sim < 1.0) → `~` on `#CC79A7`, tooltip "Similar version already in
  Quotewise (NN% match)".
- **FR-024**: `exact_different_originator` / `near_different_originator` (`recommendation: attribution_conflict`)
  → `⚠` on `#D55E00`, tooltip "Heads up — attributed to someone else in Quotewise".
- **FR-025**: `match_type: similar` (≤ 0.8) MUST NOT raise an exact/similar badge (treated as New for the icon).

**Precedence**
- **FR-030**: When multiple states qualify, the system MUST render exactly one, resolved top-down:
  `Error (SESSION_EXPIRED / INSUFFICIENT_PRIVILEGES)` → `Logged-out (UNAUTHENTICATED)` → `Loading` →
  one quote-status badge in the order `In-your-collection > Attribution-conflict > Exact > Similar > New`.

**Data mapping**
- **FR-040**: Quote-status selection MUST derive from `DuplicateCheckResult` — `matches[].match_type`,
  `matches[].in_user_collections`, `recommendation`, and `existing_sightings_for_url[]` — extending
  `src/utils/duplicate-status.ts`, which today reads only `sighting_status`.
- **FR-041**: When the duplicate check errors or returns nothing, the system MUST fall back to the ambient
  state and MUST NOT display a quote-status badge.

**Accessibility**
- **FR-050**: Every artwork/badge change MUST be paired with a `setTitle` that is self-contained and meaningful
  out of context (the accessible label; badge text is an image and is not read by AT).
- **FR-051**: Every state MUST be distinguishable by **shape/glyph**, not color alone (WCAG 1.4.1); badge
  glyphs MUST be bold/filled to target ≥ 3:1 non-text contrast at 16px (WCAG 1.4.11). Colors are the
  color-blind-safe Okabe-Ito working set.

**Art-asset pipeline**
- **FR-060**: The color and grey owl PNGs (`icon{16,32,48,128}.png`, `icon{16,32,48,128}-grey.png`) MUST be
  generated from a single vector master copied into the extension as `assets/owl.svg`.
- **FR-061**: The master MUST be `quotewise.svg` (the 5-path version with explicit eye/nose/feet and an open
  chest), recolored to `beige` and composited on a `#304f50` rounded square. The 2-path `quotewise-light.svg`
  MUST NOT be used (its silhouette drops the interior detail).
- **FR-062**: The grey variant MUST be the owl `#dcdcdc` on `#6f6f6f`. Rasterization MUST use a faithful,
  CI-portable renderer (`@resvg/resvg-js` or `sharp`); ImageMagick and `qlmanage` MUST NOT be used for the
  SVG→raster step.

**Consolidation & copy**
- **FR-070**: The three current badge/icon config sources (`auth-state-machine.ts` presentation,
  `auth-monitor.ts getBadgeConfig`, `service-worker.ts getCollectionBadgeConfig`) MUST be consolidated into a
  single resolver that owns FR-010..FR-030. The duplicate `auth-monitor.getBadgeConfig` MUST be removed.
- **FR-071**: Tooltip copy MUST be centralized with the state table and use one voice ("Quotewise — …"); the
  manifest `action.default_title` "Capture Quote" MUST be changed to "Quotewise".

### State → glyph/color reference (canonical)

| State | Layer | Glyph | Color | API trigger |
|---|---|---|---|---|
| Ready | artwork | — (color owl) | — | `AUTHENTICATED` |
| Logged out | artwork | — (grey owl) | grey owl `#dcdcdc`/`#6f6f6f` | `UNAUTHENTICATED` |
| Loading | badge | `●` (pulse) | `#56B4E9` | check in flight |
| Error | badge | `!` | `#D55E00` | `SESSION_EXPIRED` / `INSUFFICIENT_PRIVILEGES` |
| New | badge | `★` | `#0072B2` | `new_quote` |
| In your collection | badge | `✓` | `#009E73` | `in_user_collections: true` |
| Exact dup exists | badge | `=` | `#E69F00` | `exact_url` / `exact_same_originator` |
| Similar version | badge | `~` | `#CC79A7` | `near_same_originator` |
| Attribution conflict | badge | `⚠` | `#D55E00` | `*_different_originator` |

## Success Criteria

- **SC-001**: Logged-out is visible at a glance — the toolbar owl is greyed when `UNAUTHENTICATED` and
  full-color when `AUTHENTICATED`, without relying on the tooltip.
- **SC-002**: A new/capturable tweet, an already-collected tweet, an exact duplicate, a similar version, and an
  attribution conflict each present a **distinct** icon state (distinct glyph **and** color), verified at 16px.
- **SC-003**: When several conditions hold, exactly one state shows, matching FR-030 precedence (e.g. session
  expired wins over a duplicate badge).
- **SC-004**: Every state is decodable under simulated deuteranopia/protanopia/achromatopsia and exposes a
  correct accessible label via the tooltip.
- **SC-005**: There is a single state resolver; no two code paths set conflicting badge/icon values for the
  same condition.
- **SC-006**: The exact-vs-similar badges are legible and not confusable at real 16px (`=` orange vs `~`
  purple).
- **SC-007**: The icon never shows a quote-status badge on a non-tweet page or after a failed duplicate check.

## Implementation

- **State resolver (new/consolidated)**: a single module computing `(iconPath, badgeText, badgeColor, title)`
  from `(AuthState, DuplicateCheckResult | null, tabContext)`; replaces the presentation halves of
  `src/auth/auth-state-machine.ts`, `src/background/auth-monitor.ts` (`getBadgeConfig`), and
  `src/background/service-worker.ts` (`getCollectionBadgeConfig` / `updateCollectionBadgeForTweet` /
  `updateExtensionIconForTweetPage`).
- **Duplicate mapping**: extend `src/utils/duplicate-status.ts` to read `match_type` + `in_user_collections`
  (today: `sighting_status` only); types in `src/types/api.ts` (`DuplicateCheckResult`).
- **Icon swap**: `chrome.action.setIcon({ tabId, path: { 16: 'icons/icon16-grey.png', … } })` for logged-out;
  back to color otherwise.
- **Assets/build**: `assets/owl.svg` (from `quotewise.svg`) + a rasterize script (resvg/sharp) emitting the
  color and `-grey` PNG sets into `public/icons/`; manifest `default_title` update.
- **Tests**: resolver truth-table over `AuthState × DuplicateCheckResult` incl. precedence ties; duplicate-status
  mapping per `match_type`; asset snapshot (grey is desaturated, dimensions correct).

## Assumptions

- The Quotewise API continues to return `match_type`, `in_user_collections`, `recommendation`, and
  `existing_sightings_for_url` from `check_duplicate` (backend contract; see Spec 002 for `sighting_status`).
- The toolbar renders the action icon at 16px (32px on HiDPI); the badge holds a single glyph.
- The extension adopts the brand owl as its mascot (resolved — see Decisions).

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

## Clarifications

### Session 2026-06-02 → 2026-06-04
- Q: Which rendering system? → A: **System B (artwork-driven)** — ambient owl artwork + quote-status badge.
- Q: How granular should the duplicate signal be on the icon? → A: **3-way split** — exact / similar / conflict
  (finer platform/similarity detail goes to the tray).
- Q: Glyphs for exact vs similar (legibility at 16px)? → A: **`=` orange / `~` purple** (V4) — shape *and*
  color both differ; plain `=`/`≈` was rejected as confusable.
- Q: Similar color? → A: **`#CC79A7`** (Okabe-Ito, color-blind-safe).
- Q: Error treatment — ring or badge? → A: **Badge `!` only, no ring** (no extra asset; crisp at 16px).
- Q: Conflict and Error share vermillion — acceptable? → A: **Yes** (shape + layer distinguish them).
- Q: Art source — keep raster or adopt the vector? → A: **Adopt the brand owl**, render color + grey from one
  vector master.
- Q: Which vector master? → A: **`quotewise.svg`** (5-path, full interior detail); **not** `quotewise-light.svg`.

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
