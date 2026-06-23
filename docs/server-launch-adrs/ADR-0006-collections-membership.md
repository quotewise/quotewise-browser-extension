# ADR-0006 — Collections: add an existing quote to a collection + membership in duplicate-check

- **Status:** ✅ Backend resolved 2026-06-22 (bead `qw-si1t`) — **supersedes the `{id}` proposal below**: reuse the existing **slug**-keyed add endpoint; `member_collections` is `{ slug, name }`. See [Backend resolution](#backend-resolution-2026-06-22).
- **Date:** 2026-06-22
- **Priority:** P1 (fast-follow feature; **not** launch-gating)
- **Related beads:** `qw-si1t` (Collections membership API: add existing quote to collection + member_collections in duplicate-check)
- **Endpoints:** `POST /v1/collections/{slug}/quotes/` (**existing**, reused) · `POST /v1/quotes/check_duplicate/` (extend) · reuses `GET /v1/collections/`, `POST /v1/quotes/`
- **Builds on:** [ADR-0001](ADR-0001-duplicate-check-match-provenance.md) (duplicate-check match payload) · disclosure rides [ADR-0005](ADR-0005-privacy-policy-data-disclosure.md)

## Context

Spec 009 adds a per-capture collection picker and an "add to my collection" path for already-captured quotes. Two backend gaps block it:

1. There is no way to add an **already-existing** quote to a collection. `POST /v1/quotes/` only files a *new* quote (optional `collection_id`); the extension's API client has `listCollections()` but no add-to-collection method. When a quote is already in Quotewise (the "already captured" block state), the user currently has no way to collect it.
2. The duplicate-check response says *whether* a matched quote is in the user's collections (`in_user_collections`) but not **which** collections. The overlay needs the specific collection ids + names to label "✓ In your collection: …" and to exclude already-member collections from the add list.

The extension already binds to the duplicate-check `matches[]` payload (ADR-0001): `quote_id` (string), `match_class`, `in_user_collections`.

## Decision (proposed)

### 1. NEW — add an existing quote to a collection

```jsonc
// POST /v1/collections/{collection_id}/quotes/   (Bearer auth)
// body:
{ "quote_id": "482931" }     // the string id echoed from check_duplicate / POST /v1/quotes/

// → 201 Created  (added)
// → 200 OK       (already a member — idempotent no-op)
```

- **Idempotent**: re-adding never duplicates membership and never returns a client error the user must resolve.
- **Membership only**: MUST NOT create a sighting and MUST NOT attach a source URL. "Add to collection" means exactly that.
- The extension calls it **once per target collection** (best-effort, per-collection success/failure feedback); no bulk body required.
- `403` if the collection is not the requesting user's; `404` for a missing collection or quote.

### 2. EXTEND — membership detail in duplicate-check

Add `member_collections` to each `matches[]` entry, alongside the existing `in_user_collections`:

```jsonc
// POST /v1/quotes/check_duplicate/  → 200
"matches": [
  {
    "quote_id": "482931",
    "in_user_collections": true,                  // existing boolean — unchanged
    "member_collections": [                        // NEW — the user's collections this quote is in
      { "id": "17", "name": "Favorites" }
    ]
    // …existing fields (match_class, text, originator, url, …)
  }
]
```

- Additive/optional: present only when the quote is in ≥1 of the requesting user's collections; older extension builds ignore it (missing = absent).
- Ids echoed verbatim (the extension treats collection `id` as an opaque string, like `quote_id`).

## What we need from the backend

1. Implement `POST /v1/collections/{id}/quotes/` per above (idempotent add; membership only; owner-scoped).
2. Add `member_collections: [{ id, name }]` to `check_duplicate` matches, scoped to the requesting user's memberships (single query — avoid N+1 across matches).
3. Keep it **v1** and additive/back-compat (no breaking changes to `listCollections()` / `POST /v1/quotes/`).

## Backend resolution (2026-06-22)

Implemented under bead `qw-si1t`. Two findings change the proposal above; **this section is authoritative where it conflicts**.

**1. No new endpoint — reuse the existing slug-keyed add endpoint.**
`POST /v1/collections/{slug}/quotes/` already exists and already does an idempotent, membership-only add (`201` on add, `200` if already a member; never duplicates membership; creates **no** sighting and **no** source URL). Collections are identified by their **slug** — the canonical public identifier, unique per user. The extension MUST use the collection **slug** (from `GET /v1/collections/`) in the path, **not** the UUID `id`:

```jsonc
// POST /v1/collections/{slug}/quotes/   (Bearer auth)
{ "quote_id": "482931" }     // → 201 added · 200 already-member (idempotent)
```

**2. `member_collections` carries `{ slug, name }` (not `{ id, name }`).**
Slug is the canonical identifier everywhere; the new field does not expose collection `id`.

```jsonc
"member_collections": [ { "slug": "favorites", "name": "Favorites" } ]
```

- **Always present** — an empty array `[]` when the quote is in none of the user's collections (read it unconditionally; never `undefined`).
- `in_user_collections` is `true` **iff** this array is non-empty (the two are derived from one query).

**Error semantics (as implemented — codebase conventions, not the proposal's 403/404):**
- Collection not owned by the caller → **`404`** (not `403`): the API never reveals that another user's collection exists.
- Missing/invalid quote in the body → **`400`** (`QUOTE_NOT_FOUND` validation error), not `404`.

**Why slug, not id:** slug is uniqueness-guaranteed per user+collection and is already the canonical public identifier across the API (originators, MCP). Short-lived/internal clients should be mandated onto slug rather than handed opaque ids. The existing UUID `id` that `GET /v1/collections/` still emits is left untouched but should be ignored by the extension.

## Consequences

- **Positive:** Unblocks spec 009 — one-off collection picking for new captures, and collecting already-captured quotes, both from the overlay. The membership detail also lets the toolbar badge show real "in your collection" state.
- **Privacy / disclosure (rides ADR-0005):** The extension now (a) fetches the user's collection list on explicit picker open, (b) caches it in `chrome.storage.local`, and (c) syncs a "last-used collections" set via `chrome.storage.sync`. Per Article II.3 this MUST be reflected in the privacy policy / store listing (spec 009 task **T025**). The collection list is fetched **only on explicit user action**, never as a passive pre-action call (Article II.1).
- **Cost:** One new endpoint + one derived field; slightly larger duplicate-check response when the user has collected the matched quote. `member_collections` MUST only ever expose the **requesting user's own** collections.

## Acceptance

- `POST /v1/collections/{id}/quotes/` returns `201` on add and `200` when already a member, never duplicating membership, and creates no sighting and no source-URL record.
- `check_duplicate` matches include `member_collections` (id + name) for matched quotes the user has filed; absent/empty when none.
- Endpoints are `/v1/` versioned, Bearer-authed, owner-scoped (`403` / `404` as specified).
