# Phase 1 Data Model: Extension Toolbar Icon States

**Feature**: `004-extension-icon-states` | **Date**: 2026-06-06

This feature has **no persisted entities** — it computes a presentation from existing inputs. The
"data model" is therefore the **state space**: the input types, the two derived state enums, the
resolved output value object, and the deterministic mapping/precedence rules (the resolver's truth
table). All of it is pure and lives in `src/` TypeScript; nothing is stored.

---

## 1. Inputs (existing types — reference only)

| Input | Source | Shape (relevant fields) |
|---|---|---|
| `AuthState` | `src/auth/auth-state-machine.ts` | enum: `UNKNOWN, CHECKING, AUTHENTICATED, UNAUTHENTICATED, SESSION_EXPIRED, AUTHENTICATING, INSUFFICIENT_PRIVILEGES` |
| `DuplicateCheckResult \| null` | `src/types/api.ts` | `recommendation` (8 values), `matches[].{match_type, in_user_collections, similarity}`, `existing_sightings_for_url[]`, `search_metadata.error?` |
| `TabContext` | **new, derived in worker** | `{ tabId: number; isSupportedPlatform: boolean; isTweetPage: boolean; isCheckInFlight: boolean; isOriginatorMissing?: boolean; currentTweetStatusId?: string; currentTweetUrl?: string }` |

`recommendation ∈ { new_quote, new_version, duplicate, attribution_conflict,
new_quote_known_author, duplicate_known_author, new_version_known_author, attribution_conflict_resolved }`

`match_type ∈ { exact_url, exact_same_originator, exact_different_originator, near_same_originator,
near_different_originator, similar }` (retained for the tray, **not** used for icon selection — D5).

---

## 2. Derived state enums (new)

### 2.1 `AmbientState` — non-quote-status system states
```
Ready           // AUTHENTICATED, supported tweet page, no higher-priority state → full-color owl
SupportedIdle   // AUTHENTICATED, supported X/Twitter page, no tweet in focus → full-color owl
UnsupportedPage // AUTHENTICATED, unsupported site → greyed owl
AuthPending     // UNKNOWN | CHECKING | AUTHENTICATING → full-color owl, no badge, neutral title
LoggedOut       // UNAUTHENTICATED → greyed owl
Loading         // a duplicate/preflight check is in flight → color owl + static ● badge
Error           // SESSION_EXPIRED | INSUFFICIENT_PRIVILEGES → color owl + ! badge
```
*Note*: `UNKNOWN`/`CHECKING`/`AUTHENTICATING` are transitional. They use the same color artwork as
Ready but the neutral title "Quotewise"; they never show quote-status badges or "ready to capture"
copy until `AUTHENTICATED` is confirmed. If a check is already in flight, `Loading` supersedes
AuthPending.

Loading and Error are semantic ambient/system states even though they render on the badge layer.
They outrank quote-status badges because they describe current work/auth health, not duplicate status.

Spec 005 adds one global privacy state:

```
Paused // Private mode enabled for a logged-in/non-error user → grey owl + ⏸︎ badge
```

Paused outranks Loading/AuthPending/Unsupported/SupportedIdle/quote-status badges, but auth errors and
LoggedOut still win because they are more actionable and accurate.

### 2.2 `QuoteStatus` — the badge layer (only when ambient is Ready/Loading-resolved)
```
None         // no qualifying duplicate data, errored check, or non-tweet page
InCollection // ✓  #009E73  "Already in your collection"
Conflict     // ⚠  #D55E00  "Heads up — attributed to someone else in Quotewise"
Exact        // =  #009E73  "Exact match already in Quotewise"
Similar      // ~  #E69F00  "Similar version already in Quotewise"
New          // ★  #0072B2  "New quote — not in Quotewise yet"
```

### 2.3 `isOriginatorMissing` — preflight blocker context

`isOriginatorMissing` is a tab-scoped boolean derived from preflight/tray-originator lookup
`originator.found === false`. It is not a `DuplicateCheckResult` recommendation; the resolver uses it
to insert `MissingOriginator` (`@ #E69F00`) after Exact/Similar/Conflict and before New.

`currentTweetStatusId`/`currentTweetUrl` identify the tweet whose status is being resolved. Duplicate,
originator, and extracted-tweet results are valid only when they match this current tweet identity.

---

## 3. Output value object (new) — `IconPresentation`

The single shape the resolver returns and the applicator renders:

```ts
interface IconPresentation {
  iconVariant: 'color' | 'grey';      // → chrome.action.setIcon path set
  badgeText: string;                  // '' clears the badge
  badgeColor: string;                 // hex; ignored when badgeText === ''
  title: string;                      // self-contained accessible label (setTitle)
  scope: 'global' | 'tab';            // tab ⇒ apply with { tabId }; global ⇒ no tabId
}
```

