# Quickstart: Collection Picker & Add-to-Collection

How to build, run, and validate this feature. Assumes the `django-api` contract (`contracts/collections-api.md`) is deployed to your target environment.

## Build & load
```bash
bun run dev          # webpack watch → dist/
# chrome://extensions → Developer mode → reload the unpacked dist/
bun run type-check
bun run lint
bun run test
```

## Manual validation (maps to spec Success Criteria)

1. **New-capture picker (US1 / SC-001)** — On a tweet with a *new* quote, signed in, not private: the picker shows your collections beside Capture. Tick a non-default collection, capture → quote lands only there; the next capture seeds from default/last-used (default unchanged).
2. **Empty state (US1 #3)** — With zero collections, the picker shows the "create one in the web app" empty state, not a blank list.
3. **Already-captured status + add (US2 / SC-002/003)** — On a tweet whose quote already exists: overlay shows "✓ In your collection" naming the collection(s); the editable list offers only collections it's not in; adding files membership only (verify no new sighting/source URL).
4. **Partial failure (SC-005)** — Force one collection add to fail (e.g. offline mid-add): successes are kept, the failed one is shown with Retry, overlay stays open; the captured quote still exists.
5. **Dropdown settings parity (US3 / SC-006)** — Toggle Auto-add / change default in the overlay dropdown → options page reflects the same value. Capture into a set, restart browser (and check a 2nd signed-in device) → picker pre-selects that set.
6. **Auth/private gating (SC-007)** — Logged out → Login affordance, no picker, no collection fetch. Private mode → no capture UI.
7. **Badge (SC-008)** — After an add, the toolbar icon shows the `InCollection` (✓) state.
8. **Idempotency (SC-009)** — Re-add a quote already in a collection → no duplicate, no error.

## Privacy check (Article II)
- Confirm `GET /v1/collections/` fires only when you open the picker — never on tweet-page load, in any setting state (Article II.1). The "disable pre-action network calls" setting governs the duplicate/originator preloads, not collections.
- Log out / enter private mode / use clear-data: confirm `collectionsCache` (storage.local) and `lastUsedCollectionSlugs` (storage.sync) are wiped.

## Automated tests to add (test-first for deterministic logic)
- `tests/content/ui/collection-seed.test.ts` — `seedSelection` precedence + stale reconcile; `partitionMembership`; `summarizeAdds`.
- `tests/settings/settings-store.test.ts` — `lastUsedCollectionSlugs` normalize/persist/clear; change-guarded write.
- `tests/api/quotewise-api.test.ts` — `addQuoteToCollection` (201/200 both success); `member_collections` parsed/absent-safe.
- Picker fixture characterization + badge resolver wiring.
