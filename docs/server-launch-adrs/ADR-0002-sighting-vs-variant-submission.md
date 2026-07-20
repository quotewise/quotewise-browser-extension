# ADR-0002 — Quote submission: explicit sighting-vs-variant linkage

- **Status:** ✅ Backend implemented & deployed 2026-06-20 (see "Backend response — actual implementation" below) · Chrome client integration in progress (spec 006)
- **Date:** 2026-06-19 (proposed) · 2026-06-20 (backend deployed & verified)
- **Priority:** P1 (first post-launch feature; not launch-gating)
- **Related beads:** `qw-hsly`
- **Endpoint:** `POST /v1/quotes/` (submission)
- **Depends on:** [ADR-0001](ADR-0001-duplicate-check-match-provenance.md) (the client needs `quote_id` + provenance to drive this)

## Context

ADR-0001 lets the extension show "a similar quote already exists." This ADR covers the **write** side: when the user makes their choice, the API must accept the choice explicitly and record *which* choice was made.

Two outcomes from the two-button UI:

1. **Add another sighting** — link this `source_url` to the **existing** quote (same quote, new page/platform). Should *not* create a new quote row.
2. **Add a new quote (variant)** — create a separate quote even though a similar one exists (paraphrase, edited reshare).

Today submission only supports "create a quote." There is no way to say "this is a sighting of quote X," and no record of the user's intent — which we also want in order to **tune similarity thresholds over time** (acceptance criterion in `qw-hsly`).

## Decision (proposed)

Accept an optional linkage + intent on `POST /v1/quotes/`:

```jsonc
// POST /v1/quotes/   (Authorization: Bearer <token>)
{
  "source_url": "https://x.com/user/status/123",
  "social_handle": "user",
  "originator_id": "or_…",
  "text": "captured quote text",

  // NEW — present only when resolving a similarity match (ADR-0001):
  "link_to_quote_id": "qt_01HX…",          // set ⇒ create a SIGHTING of this quote, not a new quote
  "user_intent": "sighting" | "new_variant" // record the user's explicit choice
}
```

Behavior:
- `link_to_quote_id` present + `user_intent: "sighting"` → create/attach a `QuoteSighting` for `source_url` to the referenced quote; return the existing quote. Idempotent if the sighting already exists.
- `user_intent: "new_variant"` (no `link_to_quote_id`, or explicitly creating despite a match) → create a new quote as today, and record that the user chose "variant" **against** the candidate match (store the candidate `quote_id` + `similarity_score` for threshold analytics).
- Neither field present → unchanged current behavior (back-compatible).

Response should tell the client what happened so the overlay can confirm correctly ("Sighting added" vs "Quote added"):

```jsonc
{ "outcome": "sighting_added" | "quote_created", "quote_id": "qt_…", "quote_url": "https://quotewise.io/quotes/qt_…" }
```

## What we need from the backend

1. Accept `link_to_quote_id` + `user_intent` on quote submission.
2. Sighting path links `source_url` to the existing quote (idempotent) without creating a duplicate quote.
3. Persist the user's choice + the candidate match (`quote_id`, `similarity_score`) for similarity-threshold tuning.
4. Return an `outcome` discriminator.

## Consequences

- **Positive:** Removes the "every similar quote becomes silently a new quote (or silently a sighting)" ambiguity; gives a labeled dataset to calibrate the similarity threshold.
- **Cost:** Submission endpoint branches on intent; needs authorization checks (user may only attach sightings to quotes they can see).
- **Back-compat:** Fields are optional; existing clients keep working.

## Acceptance

- A submission with `link_to_quote_id` + `user_intent: sighting` records a sighting and returns `outcome: sighting_added` without creating a new quote.
- A submission with `user_intent: new_variant` creates a new quote and logs the rejected candidate for analytics.
- Omitting both behaves exactly as today.

---

## Backend response — actual implementation (2026-06-20)

**Status:** Implemented (backend; beads qw-hsly / qw-0psq.22). API stays **v1**; additive/back-compat. **The backend drives the contract.** The auto-collapse this ADR worried about was real: `create_quote()` silently turned every ≥0.8 near-match into a sighting, erasing distinct variant text. The variant path now stops that.

`POST /v1/quotes/` accepts two **co-required** optional inputs (both or neither). Field-name mapping (ADR sketch → **actual**):

| ADR sketch | Actual | Notes |
|---|---|---|
| `link_to_quote_id` (`"qt_01HX…"`) | `link_to_quote_id` (**integer**) | = check_duplicate `quote_id` (numeric id; send the integer, or its string form — both accepted). |
| `user_intent: "sighting" \| "new_variant"` | `user_intent: "sighting" \| "variant"` | **Two outcomes only.** We kept the `variant` label (nudges curatorial thinking); `new_variant` → `variant`. No third "new quote" button — data shows genuinely-new quotes don't reach the near-match tier. |
| `outcome: "sighting_added" \| "quote_created"` | existing **`action`**: `"sighting_added" \| "created"` | No new `outcome` field; bind to the existing `action` discriminator. |
| `quote_id` / `quote_url` (in response) | existing **`quote`** object | Carries `id` + web URL already. |

### Behavior

- `user_intent: "sighting"` (+ `link_to_quote_id`) → idempotently attach a `QuoteSighting` for `source_url` to the existing quote; `action == "sighting_added"`; **no** new quote. `200`.
- `user_intent: "variant"` (+ `link_to_quote_id`) → **force-create** a distinct quote (preserving the text, bypassing the near-match→sighting auto-collapse) **and** register a `needs_review` `variant` `QuoteRelation` new_quote → candidate; `action == "created"`. `201`. Curators re-type/sever downstream (specs 117/119).
- Neither field → **unchanged** (back-compat): near-matches still auto-collapse to a sighting as before.
- **Routing guard:** the variant path is **same-originator** only. A different-originator near-match (`match_class == "conflict"` from ADR-0001) routes to the existing attribution-dispute flow, **not** the variant button.

### Authorization & errors (RFC 9457)

- The caller may only link to a quote they can see (public, or one they revised) → otherwise **403** `application/problem+json`.
- An unknown / unresolved `link_to_quote_id` → **400**.
- Sending only one of the pair → **400** (`DUPLICATE_RESOLUTION_INCOMPLETE`).

### Persisting the choice (threshold tuning)

Both choices record one append-only **`DUPLICATE_RESOLUTION` Assertion** (the single queryable place spanning sighting+variant decisions) with payload `{candidate_quote_id, similarity_score, similarity_method, user_decision, source_url}`. The variant path *also* yields the `QuoteRelation` + `QuoteRelationEvent`. The similarity score is recovered server-side via `DuplicateChecker` (the client need not send it).

### What the extension binds to

`link_to_quote_id` (integer) + `user_intent` (`"sighting"`/`"variant"`) on the request; the `action` discriminator (`"sighting_added"`/`"created"`) and the `quote` object on the response; RFC 9457 `403`/`400` for the error cases.
