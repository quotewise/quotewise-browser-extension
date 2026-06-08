# Contract: New Message Types (`src/types/chrome.ts` `MessageType`)

Additions to the existing typed message enum. All follow the existing `chrome.runtime.sendMessage` /
service-worker switch pattern (`service-worker.ts` `onMessage`). `sendResponse` typing keeps the existing
`any`-with-eslint-disable convention.

| MessageType                | Sender → Receiver        | Payload                                  | Response                              | FR |
|----------------------------|--------------------------|------------------------------------------|---------------------------------------|----|
| `OPEN_OPTIONS_PAGE`        | tray → SW                | —                                        | `{ ok: true }`                        | FR-051 |
| `CHECK_NOW`                | tray → SW                | `{ tweetId, handle, sourceUrl }`         | duplicate/originator result (as today)| FR-044 |
| `SETTINGS_GET`             | tray/options → SW *(opt)*| —                                        | `{ settings: Settings }`              | FR-053 |
| `SETTINGS_UPDATE`          | tray/options → SW *(opt)*| `{ patch: Partial<Settings> }`           | `{ settings: Settings }`              | FR-053 |
| `CLEAR_USER_DATA`          | options → SW             | —                                        | `{ ok: true }`                        | FR-033 |
| `LIST_COLLECTIONS`         | options → SW             | —                                        | `{ collections, default_collection_id }` | FR-060 |

> `SETTINGS_GET`/`SETTINGS_UPDATE` are **optional**: surfaces may read/write `chrome.storage.sync` directly via
> `settings-store.ts` and rely on `onChanged` (preferred, see settings-storage contract). The messages exist only if
> a surface needs the SW to perform a settings-derived side effect atomically. Prefer the direct + `onChanged` path.

## Existing messages reused (no change)

- `OAUTH_LOGOUT` — already routed; this feature **extends its handler** to also wipe the user-identifying cache set
  and null `defaultCollectionId` (see private-mode-and-toolbar contract), not the message shape.
- `CHECK_DUPLICATE` / `LOOKUP_ORIGINATOR_BY_HANDLE` / `SUBMIT_QUOTE` — reused; `CHECK_NOW` triggers the same
  duplicate/originator path on explicit user action under Private mode.
- `GET_DIAGNOSTICS` — reused to carry developer-only metrics (FR-002), `DEBUG_MODE`-gated.
- `SHOW_OVERLAY` — icon click still opens the overlay (FR-052); unchanged.
- `OPEN_POPUP` — legacy message path, if retained, is not used by toolbar icon-click and does not justify adding a
  `default_popup`.

## Routing rules

- `OPEN_OPTIONS_PAGE` handler calls `chrome.runtime.openOptionsPage()` (SW-only API; the tray cannot call it
  directly — see options-page contract).
- `CHECK_NOW` handler runs duplicate + originator lookup **only** for the supplied tweet; it is the sole network
  entry while `privateMode === true` and does **not** clear Private mode (toolbar stays Paused).
- `CLEAR_USER_DATA` handler clears `USER_IDENTIFYING_CACHE_KEYS` + nulls `defaultCollectionId`; does **not** touch
  tokens/login state (FR-033).

## Invariants

- **INV-1**: No message handler logs/echoes token/cookie/secret values (FR-034, Article III.3).
- **INV-2**: Handlers stay idempotent/re-entrant (safe under SW termination, Article V.1).
- **INV-3**: A `CHECK_NOW` for a tweet that was navigated away from is a no-op (stale tab/tweet guard).

## Test contract (test-first)

- `OPEN_OPTIONS_PAGE` invokes `chrome.runtime.openOptionsPage` exactly once.
- `CHECK_NOW` triggers exactly the duplicate + originator path for the given tweet and nothing else; leaves
  `privateMode` unchanged.
- `CLEAR_USER_DATA` removes the canonical key set, nulls `defaultCollectionId`, preserves device prefs and tokens.
