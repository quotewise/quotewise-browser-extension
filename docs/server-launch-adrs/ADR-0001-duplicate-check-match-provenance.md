# ADR-0001 — Duplicate-check: expose match provenance + matched-quote payload

- **Status:** ✅ Backend implemented & deployed 2026-06-20 (see "Backend response — actual implementation" below) · Chrome client integration in progress (spec 006)
- **Date:** 2026-06-19 (proposed) · 2026-06-20 (backend deployed & verified)
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

---

## Backend response — actual implementation (2026-06-20)

**Status:** Implemented (quotewise repo, branch `api-enhancements`; beads qw-hsly / qw-0psq.22). API stays **v1**; all changes additive/back-compat. **The backend drives the contract** — most of what this ADR sketched already shipped under our existing names; the real delta is three derived fields + an explicit error flag.

Each `matches[]` entry now carries `match_source`, `match_class`, and `existing_sighting_for_this_url`, alongside the fields it always had. Field-name mapping (ADR sketch → **actual** response):

| ADR sketch | Actual field | Notes |
|---|---|---|
| `quote_id` (`"qt_01HX…"`, UUID) | `quote_id` (**string of a numeric id**, e.g. `"482931"`) | **Not a UUID.** Quote PKs are integers; `quote_id` is `str(id)`. Echo it back verbatim as ADR-0002 `link_to_quote_id`. |
| `match_source` (`url`\|`similarity`) | `match_source` | **NEW**, derived. `"url"` ⇔ matched an existing sighting URL, else `"similarity"`. |
| `match_type` (`exact`\|`similar`\|`conflict`) | `match_class` | **NEW**, derived 3-state collapse (qw-eg3c). Our `match_type` is the **rich** enum (`exact_url`/`exact_same_originator`/`exact_different_originator`/`near_same_originator`/`near_different_originator`/`similar`) and is still returned unchanged. |
| `similarity_score` (0–1) | `similarity` (**0–100**) | Already existed. Percentage, not a fraction. |
| `quote_text` | `text` | Already existed. |
| `originator{ id, name, slug }` | `originator{ id, full_name, slug, sort_name_display }` | Already existed. |
| `url` | `url` | Already existed (`https://quotewise.io/q/<short_code>/`). |
| `existing_sighting_for_this_url` | `existing_sighting_for_this_url` | **NEW**, derived boolean. |
| `recommendation: "needs_user_decision"` | `recommendation` (`duplicate`/`new_version`/`new_quote`/`attribution_conflict`/…) **+ `match_source`** | We did **not** add `needs_user_decision`. Drive the two-button UI off `match_source == "similarity"` (and `match_class`), not a new recommendation value. |
| `search_metadata.error` | `search_metadata.error` | Now **always present** on a 200 (see error contract). |

### `match_class` mapping (stable)

| `match_class` | from `match_type` | UI |
|---|---|---|
| `exact` | `exact_url`, `exact_same_originator` | "Already collected" (single action) |
| `conflict` | `exact_different_originator`, `near_different_originator` | Attribution dispute — **not** the variant button (ADR-0002 routing guard) |
| `similar` | `near_same_originator`, `similar` | Two-button "Add sighting" vs "Add as variant" |

### Error contract (fixes qw-0psq.4)

- Every successful **200** now sets `search_metadata.error == false`.
- An internal failure sets `search_metadata.error == true` (with `recommendation: "new_quote"` as a safe fallback).
- A non-200 `application/problem+json` (RFC 9457) response also means "could not verify duplicates".
- The extension **must not** treat `search_metadata.error == true` **or** a non-200 as a healthy `new_quote` — replace the current client-fabricated fallback (`quotewise-api.ts:278-285`) with an explicit "couldn't verify" state.

### What the extension binds to

`match_class`, `match_source`, `existing_sighting_for_this_url`, `quote_id` (string), `text`, and `search_metadata.error`.
