# ADR-0008 — Firefox OAuth redirect URI (register the Gecko redirect on the OAuth client)

- **Status:** Accepted
- **Date:** 2026-07-15
- **Priority:** P2 — gates Firefox launch only (Chrome/Safari unaffected)
- **Related beads:** `qw-2kxt3` (Firefox WebExtension build target)
- **Builds on:** [ADR-0004](ADR-0004-oauth-production-redirect-readiness.md) (Chrome redirect readiness)

## Context

We are shipping the **same** WebExtension to Firefox (addons.mozilla.org) — no separate repo, no code fork. Firefox consumes a plain WebExtension zip like Chrome; only Safari needs the native Apple wrapper. The Firefox package is produced by `scripts/build-firefox.mjs` from the same `dist/` as Chrome, with Gecko-specific manifest tweaks.

The extension authenticates with **OAuth 2.0 Authorization Code + PKCE** via `chrome.identity.launchWebAuthFlow` against our own OAuth server. The redirect URI is derived at runtime — the extension now calls `chrome.identity.getRedirectURL('callback')` instead of hardcoding the Chrome host (`src/config/environment.ts`). That returns a **different host per browser**:

| Browser | `getRedirectURL('callback')` returns |
|---------|--------------------------------------|
| Chrome  | `https://<extension-id>.chromiumapp.org/callback` |
| Firefox | `https://<token>.extensions.allizom.org/callback` (token derived from `browser_specific_settings.gecko.id`) |

The Firefox add-on ID is fixed in the manifest: **`gecko.id = firefox@extensions.quotewise.io`** (`build-firefox.mjs`). This follows the in-family convention **`<platform>@extensions.quotewise.io`** — email-format (AMO rejects a bare reverse-DNS such as `io.quotewise.firefox`; it requires an email-format string or a GUID), with an `extensions.` subdomain that marks it a machine identifier rather than a mailbox (staying clear of the reserved `@quotewise.io` email-role namespace documented in the backend's `docs/architecture/09-email-and-domain-conventions.md`). Because the redirect host is derived from that ID, it is stable across builds — but it is **not** a `chromiumapp.org` URL, so the existing production OAuth client (which only allows `https://<prod-id>.chromiumapp.org/callback` per ADR-0004) will reject the Firefox flow at both the authorize and token-exchange steps.

The redirect URI is sent as `redirect_uri` in the authorize request **and** the token request, so both must match the registered value exactly.

## Decision (proposed)

Register the Firefox redirect URI on the **same** production OAuth client used by Chrome (same `client_id`, same public-PKCE config, same scopes — this is purely an additional allowed `redirect_uri`, not a new client):

```
https://<token>.extensions.allizom.org/callback
```

Everything else (client, PKCE-no-secret, scopes `quotes:read` `quotes:write` `collections:read` `collections:write`, refresh-token behavior) is **identical to ADR-0004** — this ADR only adds one redirect URI.

## Getting the exact redirect URI (chicken-and-egg, same shape as ADR-0004)

The `<token>` subdomain is derived by Firefox from `gecko.id`; we don't hand-compute it. Obtain the exact value once:

1. Build: `bun run build:firefox`.
2. Load `dist-firefox/` in Firefox via `about:debugging` → "This Firefox" → "Load Temporary Add-on".
3. In the extension console run `browser.identity.getRedirectURL('callback')` and copy the printed `https://<token>.extensions.allizom.org/callback`.
4. Send that exact URI to the backend to register on the production OAuth client.
5. Run the OAuth smoke test in Firefox: login → capture → submit → restart → token-refresh.

> The token is stable for a given `gecko.id`, so this is a one-time capture. If `gecko.id` ever changes, the redirect URI changes with it and must be re-registered.

## What we need from the backend

1. Add `https://<token>.extensions.allizom.org/callback` (exact value from the step above) to the allowed `redirect_uri` list on the **existing production OAuth client**.
2. No new client, no scope change, no PKCE change — confirm the Firefox redirect is accepted at both `/oauth/authorize` and `/oauth/token`.
3. Keep the redirect list tight: only the real Chrome ID host (ADR-0004) and this Firefox host.

## Consequences

- **Positive:** Firefox users authenticate with the same client/flow as Chrome; one extension codebase, one OAuth client.
- **Cost:** One additional `redirect_uri` entry; one Firefox smoke test. No schema or client changes.
- **Risk if skipped:** Firefox login fails silently at the redirect step even though the extension installs and runs.

## Acceptance

- Production OAuth client accepts the Firefox `extensions.allizom.org` redirect URI (and still only the pinned Chrome host from ADR-0004).
- Firefox OAuth smoke test passes end-to-end against production.