Invariant: **exactly one** `IconPresentation` is produced per resolve (FR-030 — the user never sees
two states). `badgeText` is one glyph from the canonical table (or `''`). The resolver **never**
sets a badge text color (FR-003) — `IconPresentation` has no such field by design.

---

## 4. Canonical state/title table (single source — `src/config/icon-states.ts`)

There are **14 canonical states**. This table has **15 title rows** because the Error state has two
distinct actionable tooltips (`SESSION_EXPIRED` and `INSUFFICIENT_PRIVILEGES`).

| State | Layer | `iconVariant` | `badgeText` | `badgeColor` | `title` | `scope` |
|---|---|---|---|---|---|---|
| Ready | artwork | `color` | `''` | — | `Quotewise — ready to capture` | global |
| Supported idle | artwork | `color` | `''` | — | `Quotewise — open a tweet to capture` | global |
| Unsupported page | artwork | `grey` | `''` | — | `Quotewise — capture works on X/Twitter tweets` | global |
| Auth pending | artwork | `color` | `''` | — | `Quotewise` | global |
| Logged out | artwork | `grey` | `''` | — | `Quotewise — log in to capture quotes` | global |
| Paused | badge | `grey` | `⏸︎` | `#64748B` | `Quotewise — paused (private mode)` | global |
| Loading | badge | `color` | `●` | `#56B4E9` | `Quotewise — checking this quote…` | tab |
| Error: session expired | badge | `color` | `!` | `#D55E00` | `Quotewise — session expired, log in again` | global |
| Error: insufficient priv | badge | `color` | `!` | `#D55E00` | `Quotewise — additional permissions required` | global |
| In your collection | badge | `color` | `✓` | `#009E73` | `Already in your collection` | tab |
| Attribution conflict | badge | `color` | `⚠` | `#D55E00` | `Heads up — attributed to someone else in Quotewise` | tab |
| Exact dup exists | badge | `color` | `=` | `#009E73` | `Exact match already in Quotewise` | tab |
| Similar version | badge | `color` | `~` | `#E69F00` | `Similar version already in Quotewise` | tab |
| Missing originator | badge | `color` | `@` | `#E69F00` | `Originator not in Quotewise — add them first` | tab |
| New | badge | `color` | `★` | `#0072B2` | `New quote — not in Quotewise yet` | tab |

Colors are the Okabe-Ito color-blind-safe working set (WCAG 1.4.1/1.4.11; FR-051). Conflict and
Exact and InCollection share `#009E73` because both are safe/no-action-needed states; disambiguation comes from
**shape** (`=` vs `✓`) and tooltip. Similar uses `#E69F00` because a near-version requires review/caution.
MissingOriginator also uses `#E69F00` because the user must perform setup outside the extension before capture.
UnsupportedPage shares the grey owl artwork with LoggedOut because both mean "not usable now"; the tooltip
distinguishes platform availability from authentication. Conflict and Error share `#D55E00` — disambiguated by
**shape** (`⚠` vs `!`) and **layer** (FR-024/Decision 5).
`scope: global` is the default action state, but auth transitions MUST also overwrite affected tweet
tabs with the resolved auth presentation so existing tab-scoped `setIcon`/badge settings cannot
shadow LoggedOut, AuthPending, Ready, or Error.

---

## 5. Mapping rule: `DuplicateCheckResult → QuoteStatus` (FR-040, Decision D5)

Pure function `mapRecommendationToQuoteStatus(result): QuoteStatus`, applied **only** when ambient
resolves to Ready/Loading-complete on a tweet page:

```
if result is null OR result.search_metadata.error            → None            (FR-041, SC-007)
elif any match.in_user_collections === true                  → InCollection    (✓)
elif recommendation ∈ {attribution_conflict,
                       attribution_conflict_resolved}         → Conflict        (⚠)
elif recommendation ∈ {duplicate, duplicate_known_author}    → Exact           (=)
elif recommendation ∈ {new_version, new_version_known_author}→ Similar         (~)
elif recommendation ∈ {new_quote, new_quote_known_author}    → New             (★)
else  /* unknown/unexpected recommendation */                → New             (★, safe default — V.2)
```

