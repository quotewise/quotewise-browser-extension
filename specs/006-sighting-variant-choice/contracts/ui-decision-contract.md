# Contract — Internal UI / module interfaces

Defines the seams between `duplicate-status` (pure), `similar-diff` (presentational), `duplicate-badge` (router), and `overlay-bar` (state + submit owner). These are the testable boundaries.

## `classifyMatchResolution` (pure — `src/utils/duplicate-status.ts`)

```
function classifyMatchResolution(
  result?: DuplicateCheckResult | null
): 'exact' | 'conflict' | 'similar' | 'couldnt_verify' | 'none';
```

- Precedence: `couldnt_verify` → `exact` → `conflict` → `similar` → `none` (see data-model routing table).
- Pure, total, never throws; absent fields ⇒ `none` (or `similar` via legacy `recommendation` near-match when `match_class` absent — FR-013).

## `buildSimilarMatchView` (`similar-diff.ts`)

```
function buildSimilarMatchView(
  result: DuplicateCheckResult,
  capturedText: string,
  tweetDate?: string | null
): SimilarMatchView | null;   // null when not a 'similar' match
```

- `variantAvailable` always `true`; `sightingAvailable` true only when `tweetDate` and `match.quote_date` are known and `tweetDate < quote_date` (Q3=B).
- `quoteId` = coerced int or `null`; `existingQuoteUrl` only if `https:`.

## `renderSimilarDiff` (`similar-diff.ts`)

```
function renderSimilarDiff(
  container: HTMLElement,
  view: SimilarMatchView,
  handlers: { onResolve: (decision: ResolutionDecision) => void }
): void;
```

- Renders existing quote text + diff, a "View existing quote" link (https-validated), and the action buttons:
  - "Add as variant" (always) → `onResolve({ quoteId, intent: 'variant' })`.
  - "Add another sighting" (only if `sightingAvailable`) → `onResolve({ quoteId, intent: 'sighting' })`.
- Buttons: equal visual weight, `type="button"`, keyboard-operable, `aria-label`s, status by glyph+text (Article VII). No disabled-placeholder button.

## `DuplicateBadge` (`duplicate-badge.ts`)

```
interface DuplicateBadgeCallbacks {
  onSubmitStateChange: (directive: SubmitStateDirective) => void;  // existing
  onResolveDecision: (decision: ResolutionDecision) => void;        // NEW — similar
  onRetry: () => void;                                              // NEW — couldnt_verify
  onResolveConflict: (existingQuoteUrl: string | null) => void;     // NEW — conflict (open Quotewise)
}
update(state, capturedText?, tweetDate?): void;
```

- Routes via `classifyMatchResolution`:
  - `couldnt_verify` → "⚠️ Couldn't verify duplicates" + Retry; emits submit directive `{enabled:false}`.
  - `exact` → existing "Already captured" behavior (unchanged).
  - `conflict` → "⚠️ Already attributed to {originator}" + resolve link; submit `{enabled:false}`.
  - `similar` → `renderSimilarDiff(...)`; submit handled by the decision buttons (hide the generic submit).
  - `none` → existing recommendation-based rendering (unchanged).

## `overlay-bar.ts` submit signature

```
private async submitQuote(opts?: {
  linkToQuoteId?: number;
  userIntent?: 'sighting' | 'variant';
}): Promise<void>;
```

- Includes `link_to_quote_id` + `user_intent` in the `SUBMIT_QUOTE` message when both present.
- Re-entrancy guard: returns immediately if `captureState.isSubmitting` (FR-011, qw-0psq.1).
- On `couldnt_verify`/`conflict`, the generic submit is disabled; Retry re-runs `checkDuplicate`.
- Confirmation: response `action` → "Sighting added" / "Added as variant" (fallback to `userIntent`).
