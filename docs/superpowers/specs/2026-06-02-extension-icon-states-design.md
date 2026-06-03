# Chrome Extension Toolbar Icon — State Design

- **Date:** 2026-06-02
- **Status:** Approved design (pre-implementation)
- **Beads:** qw-eg3c
- **Surface:** `chrome-ext`
- **Scope:** The toolbar **action icon** (artwork + badge + tooltip). The dropdown/overlay **tray** is referenced but specified separately (see [Out of scope](#out-of-scope--follow-ons)).

---

## 1. Problem

The toolbar icon is the extension's only at-a-glance signal, and today it under-communicates and contradicts itself:

1. **`AUTHENTICATED` and `UNAUTHENTICATED` look identical.** Both set empty badge text, so their colors never render — only the hover tooltip differs. The "logged out" state is effectively invisible (the icon is never greyed, despite code comments claiming otherwise).
2. **Three competing badge-config sources disagree** on the same state (e.g. authenticated = green `#4CAF50` in `auth-state-machine.ts` vs blue `#1a73e8` in `auth-monitor.ts`; checking = `...` grey vs `…` blue). Whichever writes last wins → nondeterministic appearance.
3. **Color is overloaded.** Green = both `★ new` and `✓ collected`; orange = `+ exists`, `? insufficient-priv`, and the duplicate-sighting variants. The glyph carries all meaning; color adds little and sometimes misleads.
4. **The duplicate signal is coarse.** The icon collapses "exact duplicate", "similar version", and "attributed to someone else" into one `+`, even though the API distinguishes them.
5. **`setIcon` is never used.** The PNG artwork is constant; all state lives in the tiny badge overlay, which screen readers don't read.

## 2. Goals & non-goals

**Goals:** one source of truth for icon state; a glanceable, shape-distinct, color-blind-safe, accessible state set; surface the duplicate granularity the API already returns; make "logged out" visible.

**Non-goals:** the dropdown tray's contents; backend changes; excerpt/subset detection; reworking the auth state machine itself (only its badge presentation).

## 3. Design principles (sourced)

Verified against live docs this session:

- **Chrome `chrome.action`** ([ref](https://developer.chrome.com/docs/extensions/reference/api/action)): badge fits "only about four" characters and is meant for brief status/counters; `setBadgeTextColor` (Chrome 110+) auto-contrasts if unset (don't override); **`setIcon` can swap the artwork per-tab** (PNG dict or `ImageData`; **SVG unsupported**); `setTitle` is the hover tooltip **and** the screen-reader accessible label; tab-scoped settings take priority over global.
- **WCAG 1.4.1 Use of Color (Level A):** color must not be the *only* means of distinguishing states → every state pairs a **distinct glyph/shape** with its color.
- **WCAG 1.4.11 Non-text Contrast (Level AA):** each badge element needs **≥ 3:1** against adjacent color; thin strokes wash out at small size → prefer bold/filled glyphs.

Established references (not live-fetched): NN/g status-color conventions (red=error, amber=attention, green=done, blue=in-progress, grey=inactive) and the ~5–7 reliably-decodable state ceiling; **Okabe-Ito** color-blind-safe palette for the working colors (avoid raw red/green pairing).

## 4. The two-layer model (System B)

State is expressed on two independent layers:

- **Ambient layer — the owl artwork** (`chrome.action.setIcon`): answers "can I act here, and is anything wrong?" Independent of any specific quote.
- **Quote-status layer — the badge** (`setBadgeText` + `setBadgeBackgroundColor`): answers "what's the status of *this* quote?" Rendered on the full-color owl.

Both are tab-scoped where a quote is in play; auth/ambient states fall back to global.

### 4.1 Ambient layer

| State | Treatment | Trigger (`AuthState`) | Tooltip (`setTitle`) |
|---|---|---|---|
| Ready | full-color owl, no badge | `AUTHENTICATED` | "Quotewise — ready to capture" |
| Loading | full-color owl + pulsing sky dot `●` `#56B4E9` | checking quote status | "Quotewise — checking this quote…" |
| Logged out | **greyed owl**, no badge | `UNAUTHENTICATED` | "Quotewise — log in to capture quotes" |
| Error | full-color owl + red `!` badge `#D55E00` (**no ring**) | `SESSION_EXPIRED` / `INSUFFICIENT_PRIVILEGES` | "Quotewise — session expired, log in again" |

Loading dot animation must respect `prefers-reduced-motion` (fall back to a static dot).

### 4.2 Quote-status layer

| State | Glyph · color | API trigger |
|---|---|---|
| New | `★` blue `#0072B2` | `recommendation: new_quote` (no matches) |
| In your collection | `✓` green `#009E73` | any match with `in_user_collections: true` |
| Exact dup exists | `=` orange `#E69F00` | `match_type: exact_url` or `exact_same_originator` (sim = 1.0) |
| Similar version exists | `~` purple `#CC79A7` | `match_type: near_same_originator` (0.8 < sim < 1.0) |
| Attribution conflict | `⚠` vermillion `#D55E00` | `match_type: *_different_originator` → `recommendation: attribution_conflict` |

Glyph choice (`=` / `~`) was validated at real 16px; the two share neither shape nor color (purple vs orange) to satisfy WCAG 1.4.1 at small size. `⚠` shares vermillion with the Error `!` — accepted, because shape (triangle vs bang) and layer (quote badge vs ambient error) distinguish them.

### 4.3 Precedence

When multiple conditions are true, resolve top-down:

```
Error (SESSION_EXPIRED / INSUFFICIENT_PRIVILEGES)
  → Logged-out (UNAUTHENTICATED)
    → Loading (resolving)
      → exactly one quote-status badge:
         In-your-collection > Attribution-conflict > Exact > Similar > New
```

Rationale: a collected quote is the most reassuring fact ("you already have it"); a conflict is the most action-worthy; exact before similar; new is the default.

## 5. API support (confirmed)

Traced to `quotewise/services/quotes/service.py` (`_classify_match`, `_generate_recommendation`). `/v1/quotes/check_duplicate/` → `DuplicateCheckResult` returns, per match: `match_type ∈ {exact_url, exact_same_originator, exact_different_originator, near_same_originator, near_different_originator, similar}`, a `similarity` (0–100), `in_user_collections`, plus a top-level `recommendation` and `existing_sightings_for_url[]`.

Therefore **every icon state above maps to data we already receive** — no backend work. The extension currently throws most of it away: `src/utils/duplicate-status.ts` reads only `sighting_status`, ignoring `match_type`, `in_user_collections`, and originator identity. Wiring those in is the core change.

**Excerpt/subset matches** (a saved quote that is a substring of this tweet, or vice-versa) are **not** a first-class API signal — the classifier is similarity-threshold only; substring logic in `text_match.py` is not exposed by `check_duplicate`. Excerpt handling is **tray-only** and would need backend support to be reliable. Out of scope here.

## 6. Art pipeline

The extension repo has only raster PNGs (no vector). The backend's `static/logos/` holds the source vectors. **Decision: adopt the brand owl as the extension mascot** (aligns extension with website) and render all variants from one vector.

- **Master:** `quotewise.svg` — the **5-path** version with explicit eye/nose/feet shapes and an open chest. **Do NOT use `quotewise-light.svg`** — its 2-path silhouette flat-fills the face and drops the eyes/nose at render time (verified).
- **Build:** copy master into the extension as `assets/owl.svg`; recolor fill → `beige`; composite centered (~78%) on a `#304f50` rounded square (corner radius ≈ 19%). Emit per size {16, 32, 48, 128}:
  - `icon{n}.png` — color (active base for Ready/Loading/Error and all quote badges)
  - `icon{n}-grey.png` — logged-out, owl `#dcdcdc` on `#6f6f6f`
- **Renderer:** use a faithful, CI-portable SVG rasterizer — **`@resvg/resvg-js`** or **`sharp`** (a dev dependency + a small build script). **Do not** use ImageMagick (poor SVG fidelity) or `qlmanage` (forces a white background; not portable).
- **Only one new artwork asset** is needed beyond today: the greyed owl. Error is badge-only (no ring), so no ring asset.

## 7. Accessibility

- Every `setIcon`/badge change is paired with a self-contained `setTitle` (the accessible label; badge text is an image and is not read). Titles must make sense out of context, e.g. "Quotewise — session expired, log in again".
- Glyph + color redundancy satisfies WCAG 1.4.1; bold/filled glyphs and the chosen palette target WCAG 1.4.11 (≥ 3:1). Validate all badge colors against the toolbar with a contrast checker during implementation.
- Loading animation respects `prefers-reduced-motion`.
- Verify the full set under Chrome DevTools "Emulate vision deficiencies" (deuteranopia, protanopia, achromatopsia).

## 8. Implementation notes

1. **Consolidate to one badge/icon authority.** Today: `auth-state-machine.ts` (`getStateBadgeText/Color/Message`, used by `auth-state-manager.updateBadge`), `auth-monitor.ts` (`getBadgeConfig`), and `service-worker.ts` (`updateCollectionBadgeForTweet` / `getCollectionBadgeConfig`). Collapse into a single module that owns the precedence table and the ambient↔badge composition. Remove the duplicate `auth-monitor.getBadgeConfig` source.
2. **Wire `match_type` + `in_user_collections`** into `src/utils/duplicate-status.ts` (extend beyond `sighting_status`) and map to the five quote-status states.
3. **Add the greyed icon swap.** `chrome.action.setIcon({ tabId, path: { 16: 'icons/icon16-grey.png', … } })` for `UNAUTHENTICATED`; swap back to color otherwise.
4. **Keep tab-scoping** for quote states; global for ambient/auth, as today.
5. **Tooltip copy** centralized alongside the state table (single voice; replace the manifest `default_title` "Capture Quote" with "Quotewise").

## 9. Out of scope / follow-ons

- **Dropdown tray** — surfaces the detail the icon can't: `similarity` %, exact-URL vs same-text, same-vs-other-platform sightings, the conflicting originator, and **excerpt/subset** matches. Separate spec.
- **Excerpt/subset detection** — needs backend (`django-api`) work to expose containment from `check_duplicate`.
- The extension-vs-website **branding alignment** is *resolved* by §6 (adopting the brand owl).

## 10. Decisions log

| # | Decision | Resolution |
|---|---|---|
| 1 | Which system | **B — artwork-driven** (ambient artwork + quote badge) |
| 2 | Duplicate granularity on icon | **3-way split:** exact / similar / conflict |
| 3 | Exact/similar glyphs | **`=` (orange) / `~` (purple)** — V4; shape + color both differ |
| 4 | Similar color | **`#CC79A7`** (Okabe-Ito, CVD-safe) |
| 5 | Conflict vs Error sharing vermillion | **Accepted** (shape + layer distinguish) |
| 6 | Error treatment | **E2 — badge `!` only, no ring** (no extra asset, crisp at 16px) |
| 7 | Art source | **Adopt brand owl**, render color + grey from one vector |
| 8 | Vector master | **`quotewise.svg`** (5-path); not `quotewise-light.svg` |

## 11. Testing

- Unit: badge/icon resolver returns the correct (icon, badgeText, badgeColor, title) for every `(AuthState × DuplicateCheckResult)` combination, including precedence ties.
- Unit: `classifyDuplicateSighting`/successor maps each `match_type` + `in_user_collections` to the right quote-status state.
- Manual: load unpacked; walk a tweet through new → submit → revisit (collected) → a known-duplicate tweet (exact) → a paraphrase (similar) → a misattributed quote (conflict); log out (grey); expire session (error). Verify at 1× and 2× display.
- Asset: snapshot the generated `icon*.png` / `icon*-grey.png`; assert the greyed set is desaturated and dimensions match.
