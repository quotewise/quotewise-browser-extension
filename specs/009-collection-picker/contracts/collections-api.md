# API Contract (frozen) — Collections membership

This is the authoritative contract the extension depends on. Server-side implementation lives in `django-api` (separate beads issue, labels `chrome-ext,django-api`). All paths are versioned under `/v1/` (Article V.2). Auth: existing `Authorization: Bearer <token>`.

## NEW — Add an existing quote to a collection

```
POST /v1/collections/{collection_id}/quotes/
Authorization: Bearer <token>
Content-Type: application/json

{ "quote_id": "<existing quote id>" }
```

Responses:
| Status | Meaning | Extension handling |
|--------|---------|--------------------|
| `201 Created` | Quote added to collection | success |
| `200 OK` | Already a member (idempotent no-op) | success (treated identically) |
| `401` | Auth expired | surface re-login (existing path) |
| `403` | Not the user's collection | per-collection failure, retryable |
| `404` | Collection or quote not found | per-collection failure (drop stale id) |
| `5xx`/network | Transient | per-collection failure, retryable |

- **MUST be idempotent**: re-adding never duplicates membership and never returns a client error the user must resolve (FR-014).
- Called **once per target collection** (best-effort, per-collection feedback — FR-012/013). No bulk body required.
- No side effects beyond membership: MUST NOT create a sighting or attach a source URL (FR-009).

## CHANGED — Duplicate-check response gains membership detail

The existing duplicate-check response (`CHECK_DUPLICATE` → `GET`/`POST` duplicate endpoint) adds, per matched quote, the specific collections the quote is in:

```jsonc
{
  "matches": [
    {
      "quote_id": "abc123",
      "in_user_collections": true,        // existing boolean — unchanged
      "member_collections": [             // NEW — present only when in_user_collections is true
        { "id": "fav", "name": "Favorites" }
      ]
      // ...existing match fields...
    }
  ]
}
```

- `member_collections` is **optional/additive**: old extension builds ignore it; new builds treat its absence as "membership unknown → none" (Article V.2 — ignore unknown, missing = absent).
- Powers the "Already in: …" label (FR-007) and exclusion of already-member collections from the editable list (FR-010) in one round trip.

## REUSED — no contract change

- `GET /v1/collections/` (`listCollections()`) — list the user's collections. Served from the extension's `storage.local` cache when fresh (FR-022).
- `POST /v1/quotes/` (`submitQuote()`) with optional `collection_id` — new-capture path. For multi-collection new captures, the quote is created once (optionally with the first `collection_id`) and remaining collections are added via the membership endpoint above.

## Out of scope (this contract)
- Create-collection endpoint (inline-create deferred — spec Clarifications).
- Remove-from-collection / membership DELETE (web-app only — FR-011).
- Bulk/transactional multi-add.
