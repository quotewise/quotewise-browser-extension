# ADR-0004 — OAuth production redirect / client readiness

- **Status:** Proposed
- **Date:** 2026-06-19
- **Priority:** P1 — **LAUNCH-GATING**
- **Related beads:** `qw-0psq.20` (production OAuth smoke test)

## Context

The extension authenticates with OAuth 2.0 Authorization Code + PKCE via `chrome.identity.launchWebAuthFlow` against **our own** OAuth server (not Google sign-in — so no Google OAuth verification is required). The redirect URI is derived at runtime from the extension ID:

```
https://<extension-id>.chromiumapp.org/callback
```

During development the extension ID is unstable and `src/config/environment.ts` allows a broad redirect pattern (`https://*.chromiumapp.org/callback`). **This is too broad for production** and the production extension ID is not known until the item is first created in the Chrome Web Store dashboard.

Scopes requested by the extension: `quotes:read`, `quotes:write`, `collections:read`, `collections:write`. Refresh tokens are stored in `chrome.storage.local` with a ~90-day refresh window (`token-storage.ts`).

## Decision (proposed)

1. **Pin the production redirect URI** to the real Web Store extension ID once known: `https://<prod-extension-id>.chromiumapp.org/callback`. Remove/disallow the wildcard `*.chromiumapp.org` redirect for the production OAuth client.
2. **Confirm the production OAuth client is a public PKCE client** (no client secret shipped in the extension — the `clientId` in `environment.ts` is a public identifier and is correct to ship; verify it is the *production* client, not a placeholder/staging one).
3. **Isolate environments:** staging/dev OAuth clients must not be accepted in production, and vice versa.
4. **Confirm refresh-token behavior:** lifetime, rotation policy, and that a refresh after access-token expiry succeeds without forcing re-login (the extension's alarm-driven `token-refresh.ts` depends on this).
5. **Confirm scope set** matches what the backend grants for the above scopes.

## Sequencing note (chicken-and-egg)

The production extension ID is assigned when the item is first created in the CWS dashboard. Practical order:
1. Create the item in the dashboard (no public submit yet) to obtain the stable extension ID.
2. Register `https://<id>.chromiumapp.org/callback` on the production OAuth client (this ADR).
3. Run the full production OAuth smoke test (`qw-0psq.20`).
4. Submit for review.

## What we need from the backend

1. Add the production redirect URI for the real extension ID; tighten the allowed redirect list.
2. Confirm production `client_id`, PKCE (no secret), and scope grants.
3. Confirm refresh-token rotation/lifetime and that staging/dev clients are isolated.

## Consequences

- **Positive:** Closes the one auth gap that 408 passing tests cannot prove; prevents a production login failure at launch.
- **Cost:** Minor config; one coordinated smoke test.

## Acceptance

- Production OAuth client accepts only the real extension ID redirect URI.
- Smoke test (`qw-0psq.20`) passes end-to-end against production: login → capture → submit → restart → token-refresh.