The extension does **not** read `match_type`/`similarity` to choose the badge (it trusts the
backend's `recommendation`); those fields and `existing_sightings_for_url[]` are passed through
untouched for the future dropdown tray.

MissingOriginator is inserted by the resolver from preflight `originator.found === false`; it is not derived
from `DuplicateCheckResult` and MUST NOT be emitted for errored preflight results.

---

## 6. Precedence (FR-030) — the resolver's top-level order

`resolveIconPresentation(auth, dup, tab, privateMode): IconPresentation`

```
1. Error           if auth ∈ {SESSION_EXPIRED, INSUFFICIENT_PRIVILEGES}      → ! badge   (global)
2. LoggedOut       elif auth === UNAUTHENTICATED                              → grey owl  (global)
3. Paused          elif privateMode === true                                  → ⏸︎ badge   (global)
4. Loading         elif tab.isSupportedPlatform && tab.isTweetPage
                   && tab.isCheckInFlight                                     → ● badge   (tab)
5. AuthPending     elif auth ∈ {UNKNOWN, CHECKING, AUTHENTICATING}            → color owl (global)
6. UnsupportedPage elif auth === AUTHENTICATED && !tab.isSupportedPlatform    → grey owl  (global)
7. SupportedIdle   elif auth === AUTHENTICATED && !tab.isTweetPage            → color owl (global)
8. Quote-status    elif auth === AUTHENTICATED && tab.isTweetPage:                         (tab)
                       map(dup) → one of  InCollection > Conflict > Exact > Similar
                       elif tab.isOriginatorMissing → MissingOriginator
                       else map(dup) → New
                       (None ⇒ fall through to Ready)
9. Ready           else                                                       → color owl (global)
```

Step 5's internal order is enforced *inside* the mapping (Section 5): `InCollection` is checked
first, then the recommendation tiers. MissingOriginator is inserted after Exact/Similar/Conflict and before
New; `None` falls through to **Ready** unless `tab.isOriginatorMissing` is true. The artwork is **color** for
every state except `LoggedOut`.

### 6.1 Worked precedence ties (acceptance anchors → tests)
| auth | dup highlights | tab | ⇒ result |
|---|---|---|---|
| SESSION_EXPIRED | (any, even an exact match) | tweet | **Error** `!` — auth beats quote status (SC-003) |
| UNAUTHENTICATED | (any) | tweet | **Logged out** grey owl — no quote badge |
| AUTHENTICATED + privateMode | `recommendation:duplicate`, in flight | tweet | **Paused** `⏸︎` — private mode beats loading and quote status |
| CHECKING | `recommendation:duplicate` | tweet | **Auth pending** color owl, no badge, neutral "Quotewise" title |
| AUTHENTICATED | (n/a) | unsupported site | **Unsupported page** grey owl, no badge |
| AUTHENTICATED | (n/a) | supported X/Twitter page, no tweet | **Supported idle** color owl, no badge |
| AUTHENTICATED | in-flight | tweet | **Loading** `●` |
| AUTHENTICATED | `in_user_collections:true` **and** `recommendation:duplicate` | tweet | **In collection** `✓` (beats Exact) |
| AUTHENTICATED | `recommendation:attribution_conflict` | tweet | **Conflict** `⚠` |
| AUTHENTICATED | `recommendation:duplicate`, none collected | tweet | **Exact** `=` |
| AUTHENTICATED | `recommendation:new_version` | tweet | **Similar** `~` |
| AUTHENTICATED | no higher-priority duplicate state + missing originator | tweet | **MissingOriginator** `@` |
| AUTHENTICATED | parent tweet result + reply URL current | tweet | **Loading/Ready**, never the parent badge |
| AUTHENTICATED | `search_metadata.error:true` | tweet | **Ready** (color owl, no badge) — never a false dup badge (SC-007) |

---

## 7. State transitions (lifecycle, not stored)

The icon has no FSM of its own — it is a *projection*. It re-resolves on each of these worker events
and is idempotent (V.1):

- `tabs.onUpdated` (status `complete`) / `webNavigation.onHistoryStateUpdated` → resolve for the tab.
- `tabs.onActivated` → re-resolve the newly active tab and clear/reset the previously active tab if
  it no longer has a tweet in focus.
- Auth state change (`AuthStateManager`) → global re-resolve plus tab-scoped overwrite for affected
  tweet tabs (re-grey, neutralize, restore color, or set/clear `!`) because tab-scoped Chrome action
  settings beat global settings.
- API response with `authRequired:true` → normalize to `SESSION_EXPIRED` or `INSUFFICIENT_PRIVILEGES`,
  update `AuthStateManager`, and immediately force the resolved Error presentation onto the sender tab
  so the toolbar cannot remain in a quote-status state while the tray asks the user to log in or grant
  permissions.
- `TWEET_DATA_EXTRACTED` → set `Loading` (tab), then on duplicate result → re-resolve to a quote-status badge.
- Automatic preflight Loading is represented by an operation record keyed by tab + tweet status ID + operation ID,
  persisted in `chrome.storage.session`, and timed out by an 8-second `chrome.alarms` alarm. A short delayed
  handle-only originator probe may run while the same combined-preflight operation remains current; a probe
  not-found result caches `preloadedOriginator`, clears only automatic Loading, and applies MissingOriginator, while
  a probe found result only warms `preloadedOriginator` and keeps Loading until duplicate/preflight status resolves.
  Timeout for the same current tweet starts one short handle-only originator fallback when a handle is available; a
  fallback not-found result applies MissingOriginator directly, while fallback timeout/error clears Loading and
  re-resolves from cached/ambient state. Late matching combined-preflight results may still apply; stale
  different-tweet results may not.
- Adapter-pushed `TWEET_DATA_EXTRACTED` keeps its runtime response channel open until automatic preflight/probe/fallback
  applies a terminal icon state or reaches the bounded keepalive timeout. This prevents MV3 worker suspension from
  dropping the final closed-tray `chrome.action` write. The content adapter starts this message asynchronously and
  returns extracted tweet data to overlay/tray callers immediately.
- Navigation extraction returning no data or data for a different status ID → keep/return to Loading only for the
  current tweet and schedule a bounded same-status retry; never apply duplicate/originator results for a different
  tweet URL.
- Overlay/tray originator lookup start → set Loading for the current tweet. Lookup completion or a fresh
  cached/preloaded tray result → re-resolve the toolbar from the same current-tweet originator state.
- Timeout-driven automatic originator fallback → set a disposable internal Loading operation for the current tweet
  and reuse the same originator-result state application as the tray. If the user opens the tray or navigates away
  first, the internal fallback result is ignored.
- Overlay/tray originator status and explicit duplicate-check responses → before writing caches or icon state,
  verify the sender tab still shows the response `source_url` status ID; ignore stale responses after navigation.
- Navigate to a non-tweet page / tab switch away → clear the tab badge and reset the tab-scoped
  icon/title to ambient/auth state (FR-002).
- Navigate to an unsupported site while authenticated → clear any tab-scoped quote badge/icon/title override and
  apply UnsupportedPage grey/no badge.

### 7.1 Disposable lifecycle helpers (not authoritative state)

These helpers may exist in memory because loss on service-worker restart only delays or replays preflight; it
does not make the icon apply an incorrect terminal state.

| Helper | Purpose | Validity rule |
|---|---|---|
| Per-tab duplicate result cache | Reuse a recent duplicate result when re-resolving a tab | Must be keyed by tweet/status URL; stale parent results are invalid for replies |
| Per-tab missing-originator cache | Preserve `originator.found:false` long enough for toolbar/tray sync | Must be keyed by tweet/status URL and handle |
| In-flight lookup/check map | Render Loading while duplicate/originator lookup is active | Cleared on completion, auth-invalid state, tab close, navigation away, or bounded fallback timeout |
| Extraction retry timer | Retry when X renders the current tweet article late | Bounded; canceled on success, status-ID change, tab close, non-tweet navigation, or auth-invalid state |
| Adapter message keepalive | Keep the worker alive long enough to apply the first closed-tray automatic icon result | Scoped to `TWEET_DATA_EXTRACTED`; released on preflight/probe/fallback settle or bounded keepalive timeout; never blocks adapter `getLatestData()` |

---

## 8. Validation rules (enforced by tests, Article VI)

- The resolver is **total**: every `(AuthState × recommendation × {collected?} × tab)` combination
  yields a valid `IconPresentation` (no throw, no undefined) — unknown values default to New/Ready.
- `badgeText` is always `''` or exactly one glyph from Section 4; `scope` matches the table.
- A `null`/errored `DuplicateCheckResult` never yields a quote-status badge (SC-007/FR-041).
- An unsupported site never yields Ready copy, Loading, or a quote-status badge while authenticated (FR-015).
- A supported X/Twitter non-tweet page yields SupportedIdle, not Ready-to-capture copy and not a quote-status badge.
- A duplicate/originator/extraction result whose tweet/status identity does not match the current tweet never yields
  a quote-status badge for the current tab (FR-045).
- A fresh tray-originator result for the current tweet drives the same Loading/final toolbar state as automatic
  preflight (FR-044/FR-046).
- Transitional auth states (`UNKNOWN`/`CHECKING`/`AUTHENTICATING`) never yield quote-status badges
  or "ready to capture" copy.
- The FR-051 3:1 glyph contrast target is verified manually at real 16px/32px toolbar size; it is
  not an automated data-model assertion.
- Asset invariant (pipeline test): for each size, `icon{n}-grey.png` exists, has dimensions `n×n`,
  and is measurably less saturated than `icon{n}.png` (greyed, FR-062).
