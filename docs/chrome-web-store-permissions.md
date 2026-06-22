# Chrome Web Store — Permission Justifications

Paste-ready justifications for the CWS Developer Dashboard ("Privacy practices" → permission
justifications). Mirrors `manifest.prod.json` exactly as of v1.6.2. Keep this file in sync with
the manifest; the narrowest-necessary set is enforced by `tests/manifest-icon-runtime.test.ts`.

Relates: pre-ship review item #2 (`README-pre-ship-review.md`), beads `qw-o6aj`, `qw-0psq.17`.

## Single purpose

Capture a quote from a social post the user is viewing and save it to their Quotewise library
with attribution. The extension acts only when the user explicitly triggers a capture.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Store the user's OAuth access/refresh tokens and auth state, plus a short-lived cache of the current post and its duplicate-check result, in `chrome.storage.local`. Signing out clears the tokens. |
| `identity` | Perform OAuth 2.0 Authorization Code + PKCE login via `chrome.identity.launchWebAuthFlow`. No client secret; redirect is `https://<EXTENSION_ID>.chromiumapp.org/callback`. |
| `alarms` | Schedule token refresh before access-token expiry and periodic auth checks. Used instead of timers because the MV3 service worker is ephemeral. |
| `webNavigation` | Detect in-page (SPA) route changes on the supported social hosts so the overlay knows when a new post is in view. |
| `scripting` | Re-inject the content script after SPA navigation via `chrome.scripting.executeScript({files})`. |

## Host permission justifications

| Host pattern | Justification |
|---|---|
| `https://*.quotewise.io/*` | Call the Quotewise API to authenticate, run duplicate checks, and submit the captured quote/sighting. |
| `https://twitter.com/*`, `https://x.com/*` | Read the focal tweet the user chose to capture (text, author, link, public engagement counts). |
| `https://threads.com/*`, `https://*.threads.com/*`, `https://threads.net/*`, `https://*.threads.net/*` | Read the focal Threads post. Subdomain patterns cover the `www.threads.com` host that live permalinks redirect to. |
| `https://bsky.app/*` | Read the focal Bluesky post. |
| `https://substack.com/*`, `https://*.substack.com/*` | Read the focal Substack Note. |

## Data use (must match the hosted privacy policy at https://quotewise.io/privacy/)

- **Website content** — the quote text, author/handle, link, and public engagement counts of the
  post the user chooses to capture.
- **Authentication information** — OAuth tokens stored locally to keep the user signed in.
- **Not collected:** "user activity" in the CWS sense (no clickstream, scroll, or keystroke
  monitoring). Limited Use applies: data is not sold, not used for ads, and not used for any
  purpose beyond capturing quotes into the user's library.

## Permissions intentionally NOT requested (review continuity)

Removed during pre-ship hardening; do not re-add without a test-covered reason:

- `cookies` — extension uses OAuth Bearer tokens, never website cookies.
- `activeTab` — capture targets are reached via declared `content_scripts` + `scripting`, not `activeTab`.
- `web_accessible_resources` — the content bundle is delivered via `content_scripts` and
  `chrome.scripting.executeScript({files})`; nothing is fetched from the page context
  (`splitChunks:false`, no `chrome.runtime.getURL`), so `content/*` is not exposed to host pages.
