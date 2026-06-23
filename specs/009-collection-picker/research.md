# Research: Collection Picker & Add-to-Collection

Phase 0. The spec + interview resolved most unknowns; this records the few that needed external/codebase confirmation. Source for platform limits: context7 `/websites/developer_chrome_extensions_reference_api` (Chrome Extensions API reference).

## R1. Where to store the last-used set vs the collection-list cache

**Decision**: Last-used set + auto-add/default → `chrome.storage.sync` (extend existing `Settings`). Collection-list cache → `chrome.storage.local` with a ~5 min TTL, populated on explicit picker open (NOT page-load preload — Article II.1 limits pre-action requests to `{tweet_id, handle, source_url}`).

**Rationale**: `storage.sync` is the documented home for cross-device user *settings*; the last-used set is a preference and must sync (FR-018). The collection list is a *cache* of server state — disposable and rebuildable, so it belongs in `storage.local` (Article V), and putting a cache in sync would waste the sync quota and write budget.

**Alternatives considered**: All-in-sync (rejected — cache churn against the sync write budget); in-memory-only cache (rejected — lost on every SW restart, defeating "instant picker"; `storage.local` survives restarts and is still rebuildable).

## R2. `storage.sync` write-rate / quota safety for last-used writes

**Decision**: Write the last-used set at most once per *completed* add, and only when the set actually changed (compare before writing). Treat a write failure as non-fatal (degrade silently — last-used is a convenience).

**Rationale**: context7 confirms `storage.sync` limits: **120 writes/min, 1800 writes/hour (over-limit writes fail immediately)**; total **100 KB**, **8 KB/item**, **512 items**. One write per add — coalesced into the existing settings object, guarded by an equality check — is far under the rate limit even for fast capture runs, and a `string[]` of collection slugs is well under 8 KB. No debounce machinery needed beyond the change-guard. *ponytail: change-guard, add debounce only if a real rapid-write path appears.*

**Alternatives considered**: Debounced writer / write queue (rejected — unnecessary given one write per human-paced add); writing on every checkbox toggle (rejected — staged selection means we only persist on the committed action).

## R3. Membership endpoint (resolved by backend — ADR-0006)

**Decision**: Reuse the **existing** slug-keyed `POST /v1/collections/{slug}/quotes/` (no new endpoint), one call per target collection. For new captures, `POST /v1/quotes/` accepts a collection **slug** in `collection_id`: file the first selected collection there and the rest via the slug endpoint. `listCollections()` already exists.

**Rationale**: ADR-0006's backend resolution confirmed the add endpoint already exists, is idempotent and membership-only, and is keyed by **slug** (the canonical public identifier); the UUID `id` is ignored. One call per collection enables best-effort per-collection feedback (FR-012/013). The extension still needs a new client method `addQuoteToCollection(slug, quoteId)`.

**Alternatives considered**: A new `{id}`-keyed endpoint (the original spec proposal — superseded by the resolution); bulk `{ quote_ids: [...] }` body (rejected — best-effort per-collection model). Errors are `404` (not-owned) / `400` (`QUOTE_NOT_FOUND`).

## R4. Surfacing which collections already hold a quote

**Decision**: `member_collections: [{ slug, name }]` per match in the duplicate-check response (one round trip), **always present** (empty `[]` when none); the extension reads it unconditionally and keys on slug.

**Rationale**: The overlay needs both to label "Already in: …" (FR-007) and to exclude already-member collections from the editable list (FR-010). The existing `in_user_collections` boolean is insufficient (no slugs/names). ADR-0006 made the field always-present and slug-keyed, so the picker reads it without an `undefined` guard. Old builds ignore the field (Article V.2).

**Alternatives considered**: Separate `GET /v1/quotes/{id}/collections/` on picker open (rejected — extra round trip + loading state); boolean-only (rejected — can't name or exclude); `{ id, name }` (superseded — slug is canonical).

## R5. Deterministic logic to develop test-first (Article VI.1)

**Decision**: Extract pure functions into `collection-seed.ts`:
- `seedSelection(lastUsedSlugs, defaultSlug, autoAddOn, available)` → initial checked set of **slugs**, applying precedence last-used → default → blank and dropping slugs not in `available` (stale reconcile).
- `partitionMembership(match, allCollections)` → `{ alreadyIn, addable }` for the already-captured picker, keyed on slug (`member_collections` is always an array).
- `summarizeAdds(results)` → `{ succeeded, failed }` for the partial-failure UI.

**Rationale**: These encode the spec's trickiest branch logic (FR-017, FR-010, FR-012/013) and are the natural test-first units; keeping them pure keeps the picker component thin and the SW/messaging idempotent. Badge resolution already lives in the tested `icon-state-resolver.ts` and only needs the post-add state wired through.

**Alternatives considered**: Inline logic in `collection-picker.ts` (rejected — untestable without DOM fixtures and harder to reason about).
