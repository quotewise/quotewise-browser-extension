# Contract — API consumption (client side)

**Source of truth:** `docs/server-launch-adrs/ADR-0001` (read) and `ADR-0002` (write), deployed & frozen 2026-06-20. This file lists only the subset the extension binds to, plus client coercion rules. The client MUST ignore unknown fields and degrade when documented fields are absent (Article V).

## Read — `POST /v1/quotes/check_duplicate/` response (consumed fields)

Top level:
- `recommendation: string` — legacy routing fallback when `match_class` absent.
- `matches: Match[]`
- `existing_sightings_for_url: object[]` — existing exact-URL sighting signal.
- `search_metadata.error: boolean` — **`true` ⇒ "couldn't verify"** (block + retry). Always present on 200.

`Match` (first match drives routing):
- `quote_id: string` — stringified integer; coerce to int for `link_to_quote_id`.
- `text: string` — matched quote text (render inline + diff).
- `url: string` — existing quote page URL (render only if `https:`).
- `short_code: string` — fallback to build URL.
- `similarity: number` — 0–100.
- `quote_date: string` — for sighting date-gating.
- `match_source: 'url' | 'similarity'` — provenance.
- `match_class: 'exact' | 'conflict' | 'similar'` — routing key.
- `existing_sighting_for_this_url: boolean`.
- `sighting_status`, `in_user_collections` — existing, unchanged.

Non-200 / network failure ⇒ treat as `search_metadata.error === true` (couldn't verify). Do **not** fabricate a healthy `new_quote`.

## Write — `POST /v1/quotes/` request (added fields)

Co-required pair (send both or neither — FR-005), only when resolving a `similar` match:
- `link_to_quote_id: number` — `parseInt(match.quote_id, 10)`.
- `user_intent: 'sighting' | 'variant'`.

Everything else unchanged (`text`, `originator_slug`, `source_url`, `platform_code`, `likes_count`, `quote_date`, `collection_id?`, `attribution_type`, `platform_data`).

## Write — response (consumed)

- `action: 'sighting_added' | 'created'` — drives confirmation copy ("Sighting added" / "Added as variant").
- Existing success/error envelope (`success`, `message`, `error`, `collectionWarning`) unchanged.
- Error responses are RFC 9457 problem+json: `403` (quote not visible), `400` (unknown `link_to_quote_id` / incomplete pair) → surface a clear, retryable error; create no partial record.

## Message pass-through (`SUBMIT_QUOTE`)

`api-handler.ts` MUST forward `link_to_quote_id` + `user_intent` from the content message into `submitQuote`, and return `action` in the result so the overlay can confirm correctly.
