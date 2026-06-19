# ADR-0001 — Duplicate-check: expose match provenance + matched-quote payload

- **Status:** Proposed
- **Date:** 2026-06-19
- **Priority:** P1 (first post-launch feature; not launch-gating)
- **Related beads:** `qw-hsly` (Show existing quote and offer 'Add sighting' vs 'Add new quote' when similarity-duplicate detected), `qw-eg3c` (toolbar icon state redesign — already references `match_type`)
- **Endpoint:** `POST /v1/quotes/check_duplicate/`

## Context

When the user captures a tweet, the extension calls `check_duplicate`. Today the overlay treats **every** duplicate match the same way, regardless of *how* the match was made. That collapses two distinct user intents:

1. The same quote already exists because this exact **URL/sighting** was recorded before → there is nothing to do.
2. A **similar** quote exists (matched by text similarity, not by URL) → this might be the *same* quote seen on a new page/platform (a new **sighting**), **or** a **variant** (paraphrase, edited reshare). Only the user can decide.

To let the extension present "Here is the existing quote — Add another sighting, or Add a new quote (variant)?", the response must tell the client **(a) how the match was made** and **(b) enough about the matched quote to render it inline.**

The extension already consumes some of this surface:
- `duplicate-badge.ts:125` (`getQuotePageUrl`) reads `match.url`.
- The icon redesign (`qw-eg3c`) expects a `match_type` of `exact` / `similar` / `conflict` "from data already returned by `/v1/quotes/check_duplicate`."
- On error the extension currently falls back to a fabricated `recommendation: new_quote` with `search_metadata.error = true` (`quotewise-api.ts:278-285`) — see ADR note below.

## Decision (proposed)

Extend each entry in the `check_duplicate` matches with explicit **provenance** and a **renderable quote payload**:

```jsonc
// POST /v1/quotes/check_duplicate/  → 200
{
  "recommendation": "exists" | "new_quote" | "needs_user_decision",
  "matches": [
    {
      "quote_id": "qt_01HX...",            // NEW — stable id to link a sighting (ADR-0002)
      "match_source": "url" | "similarity",// NEW — how this match was found
      "match_type": "exact" | "similar" | "conflict", // align with qw-eg3c
      "similarity_score": 0.93,            // NEW — present when match_source = similarity
      "quote_text": "the matched quote text…", // NEW — to render inline in the overlay
      "originator": { "id": "or_…", "name": "…", "slug": "…" },
      "url": "https://quotewise.io/quotes/qt_01HX…", // existing — page link
      "existing_sighting_for_this_url": true|false    // NEW — was THIS source_url already recorded?
    }
  ],
  "search_metadata": { "error": false, "engine": "…", "threshold": 0.85 }
}
```

Semantics the extension will rely on:
- `match_source: "url"` (or `existing_sighting_for_this_url: true`) → **single-action** "Already collected" state (no regression to today's behavior).
- `match_source: "similarity"` → **two-action** decision surface using `quote_text` + `quote_id` (drives ADR-0002).
- `recommendation: "needs_user_decision"` is the new state that maps to the two-button UI; keep `exists` / `new_quote` for the unambiguous cases.

## What we need from the backend

1. Add `quote_id`, `match_source`, `similarity_score`, `quote_text`, and `existing_sighting_for_this_url` to each match.
2. Confirm/standardize `match_type` values (`exact` | `similar` | `conflict`) so `qw-eg3c` and `qw-hsly` consume one source of truth.
3. Keep the matched `quote_text` reasonably short (the overlay shows a preview; truncation server-side with an ellipsis flag is fine).
4. Keep the error contract explicit (see below) rather than relying on the client to fabricate `new_quote`.

## Consequences

- **Positive:** Unblocks `qw-hsly` and the richer icon states (`qw-eg3c`) from a single response shape. Distinguishes "already have it" from "looks similar — your call."
- **Cost:** Slightly larger response; need to ensure `quote_text` exposure respects any visibility/privacy rules (only return quotes the requesting user is allowed to see).
- **Cross-cutting (see ADR note):** The extension's current behavior of returning a fake `new_quote` on API failure makes an outage look like a healthy new quote (`qw-0psq.4`). A clear server error contract (e.g. `5xx` or `{ "search_metadata": { "error": true } }`) lets the client show "could not verify duplicates" instead.

## Acceptance

- Similarity matches return `match_source: "similarity"`, `quote_id`, and `quote_text`.
- URL/sighting matches return `match_source: "url"` (or `existing_sighting_for_this_url: true`) and preserve current single-action behavior.
- `match_type` values are documented and stable.
