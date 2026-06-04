# Phase 1 Data Model: Extension Toolbar Icon States

**Feature**: `004-extension-icon-states` | **Date**: 2026-06-04

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
| `TabContext` | **new, derived in worker** | `{ tabId: number; isTweetPage: boolean; isCheckInFlight: boolean }` |

`recommendation ∈ { new_quote, new_version, duplicate, attribution_conflict,
new_quote_known_author, duplicate_known_author, new_version_known_author, attribution_conflict_resolved }`

`match_type ∈ { exact_url, exact_same_originator, exact_different_originator, near_same_originator,
near_different_originator, similar }` (retained for the tray, **not** used for icon selection — D5).

---

## 2. Derived state enums (new)

### 2.1 `AmbientState` — non-quote-status system states
```
Ready       // AUTHENTICATED, no quote/error/loading in focus → full-color owl
AuthPending // UNKNOWN | CHECKING | AUTHENTICATING → full-color owl, no badge, neutral title
LoggedOut   // UNAUTHENTICATED → greyed owl
Loading     // a duplicate/preflight check is in flight → color owl + static ● badge
Error       // SESSION_EXPIRED | INSUFFICIENT_PRIVILEGES → color owl + ! badge
```
*Note*: `UNKNOWN`/`CHECKING`/`AUTHENTICATING` are transitional. They use the same color artwork as
Ready but the neutral title "Quotewise"; they never show quote-status badges or "ready to capture"
copy until `AUTHENTICATED` is confirmed. If a check is already in flight, `Loading` supersedes
AuthPending.

Loading and Error are semantic ambient/system states even though they render on the badge layer.
They outrank quote-status badges because they describe current work/auth health, not duplicate status.

### 2.2 `QuoteStatus` — the badge layer (only when ambient is Ready/Loading-resolved)
```
None         // no qualifying duplicate data, errored check, or non-tweet page
InCollection // ✓  #009E73  "Already in your collection"
Conflict     // ⚠  #D55E00  "Heads up — attributed to someone else in Quotewise"
Exact        // =  #E69F00  "Exact match already in Quotewise"
Similar      // ~  #CC79A7  "Similar version already in Quotewise"
New          // ★  #0072B2  "New quote — not in Quotewise yet"
```

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

There are **10 canonical states**. This table has **11 title rows** because the Error state has two
distinct actionable tooltips (`SESSION_EXPIRED` and `INSUFFICIENT_PRIVILEGES`).

| State | Layer | `iconVariant` | `badgeText` | `badgeColor` | `title` | `scope` |
|---|---|---|---|---|---|---|
| Ready | artwork | `color` | `''` | — | `Quotewise — ready to capture` | global |
| Auth pending | artwork | `color` | `''` | — | `Quotewise` | global |
| Logged out | artwork | `grey` | `''` | — | `Quotewise — log in to capture quotes` | global |
| Loading | badge | `color` | `●` | `#56B4E9` | `Quotewise — checking this quote…` | tab |
| Error: session expired | badge | `color` | `!` | `#D55E00` | `Quotewise — session expired, log in again` | global |
| Error: insufficient priv | badge | `color` | `!` | `#D55E00` | `Quotewise — additional permissions required` | global |
| In your collection | badge | `color` | `✓` | `#009E73` | `Already in your collection` | tab |
| Attribution conflict | badge | `color` | `⚠` | `#D55E00` | `Heads up — attributed to someone else in Quotewise` | tab |
| Exact dup exists | badge | `color` | `=` | `#E69F00` | `Exact match already in Quotewise` | tab |
| Similar version | badge | `color` | `~` | `#CC79A7` | `Similar version already in Quotewise` | tab |
| New | badge | `color` | `★` | `#0072B2` | `New quote — not in Quotewise yet` | tab |

Colors are the Okabe-Ito color-blind-safe working set (WCAG 1.4.1/1.4.11; FR-051). Conflict and
Error share `#D55E00` — disambiguated by **shape** (`⚠` vs `!`) and **layer** (FR-024/Decision 5).
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

---

## 6. Precedence (FR-030) — the resolver's top-level order

`resolveIconPresentation(auth, dup, tab): IconPresentation`

```
1. Error           if auth ∈ {SESSION_EXPIRED, INSUFFICIENT_PRIVILEGES}      → ! badge   (global)
2. LoggedOut       elif auth === UNAUTHENTICATED                              → grey owl  (global)
3. Loading         elif tab.isCheckInFlight                                   → ● badge   (tab)
4. AuthPending     elif auth ∈ {UNKNOWN, CHECKING, AUTHENTICATING}            → color owl (global)
5. Quote-status    elif auth === AUTHENTICATED && tab.isTweetPage:                         (tab)
                       map(dup) → one of  InCollection > Conflict > Exact > Similar > New
                       (None ⇒ fall through to Ready)
6. Ready           else                                                       → color owl (global)
```

Step 5's internal order is enforced *inside* the mapping (Section 5): `InCollection` is checked
first, then the recommendation tiers; `None` falls through to **Ready** (no badge). The artwork is
**color** for every state except `LoggedOut`.

### 6.1 Worked precedence ties (acceptance anchors → tests)
| auth | dup highlights | tab | ⇒ result |
|---|---|---|---|
| SESSION_EXPIRED | (any, even an exact match) | tweet | **Error** `!` — auth beats quote status (SC-003) |
| UNAUTHENTICATED | (any) | tweet | **Logged out** grey owl — no quote badge |
| CHECKING | `recommendation:duplicate` | tweet | **Auth pending** color owl, no badge, neutral "Quotewise" title |
| AUTHENTICATED | in-flight | tweet | **Loading** `●` |
| AUTHENTICATED | `in_user_collections:true` **and** `recommendation:duplicate` | tweet | **In collection** `✓` (beats Exact) |
| AUTHENTICATED | `recommendation:attribution_conflict` | tweet | **Conflict** `⚠` |
| AUTHENTICATED | `recommendation:duplicate`, none collected | tweet | **Exact** `=` |
| AUTHENTICATED | `recommendation:new_version` | tweet | **Similar** `~` |
| AUTHENTICATED | `search_metadata.error:true` | tweet | **Ready** (color owl, no badge) — never a false dup badge (SC-007) |
| AUTHENTICATED | (n/a) | non-tweet | **Ready** + worker clears any stale tab badge and tab-scoped icon/title override (FR-002) |

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
- `TWEET_DATA_EXTRACTED` → set `Loading` (tab), then on duplicate result → re-resolve to a quote-status badge.
- Navigate to a non-tweet page / tab switch away → clear the tab badge and reset the tab-scoped
  icon/title to ambient/auth state (FR-002).

---

## 8. Validation rules (enforced by tests, Article VI)

- The resolver is **total**: every `(AuthState × recommendation × {collected?} × tab)` combination
  yields a valid `IconPresentation` (no throw, no undefined) — unknown values default to New/Ready.
- `badgeText` is always `''` or exactly one glyph from Section 4; `scope` matches the table.
- A `null`/errored `DuplicateCheckResult` never yields a quote-status badge (SC-007/FR-041).
- Transitional auth states (`UNKNOWN`/`CHECKING`/`AUTHENTICATING`) never yield quote-status badges
  or "ready to capture" copy.
- The FR-051 3:1 glyph contrast target is verified manually at real 16px/32px toolbar size; it is
  not an automated data-model assertion.
- Asset invariant (pipeline test): for each size, `icon{n}-grey.png` exists, has dimensions `n×n`,
  and is measurably less saturated than `icon{n}.png` (greyed, FR-062).
