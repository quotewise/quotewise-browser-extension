# Automated store publishing

Tagging a release (`git tag v1.7.9 && git push origin v1.7.9`) builds both packages,
attaches them to the GitHub release, and submits them for review:

| Store | How | Credentials |
|---|---|---|
| Chrome Web Store | [CWS API v2](https://developer.chrome.com/docs/webstore/using-api) via `curl` in `.github/workflows/release.yml` | `CWS_*` repo secrets |
| addons.mozilla.org | `bun run sign:firefox` (`web-ext sign --channel=listed`) | `AMO_*` repo secrets |

Both **submit for review** — nothing goes live instantly. Each step no-ops if its
secrets are missing, so tagging works before this is set up.

## One-time: Chrome Web Store credentials

The Chrome item is `mkdijeljnpdejecbaogcjkkpbjfeakhn` (hardcoded in the workflow;
it is public, not a secret). Its Store listing and Privacy tabs must already be
filled in — the API cannot create a listing, only push new versions of one.

1. **2-Step Verification** must be on for the Google account that owns the CWS
   publisher. Google refuses to publish otherwise.
2. **Google Cloud project** — <https://console.cloud.google.com/projectcreate>.
   Any project works; a dedicated one keeps the consent screen uncluttered.
3. **Enable the API** — APIs & Services → Library → "Chrome Web Store API" → Enable.
4. **OAuth consent screen** — User type **External**. Fill in app name, support
   email, developer contact.
   **Then click PUBLISH APP** so the status reads *In production*. This is the
   step that bites: while the status is *Testing*, Google silently expires every
   refresh token after **7 days**, and the release job starts failing with
   `invalid_grant` a week after it last worked. The `chromewebstore` scope is not
   sensitive, so publishing needs no Google review.
5. **OAuth client** — Credentials → Create credentials → OAuth client ID →
   **Web application**. Under *Authorized redirect URIs* add
   `https://developers.google.com/oauthplayground`. Save the client ID and secret.
6. **Refresh token** — open the [OAuth Playground](https://developers.google.com/oauthplayground),
   gear icon → *Use your own OAuth credentials* → paste the client ID/secret.
   In the left panel's "Input your own scopes" box enter
   `https://www.googleapis.com/auth/chromewebstore` → Authorize APIs → sign in as
   the publisher account → *Exchange authorization code for tokens*. Copy the
   refresh token.
7. **Publisher ID** — CWS Developer Dashboard → Publisher → Settings.

## One-time: AMO credentials

<https://addons.mozilla.org/developers/addon/api/key/> → generate. You get a JWT
issuer (`user:12345:67`) and a secret. The secret is shown **once**.

## Repo secrets

`Settings → Secrets and variables → Actions`, or:

```bash
gh secret set CWS_CLIENT_ID
gh secret set CWS_CLIENT_SECRET
gh secret set CWS_REFRESH_TOKEN
gh secret set CWS_PUBLISHER_ID
gh secret set AMO_JWT_ISSUER
gh secret set AMO_JWT_SECRET
```

## Gotchas

- **Refresh tokens die after 6 months of disuse.** If releases go quiet for that
  long, redo step 6.
- **CWS API v1 is sunset 2026-10-15.** The workflow already uses v2
  (`chromewebstore.googleapis.com`); don't copy v1 snippets (`googleapis.com/upload/chromewebstore/v1.1/...`)
  from older blog posts.
- **The API returns HTTP 200 on failure**, with the reason in the body. The
  workflow's `check()` inspects the body — keep it if you edit those steps.
- A **new extension ID** (a fresh CWS item) means a new OAuth redirect URI for
  the backend to whitelist — see `docs/server-launch-adrs/ADR-0004-oauth-production-redirect-readiness.md`.
