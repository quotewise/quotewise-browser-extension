# Research — Spec 003 (Twitter/X DOM Parsing & Captured-Data Usage)

Phase 0 of `speckit plan`. Resolves the open question from the spec/clarify: **is it safe to drop the
REMOVE-disposition fields from the submitted `platform_data`?** (FR-070 precondition.)

## Finding 1 — The Quotewise API ignores `platform_data` entirely (decisive)

**Decision**: Dropping `quote_count`, `retweeter_username`, `retweeter_display_name`, and
`reply_to_tweet_id` from the submitted `platform_data` is **100% safe**. More broadly, the **entire
`platform_data` object is silently ignored** by the current API.

**Evidence** (in `/Users/chris/code/quotewise-org/quotewise`):
- `quotewise/serializers/quote.py` — `QuoteCreateSerializer` (the `POST /v1/quotes/` contract) defines **no
  `platform_data` field**. Required: `text`, `originator_id`, `source_url`. Optional: `language_code`,
  `sighting_framing`, `attribution_type`, `quote_date`, `quote_date_is_approximate`, `collection_id`,
  `likes_count`.
- `quotewise/services/quotes/service.py` — `create_quote()` never references `platform_data` or any of its
  keys.
- `quotewise/models/quotesighting.py` — `QuoteSighting` stores `citation_json`, `likes_count`,
  `platform_code`, `platform_identifier`; `platform_data` is not persisted.

**Rationale**: A DRF serializer drops unknown input keys; `platform_data` is unknown, so it's accepted and
discarded. No validation depends on it, nothing persists it.

**Implication beyond FR-070**: every `platform_data.*` field the spec marked **KEEP** ("submitted") is
*sent but unused*. "Submitted" ≠ "used." The only engagement value the backend stores is the **top-level
`likes_count`** (not the `platform_data` mirror). This surfaces a decision (see plan §Decisions): keep
sending `platform_data` as future-proofing, trim it entirely, or coordinate backend persistence.

## Finding 2 — `quoted_tweet_id` (FUTURE) has no backend effect today

**Decision**: Defer populating `quoted_tweet_id` until the backend consumes `platform_data`. The DOM source
is available (in a quote tweet, the quoted tweet's `a[href*="/status/"]` carries a status id distinct from
the focal id), so extraction is feasible — but since the API ignores `platform_data`, populating it now is
inert. **Blocked on a backend change**, not on DOM work.

## Finding 3 — `originator_slug` vs serializer (flag, verify separately)

The agent read `QuoteCreateSerializer` requiring **`originator_id` (integer)**, while the extension now
submits **`originator_slug`** (this session's earlier work, with the backend dev confirming slug-accept
shipped). Either slug-accept lives in a code path the scan didn't surface, or there's a discrepancy.

**Action**: Out of scope for spec 003 (a parsing spec), but **verify** the deployed `POST /v1/quotes/`
actually accepts `originator_slug` (a quick live submit already worked end-to-end this session — see
`docs/twitter-dom-verification.md` history — so it is accepted in production; the serializer the scan found
may be stale or one of several). Track on the backend side if confirmed stale.

## Net effect on the plan

- **FR-070 cleanup** is safe and small (no backend coordination needed to *remove* fields).
- The bigger **"`platform_data` is entirely unused"** decision is cross-repo and is raised as a decision in
  `plan.md`, not silently actioned.
- `quoted_tweet_id` FUTURE is re-classified **blocked-on-backend**.
