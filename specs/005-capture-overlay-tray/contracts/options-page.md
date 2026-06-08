# Contract: Options Page & Tray Account Menu

## Manifest registration (all three manifests — single-source rule)

```jsonc
"options_ui": {
  "page": "options.html",
  "open_in_tab": true        // full-page canonical settings surface
}
```

No `default_popup` is added — the toolbar icon click still opens the in-page overlay (FR-052). No new permission.

## Build wiring (`webpack.config.js`)

- Add entry `'options/index': './src/options/index.ts'` (single-file bundle; `splitChunks: false` preserved).
- Add a `copy-webpack-plugin` pattern copying `public/options.html` → `dist/options.html`.
- `options.html` loads `options/index.js` via `<script defer type="module">` (top-level await for
  `chrome.storage.sync.get`, per Context7 example).

## Options page surface (`src/options/index.ts`) — FR-050

Renders and wires:

| Control                     | Behavior | FR |
|-----------------------------|----------|----|
| Account identity            | Shows signed-in username (from auth state); shows logged-out state otherwise | FR-050.1 |
| Log out                     | Sends `OAUTH_LOGOUT`; on success reflects logged-out state | FR-030 |
| Private mode toggle         | `updateSettings({ privateMode })`; reflects current value; live via `onChanged` | FR-040/050 |
| Clear my data               | Sends `CLEAR_USER_DATA`; confirms honestly; does not change login | FR-033 |
| Default-collection picker   | `LIST_COLLECTIONS` → populate; preselect server `default_collection_id`; honest empty/error state | FR-060 |
| Auto-add toggle             | `updateSettings({ autoAddToCollection })` | FR-061/062 |

- Picker writes the chosen id to `settings.defaultCollectionId`. A stale id (not in list) shows no selection.
- Empty/failed collections list ⇒ picker shows an honest empty/error message and auto-add is effectively off
  (no silent submit failure) (FR-060, edge case).

## Tray account menu (`src/content/ui/components/account-menu.ts`) — FR-051

Lightweight menu opened from the tray. Exposes:
- **Log out** (sends `OAUTH_LOGOUT`)
- **Private mode** toggle (`updateSettings({ privateMode })`)
- **Open settings** (sends `OPEN_OPTIONS_PAGE` → SW calls `chrome.runtime.openOptionsPage()`)

The tray is a content script and **cannot** call `chrome.runtime.openOptionsPage()` directly — it MUST message the
SW (Context7-confirmed; the API is unavailable in content scripts).

## Accessibility (FR-100, Article VII.2) — both surfaces

- All controls keyboard-operable; visible focus states; ARIA labels/roles on toggles, buttons, menu.
- The account menu is a proper menu/disclosure with focus management and Escape-to-close; toggles announce state.
- Status conveyed by text/glyph, not color alone; honors `prefers-reduced-motion` / `prefers-contrast`.
- Honest copy: no dark patterns; "Clear my data" plainly states what it clears (cache, not login) (VII.3).

## Live sync (FR-053/092)

Both surfaces subscribe via `onSettingsChanged`. Toggling Private mode on the options page updates the tray menu and
re-resolves the toolbar (→ Paused) without reload, and vice-versa.

## Test contract (test-first / characterization)

- Manifests contain `options_ui` and no `default_popup`; toolbar `chrome.action.onClicked` still sends
  `SHOW_OVERLAY` to the active tab, and the legacy `OPEN_POPUP` message path is not used by icon-click.
- Options controls present and labelled; logout sends `OAUTH_LOGOUT`; clear-data sends `CLEAR_USER_DATA`.
- Picker preselects `default_collection_id`; empty/error list yields the honest empty/error state, and auto-add is
  inert on submit.
- Account menu logout sends `OAUTH_LOGOUT`; "Open settings" sends `OPEN_OPTIONS_PAGE` (never calls
  `openOptionsPage` from the content script).
- Changing Private mode in one surface updates the other via `onChanged` (no reload).
