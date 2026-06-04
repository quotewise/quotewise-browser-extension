# Contract: Duplicate-Status → Quote-Status Mapping

**Feature**: `004-extension-icon-states` | Implements FR-040, FR-041, FR-020..FR-025 · Decision D5

The consumed data contract is the **existing** backend response `DuplicateCheckResult`
(`src/types/api.ts`) returned by `POST /v1/quotes/check_duplicate/`. **No backend change.** This
contract pins exactly which fields the icon reads and how they map — so the extension and backend
stay decoupled (the extension trusts `recommendation`, never re-derives thresholds).

## Consumed fields (read-only)

```ts
DuplicateCheckResult {
  recommendation: 'duplicate' | 'new_version' | 'new_quote' | 'attribution_conflict'
                | 'new_quote_known_author' | 'duplicate_known_author'
                | 'new_version_known_author' | 'attribution_conflict_resolved';   // AUTHORITATIVE
  matches: Array<{ in_user_collections: boolean; /* match_type, similarity → tray only */ }>;
  existing_sightings_for_url?: Array<…>;        // tray only
  search_metadata: { error?: boolean; … };       // error ⇒ no badge
}
```

Fields **ignored** for icon selection (retained, passed to the future tray):
`matches[].match_type`, `matches[].similarity`, `existing_sightings_for_url[]`,
`social_originator`, `suggested_originator_id`.

## Mapping (authoritative ladder — order matters)

| # | Condition | `QuoteStatus` | Badge | Color | FR |
|---|---|---|---|---|---|
| 0 | `result == null` OR `search_metadata.error === true` | `None` | (no badge) | — | FR-041 |
| 1 | `matches.some(m => m.in_user_collections === true)` | `InCollection` | `✓` | `#009E73` | FR-021 |
| 2 | `recommendation ∈ {duplicate, duplicate_known_author}` | `Exact` | `=` | `#E69F00` | FR-022 |
| 3 | `recommendation ∈ {new_version, new_version_known_author}` | `Similar` | `~` | `#CC79A7` | FR-023 |
| 4 | `recommendation ∈ {attribution_conflict, attribution_conflict_resolved}` | `Conflict` | `⚠` | `#D55E00` | FR-024 |
| 5 | `recommendation ∈ {new_quote, new_quote_known_author}` | `New` | `★` | `#0072B2` | FR-020 |
| 6 | any other/unknown `recommendation` | `New` (safe default) | `★` | `#0072B2` | V.2 |

**Rules**
- Row 1 (collection) is checked **before** the recommendation tiers — a collected quote shows `✓`
  even when `recommendation` says `duplicate`/`new_version`/etc. (FR-021 precedence).
- A weak `match_type: similar` (≤ 0.8) is **never** surfaced as Exact/Similar (FR-025) — it arrives
  as `recommendation: new_quote*` from the backend and maps to **New** via row 5. The extension does
  not enforce the threshold; the backend already did.
- The mapping is **total and pure**; unknown enum values fall to row 6 rather than throwing (drift
  tolerance, Constitution V.2).

## Test obligations (`tests/utils/duplicate-status.test.ts`, extended)

- One case per row (0–6), including `*_known_author` variants for rows 2–5.
- Row-1-beats-row-2: `{ in_user_collections: true } + recommendation: 'duplicate'` ⇒ `InCollection`.
- `null` and `{ search_metadata: { error: true } }` ⇒ `None`.
- Unknown `recommendation: 'banana'` ⇒ `New` (no throw).
- Existing `classifyDuplicateSighting` tests remain green (tray classifier untouched).
