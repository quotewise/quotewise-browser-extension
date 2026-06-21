# Phase 1 Data Model — Client-side types

All types live in the extension (TypeScript). No persisted storage changes. Source of truth for wire shapes: ADR-0001/0002.

## Extended: `DuplicateCheckResult.matches[]` (`src/types/api.ts`)

Add three fields (all optional for forward/back compat — Article V):

| Field | Type | Notes |
|-------|------|-------|
| `match_source` | `'url' \| 'similarity'` (optional) | How the match was found. |
| `match_class` | `'exact' \| 'conflict' \| 'similar'` (optional) | Collapsed 3-state routing key. |
| `existing_sighting_for_this_url` | `boolean` (optional) | This exact source URL already recorded as a sighting. |

Existing fields already present and reused: `quote_id` (string), `text`, `url`, `short_code`, `similarity`, `quote_date`, `sighting_status`, `in_user_collections`.

## New enum: `MatchResolution`

```
type MatchResolution = 'exact' | 'conflict' | 'similar' | 'couldnt_verify' | 'none';
```

Produced by `classifyMatchResolution(result)`. Routing:

| Result condition (first match) | MatchResolution | UI |
|--------------------------------|-----------------|----|
| `search_metadata.error === true` (or check failed) | `couldnt_verify` | Block + Retry (FR-008) |
| `existing_sighting_for_this_url` OR `match_source === 'url'` OR `match_class === 'exact'` OR `sighting_status === 'exact_url'` | `exact` | "Already captured" single action (FR-006) |
| `match_class === 'conflict'` | `conflict` | Block + resolve-in-Quotewise (FR-007) |
| `match_class === 'similar'` (or legacy `recommendation` near-match when class absent) | `similar` | Two-button decision (FR-001) |
| no matches / fields absent and not near-match | `none` | Normal new-quote (no badge) |

State precedence is top-to-bottom (error wins, then exact, then conflict, then similar).

## New: `ResolutionDecision`

```
interface ResolutionDecision {
  quoteId: number;            // coerced from match.quote_id (string) via parseInt
  intent: 'sighting' | 'variant';
}
```

## Reworked: `SimilarMatchView` (`src/content/ui/components/similar-diff.ts`)

```
interface SimilarMatchView {
  quoteId: number | null;            // null ⇒ cannot offer linked actions (degraded)
  existingQuoteText: string | null;  // matched quote text (render inline)
  diff: WordDiffToken[] | null;      // word diff vs captured text; null if no text
  existingQuoteUrl: string | null;   // validated https: only
  sightingAvailable: boolean;        // date-gated: tweet predates existing quote (Q3=B)
  sightingHint: string | null;       // informational provenance note when eligible
  variantAvailable: boolean;         // always true for a 'similar' match
}
```

## Extended: submission types (`src/types/api.ts`)

`QuoteSubmissionRequest` — add (both optional, **co-required as a pair** — FR-005):

| Field | Type | Notes |
|-------|------|-------|
| `link_to_quote_id` | `number` (optional) | Existing quote id (coerced). |
| `user_intent` | `'sighting' \| 'variant'` (optional) | The user's choice. |

`QuoteSubmissionResult` — add:

| Field | Type | Notes |
|-------|------|-------|
| `action` | `'created' \| 'sighting_added'` (optional) | From backend response; drives confirmation copy. |

## Overlay capture-state additions (`overlay-bar.ts`, in-memory only)

- `captureState.matchResolution: MatchResolution` — current route (drives render + submit guard).
- Reuse existing `captureState.isSubmitting` for the double-submit guard (FR-011).
- No new `chrome.storage` keys (Article II/V).

## Validation rules

- `link_to_quote_id` and `user_intent` MUST be sent together or not at all (FR-005). If `quoteId` coercion is `NaN`, send neither.
- `user_intent` ∈ {`sighting`, `variant`} only; `sighting` requires `sightingAvailable === true`.
- `existingQuoteUrl` rendered only if it parses as `https:` (qw-0psq.6).
- Absent `match_class`/`match_source` ⇒ `none`/legacy path; never throw (FR-013).
