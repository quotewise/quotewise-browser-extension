# Data Model: Collection Picker & Add-to-Collection

Phase 1. Extension-side shapes only (the backend owns Collection/membership persistence; see `contracts/collections-api.md`).

## Entities & stored shapes

### Settings (extends existing — `chrome.storage.sync`, key `settings`)
```ts
interface Settings {
  privateMode: boolean;
  autoAddToCollection: boolean;        // existing — governs picker seeded vs blank (FR-020)
  defaultCollectionId: string | null;  // existing — default destination (FR-017 fallback)
  lastUsedCollectionIds: string[];     // NEW — full last-used set (FR-016/018); default []
  firstRunNoticeShown: boolean;
}
```
- Validation/normalize: `lastUsedCollectionIds` coerced to `string[]` (drop non-strings); deduped. Reconciled against the live collection list at seed time, not at write time (R5).
- Lifecycle: written once per completed add when the set changes (R2); wiped (→ `[]`) on logout/private/clear-data (FR-024).

### Collection-list cache (`chrome.storage.local`, key `collectionsCache`)
```ts
interface CollectionsCache {
  collections: Collection[];           // { id, name, slug, description, is_default, quote_count, ... } (existing type)
  default_collection_id: string | null;
  ts: number;                          // epoch ms; fresh if now - ts < ~5 min (FR-022)
}
```
- Populated on explicit picker open (NOT page-load preload; Article II.1, FR-022/FR-023). Rebuildable disposable cache (Article V). Wiped on logout/private/clear-data (FR-024).

### Staged picker selection (in-memory, overlay only — not persisted)
```ts
interface PickerState {
  available: Collection[];             // from cache/list
  alreadyIn: { id: string; name: string }[]; // read-only "Already in" (existing-quote path), from member_collections
  checked: Set<string>;                // staged selection; seeded by seedSelection() (R5)
}
```
- Never written until the explicit capture/add action (FR-005). Discarded on overlay close.

### Add result (in-memory)
```ts
interface CollectionAddResult { collectionId: string; ok: boolean; error?: string }
```
- Aggregated by `summarizeAdds()` → drives the per-collection success/failure + retry UI (FR-012/013/015).

## Type changes (`src/types/api.ts`)
- `DuplicateMatch.member_collections?: { id: string; name: string }[]` — NEW, optional (absent on old responses).
- `AddToCollectionRequest { quote_id: string }`, `AddToCollectionResult { success: boolean; alreadyMember?: boolean; error?: string }` — NEW.

## Message type (`src/types/chrome.ts`)
- `MessageType.ADD_QUOTE_TO_COLLECTION` — content → background → `addQuoteToCollection(collectionId, quoteId)`.
- Reuses existing `LIST_COLLECTIONS` (served from cache when fresh) and `SUBMIT_QUOTE` (new captures, with `collection_id`).

## State transitions (already-captured quote → membership)
```
duplicate-check → match.member_collections present
  → partitionMembership() → { alreadyIn (read-only), addable (checkboxes) }
  → user checks subset → explicit "Add"
  → one ADD_QUOTE_TO_COLLECTION per checked id (idempotent)
  → summarizeAdds() → full success: confirm + auto-hide + badge=InCollection
                    → partial: stay open, per-collection retry
```
