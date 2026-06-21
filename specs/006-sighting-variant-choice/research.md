# Phase 0 Research — Similarity Duplicate Sighting/Variant

No open `NEEDS CLARIFICATION` items: the backend contract is frozen (ADR-0001/0002, verified deployed 2026-06-20) and the 4 design decisions were resolved in `/speckit-clarify`. This records the remaining implementation-level decisions.

## D1 — A single pure resolution classifier

- **Decision**: Add `classifyMatchResolution(result): 'exact' | 'conflict' | 'similar' | 'couldnt_verify' | 'none'` to `src/utils/duplicate-status.ts`, consuming `matches[0].match_class` / `match_source` / `existing_sighting_for_this_url` and `search_metadata.error`.
- **Rationale**: One deterministic seam, unit-testable test-first (Article VI). Keeps `duplicate-badge.ts` (render) and `overlay-bar.ts` (submit guard) thin and consistent — both route off the same function, so the badge and the submit guard cannot disagree.
- **Alternatives**: Inline conditionals in the badge (rejected — duplicated in the submit guard, hard to test); a class/state-machine object (rejected — overkill for a pure mapping).

## D2 — "Couldn't verify" detection & no fabricated new_quote

- **Decision**: Treat `search_metadata.error === true` as `couldnt_verify`. In `checkQuoteDuplicate`, a failed/non-2xx check resolves to a result carrying `search_metadata.error = true` (not a thrown error) so the overlay can render the block+retry state; the classifier short-circuits to `couldnt_verify` **before** reading `recommendation`, so the prior `recommendation: 'new_quote'` fallback is never *interpreted* as a healthy new quote (FR-008/009).
- **Rationale**: Degrade-not-throw (Article V); honest refusal (Article I). Retry simply re-runs the existing duplicate-check path.
- **Alternatives**: Throwing on check failure (rejected — overlay would need try/catch around render and lose the structured state); adding `recommendation: 'error'` to the union (rejected — `search_metadata.error` already exists and is the documented contract signal).

## D3 — quote_id (string) → link_to_quote_id (integer)

- **Decision**: Coerce with `Number.parseInt(quote_id, 10)` at the overlay→submit boundary; if the result is `NaN`, treat as "no link available" and fall back (do not send a partial pair — FR-005).
- **Rationale**: ADR-0001 returns `quote_id` as a stringified integer; ADR-0002 wants an integer `link_to_quote_id` (string form also accepted, but we send the coerced integer for cleanliness).

## D4 — Reuse date-gating logic; flip from "disabled hint" to "availability"

- **Decision**: Reuse the existing `addSightingState` date comparison (`tweetTime < quoteTime`) from `similar-diff.ts`, but it now **gates whether the sighting button is offered** (Q3=B) rather than rendering a disabled button. Variant is always offered for `similar`; sighting is offered only when eligible.
- **Rationale**: Matches the clarified decision and removes the confusing permanently-disabled control. The relative-date provenance note may still render as informational text when eligible.

## D5 — Submission stays in overlay-bar; similar-diff emits intent

- **Decision**: `similar-diff.ts` renders the two buttons and emits a `ResolutionDecision { quoteId, intent }` via a handler; `duplicate-badge.ts` forwards it through a new `onResolveDecision` callback; `overlay-bar.ts` calls `submitQuote({ linkToQuoteId, userIntent })`. Submission, auth, collection, and confirmation stay owned by `overlay-bar.ts` (single submit path).
- **Rationale**: Keeps one submission code path (auth refresh, collection, double-submit guard, progress UI) instead of duplicating it in a component. The component stays presentational.
- **Alternatives**: similar-diff calling the API directly (rejected — bypasses overlay state/guards).

## D6 — Confirmation copy from the response `action`

- **Decision**: Drive the confirmation off the response `action` (`sighting_added` → "Sighting added"; `created` → "Added as variant"), with the sent `user_intent` as a fallback if `action` is absent.
- **Rationale**: Authoritative (the server says what happened). Honors Q4=C copy with no review-status overclaim (Article VII).

## D7 — Backward/forward compatibility

- **Decision**: When `match_class`/`match_source` are absent (older backend or unexpected shape), the classifier returns `none` and the badge falls back to the existing recommendation-based rendering (`new_version` etc.) unchanged (FR-013).
- **Rationale**: Article V API-drift tolerance; zero regression for already-shipped behavior.

## D8 — Fold in `javascript:` URI hardening (qw-0psq.6)

- **Decision**: While reworking `duplicate-badge.ts` and `similar-diff.ts` link rendering, set anchor `href` via property assignment and validate the scheme is `https:` before assigning (reject otherwise).
- **Rationale**: Same components, same change surface; closes the bounded defense-in-depth XSS (`qw-0psq.6`) without a separate pass. Article III.
