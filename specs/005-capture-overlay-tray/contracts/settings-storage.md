# Contract: Settings Storage & Cross-Surface Sync

**Surfaces**: service worker, content tray, options page. **Backing**: `chrome.storage.sync`, key `settings`.

## Schema (authoritative)

```jsonc
// chrome.storage.sync["settings"]
{
  "privateMode": false,            // bool — Article II.1 preload switch; OFF = preload ON (default)
  "autoAddToCollection": false,    // bool — US7
  "defaultCollectionId": null,     // string | null — account-bound (cleared on logout/clear-data)
  "firstRunNoticeShown": false     // bool — FR-043 one-time notice flag
}
```

Reads MUST merge over `DEFAULT_SETTINGS` (forward-compat; missing field ⇒ default, never error — Article V.2).

## Module API — `src/settings/settings-store.ts`

```typescript
export async function getSettings(): Promise<Settings>;                 // get + merge over defaults
export async function updateSettings(patch: Partial<Settings>): Promise<Settings>;  // read-merge-write one object
export function onSettingsChanged(cb: (next: Settings, prev: Settings) => void): () => void;  // returns unsubscribe
```

- `updateSettings` performs a single `chrome.storage.sync.set({ settings })` (one write — quota-safe).
- `onSettingsChanged` wraps `chrome.storage.onChanged`, filtering `area === 'sync' && changes.settings`.

## Cross-surface propagation (FR-053, FR-092)

```
options page  --updateSettings({privateMode})-->  chrome.storage.sync
                                                        |
                                       chrome.storage.onChanged (area==='sync')
                                       /                |                 \
                              service worker        content tray       options page
                          (re-resolve toolbar)   (update account menu)  (reflect toggle)
```

No custom message bus for settings — `onChanged` is the single propagation channel (Context7 canonical pattern).
A change MUST take effect everywhere **without a manual reload**.

## Invariants

- **INV-1**: Exactly one sync item (`settings`). No per-field keys.
- **INV-2**: `privateMode` default is `false` (preload enabled) — honored globally by the SW gate when `true`.
- **INV-3**: Logout/clear-data set `defaultCollectionId → null` but leave the other three fields intact.
- **INV-4**: `firstRunNoticeShown` persists across SW restarts and across devices; once `true`, the notice never
  re-appears (FR-043/SC-006). No separate "automatic checks have run" setting exists; notice eligibility is derived
  on explicit overlay open from `authenticated && !privateMode && !firstRunNoticeShown`.

## Test contract (test-first)

- get returns defaults when unset; merges partial stored object over defaults.
- `updateSettings` issues exactly one `set` with the merged object; concurrent updates last-write-wins on the object.
- `onSettingsChanged` fires only for `area==='sync'` `settings` changes; ignores `local` changes and unrelated keys;
  unsubscribe stops callbacks.
- Quota sanity: serialized `settings` ≪ 8 192 bytes.
