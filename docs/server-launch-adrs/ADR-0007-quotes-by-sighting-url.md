# ADR-0007 — Duplicate-check: return all distinct quotes for a sighting URL (text + link)

- **Status:** 🔵 Proposed (backend ask; unresolved) — extension spec 010, US2.
- **Date:** 2026-07-02
- **Priority:** P2 (fast-follow feature; **not** launch-gating)
- **Related beads:** `qw-1jzc` (check_duplicate: return all distinct quotes for a sighting URL — text + link)
- **Endpoints:** `POST /v1/quotes/check_duplicate/` (**extend** `existing_sightings_for_url`) — primary. Alternative considered: a dedicated `GET` by-URL list endpoint (rejected below).
- **Builds on:** [ADR-0001](ADR-0001-duplicate-check-match-provenance.md) (duplicate-check match payload) · [ADR-0006](ADR-0006-collections-membership.md) (`member_collections` in the same response) · extension spec 010 (`specs/010-multi-passage-capture/`)

## Context

Spec 010 lets a user capture **multiple distinct passages** (verbatim selections) from a single post — a long tweet, a thread, or an X Article — instead of the current "one capture per URL" behavior, where the overlay shows "Already Captured" and disables Submit on any second selection.

**The write path already supports this** and needs no change. A `Quote` is deduplicated on normalized-text + originator (`quotekey`), **not** on `source_url`; `QuoteSighting`'s uniqueness is `(quote, sighting_url)`. So one source URL can host many distinct quotes, submitting a different text at the same URL creates a new distinct `Quote` + `QuoteSighting` (`action="created"`), and re-submitting identical text is idempotent (`action="sighting_added"`).

**The read path is the only gap.** The extension calls `check_duplicate` on every overlay open, but it cannot see more than one quote per URL:

1. `check_quote_duplicate()` populates `existing_sightings_for_url` from a single `.first()` then `existing_sightings.clear()`/`append` (`quotewise/services/quotes/service.py`). For authoritative platforms (X/Twitter) it then **returns early** with `recommendation="duplicate"` — **without comparing the submitted text**. The Step 3 loop that would append *all* sightings is dead code once Step 0 has populated one entry. Net: **at most one** entry is ever returned.
2. `_format_sighting_info()` returns `sighting_id, quote_id, sighting_url, platform_code, likes_count, originator, created_at` — **no quote text and no link** (`short_code`/`web_url`).

Because of (1) and (2), the extension cannot:

- **(US1)** distinguish *"the submitted selection exactly matches a passage already captured here"* (→ block as already-captured) from *"this URL has other, different passages, but this selection is new"* (→ allow the capture). Today any prior sighting at the URL collapses to `recommendation="duplicate"` regardless of the submitted text.
- **(US2)** render an accurate *"N passages captured from this post"* panel (snippet + link per quote) or a passage **count** on the toolbar badge.

The response serializer already types `existing_sightings_for_url` as an untyped `ListField(child=DictField())` (`quotewise/serializers/quote.py`), so **adding fields and entries is non-breaking**.

## Decision (proposed)

Extend `existing_sightings_for_url` on the **existing** `check_duplicate` response to carry the full set, with text and a link:

```jsonc
// POST /v1/quotes/check_duplicate/  → 200
"existing_sightings_for_url": [
  {
    "quote_id": "482931",
    "text": "the verbatim captured passage text",   // NEW — enables client-side exact match + snippet
    "short_code": "aB3dK",                            // NEW — for linking (or web_url)
    "web_url": "https://quotewise.io/quotes/aB3dK",    // NEW — absolute link (nullable)
    "sighting_url": "https://x.com/user/status/123",
    "originator": { "id": 17, "full_name": "…" },
    // …existing fields (sighting_id, platform_code, likes_count, created_at)
  }
  // …one entry per DISTINCT quote sighted at this source_url
],
"existing_sightings_total": 3   // NEW — total distinct quotes at the URL (if the list is capped)
```

1. **Return every distinct quote sighted at `source_url`**, deduplicated by quote (the `(quote, sighting_url)` constraint already means at most one sighting per quote per URL). Remove the `.first()`/`clear()` truncation and populate the full set **on the authoritative fast path too**, before its early return.
2. **Add `text`** (verbatim) **and a link** (`short_code` and/or `web_url`) to each entry.
3. **Keep `recommendation`/`matches` semantics unchanged.** The extension performs the exact-passage decision **client-side** by comparing the submitted selection text against the returned passage texts — so no change to the backend's recommendation logic is required, and other clients are unaffected. (If a mis-classification ever slips through, the write path is idempotent — a re-submitted identical passage becomes a `sighting_added` no-op, never a duplicate quote.)
4. **Bound the payload.** Cap the list (e.g. first 50) and include `existing_sightings_total` so the extension can show "+N more."

**Alternative considered — a dedicated `GET /v1/quotes/?source_url=` (or `/v1/sightings/by-url/`) list endpoint.** Rejected as the primary: `check_duplicate` already runs on every overlay open with the `source_url` in hand, so extending its response avoids a second round trip and keeps the passage list, the exact/new signal, and `member_collections` (ADR-0006) in one call. A dedicated endpoint would be reasonable if the payload growth proves problematic.

## What we need from the backend

1. `existing_sightings_for_url` returns **every distinct quote** sighted at the submitted `source_url` (dedupe by quote) — fixing the `.first()`/`clear()` truncation and populating the full set even on the authoritative fast path that returns early. Guard against N+1 (single `select_related`/`prefetch` query across sightings).
2. Each entry adds **`text`** (verbatim quote text) and a **link** (`short_code` and/or `web_url`), alongside the existing fields (`_format_sighting_info`).
3. Additive, **v1**, back-compat: no change to `recommendation`, `matches`, or the single-sighting case; older extension builds that read only `existing_sightings_for_url.length` keep working.
4. **Bound** the list (documented cap) and add `existing_sightings_total`.
5. Confirm quote `text` is safe to include here (it is public quote content, already exposed via `matches[].text` and the quote pages) and that this list keeps its current scope (sightings of the URL, not user-scoped).

## Consequences

- **Positive:** Unblocks spec 010 US2 (passages panel + toolbar count) and sharpens US1 (the extension can tell an already-captured passage apart from a new one at a known URL, instead of blanket-blocking the whole URL). Turns an existing, under-used response field into the single source for "what's already here."
- **Cost:** A slightly larger `check_duplicate` payload for URLs with several distinct quotes (bounded by the cap). `text` inclusion is public data; no new privacy surface beyond what `matches[]` and quote pages already expose.
- **No write-path or model change** — the multi-quote-per-URL capability already exists; this is additive read-path work only.

## Acceptance

- For a `source_url` with **N** distinct captured quotes, `check_duplicate` returns **N** entries in `existing_sightings_for_url` (up to the cap, with `existing_sightings_total` = N), each including `quote_id`, verbatim `text`, and a `short_code`/`web_url` link.
- A URL with **one** captured quote returns **one** entry; a URL with **none** returns `[]`.
- Existing `recommendation`/`matches` behavior and the single-sighting response are unchanged; the query does not regress into N+1.
