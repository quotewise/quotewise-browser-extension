# API Contract (frozen) — Collections membership

This is the authoritative contract the extension depends on. **Implemented** server-side (ADR-0006 backend resolution, bead `qw-si1t`). All paths are versioned under `/v1/` (Article V.2). Auth: existing `Authorization: Bearer <token>`.

## Add an existing quote to a collection (reuse existing **slug** endpoint)

```
POST /v1/collections/{slug}/quotes/
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
| `404` | Collection not found / not owned | per-collection failure (API never reveals another user's collection) |
| `400` | Missing/invalid quote (`QUOTE_NOT_FOUND`) | per-collection failure |
| `5xx`/network | Transient | per-collection failure, retryable |

- **Existing, idempotent endpoint** (no new endpoint): re-adding never duplicates membership and never returns a client error the user must resolve (FR-014).
- The extension uses the collection **slug** (from `GET /v1/collections/`) in the path, **never** the UUID `id`.
- Called **once per target collection** (best-effort, per-collection feedback — FR-012/013). No bulk body required.
- No side effects beyond membership: MUST NOT create a sighting or attach a source URL (FR-009).

## CHANGED — Duplicate-check response gains membership detail

The existing duplicate-check response (`CHECK_DUPLICATE` → `GET`/`POST` duplicate endpoint) adds, per matched quote, the specific collections the quote is in:

```jsonc
{
  "matches": [
    {
      "quote_id": "abc123",
      "in_user_collections": true,        // existing boolean — true iff member_collections is non-empty
      "member_collections": [             // ALWAYS present — [] when the quote is in none
        { "slug": "favorites", "name": "Favorites" }
      ]
      // ...existing match fields...
    }
  ]
}
```

- `member_collections` is **always present** (an empty array `[]` when the quote is in none of the user's collections); the extension reads it unconditionally, never as `undefined`. Older builds that don't know the field simply ignore it (Article V.2).
- Keyed by **slug** (not the UUID `id`). Powers the "Already in: …" label (FR-007) and exclusion of already-member collections from the editable list (FR-010) in one round trip.

## REUSED — no contract change

- `GET /v1/collections/` (`listCollections()`) — list the user's collections (each carries `slug`). Served from the extension's `storage.local` cache when fresh (FR-022).
- `POST /v1/quotes/` (`submitQuote()`) — new-capture path. The extension does **not** send `collection_id`; the field is UUID-validated by the backend. After submit returns the quote identifier as `version_id`, the extension adds the quote to every selected collection via the slug membership endpoint above. Zero selected → no membership calls.

## Out of scope (this contract)
- Create-collection endpoint (inline-create deferred — spec Clarifications).
- Remove-from-collection / membership DELETE (web-app only — FR-011).
- Bulk/transactional multi-add.
