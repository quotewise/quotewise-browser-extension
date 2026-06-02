# Chrome Web Store Pre-Ship Review

Reviewed: 2026-04-21

This is a pre-ship punch list for getting the Quotewise Chrome extension ready for public Chrome Web Store submission. It is based on a source, manifest, build artifact, and test review of this repository.

## Verdict

Close, but do not submit the public Chrome Web Store build yet.

This does not look like a long rewrite. It is a short hardening pass: likely 1-3 focused days, plus one real Chrome/OAuth smoke test using the production extension ID.

## Must Fix Before Store Submission

### 1. Privacy disclosures are a blocker

The extension handles user data:

- Tweet text
- Selected quote text
- Tweet author and handle
- Tweet URL
- Engagement metrics
- Protected tweet flag
- OAuth auth state and tokens
- Submitted quote data

Chrome Web Store policy requires an accurate privacy policy and matching Developer Dashboard privacy fields. The current repo still has old publishing notes that reference session cookies and `quotosaurus.com`, while the implementation now uses OAuth and `quotewise.io`.

Relevant repo references:

- `docs/delivery/1-mvp/1-13.md`
- `src/auth/token-storage.ts`
- `src/platforms/twitter/adapter.ts`
- `src/content/ui/overlay-bar.ts`

Required action:

- Update the public privacy policy.
- Update Chrome Web Store privacy fields to match actual behavior.
- Disclose that the extension reads only supported Twitter/X tweet pages, extracts quote-related page data, sends selected/captured data to Quotewise, and stores OAuth tokens in Chrome extension storage.
- Remove outdated cookie-auth language.
- Include an affirmative limited-use statement if applicable.

### 2. Remove unjustified permissions

`manifest.prod.json` currently declares:

- `activeTab`
- `storage`
- `cookies`
- `identity`
- `alarms`
- `webNavigation`
- `scripting`

`cookies` is declared but unused in `src`. `activeTab` also appears unused. Chrome review expects the narrowest permissions necessary for the extension's single purpose.

Required action:

- Remove `cookies` unless there is a current, test-covered production reason.
- Remove `activeTab` unless needed.
- Verify whether `web_accessible_resources: ["content/*"]` is actually required. Exposing the content bundle to Twitter/X pages may be unnecessary.
- Prepare permission justifications for every remaining permission:
  - `storage`: OAuth tokens, auth state, current tweet/preflight cache.
  - `identity`: OAuth PKCE login via `chrome.identity.launchWebAuthFlow`.
  - `alarms`: token refresh and auth checks.
  - `webNavigation`: Twitter/X SPA route detection.
  - `scripting`: reinject content script on Twitter/X SPA navigation.
  - host permissions: `quotewise.io` API calls and Twitter/X tweet-page capture.

### 3. Lock down OAuth production redirect/client config

`src/config/environment.ts` says the OAuth redirect pattern allows:

```text
https://*.chromiumapp.org/callback
```

That is acceptable for early development, but too broad for a public release. The OAuth client ID also looks placeholder-like and needs confirmation.

Required action:

- Register the actual Web Store extension ID.
- Use exact production redirect URI or exact approved extension IDs.
- Confirm the OAuth client ID is the real production client.
- Confirm staging/dev clients cannot be used in production.

### 4. Run a real production OAuth smoke test

The automated suite passes, but it cannot prove:

- `chrome.identity.launchWebAuthFlow` works with the production extension ID.
- The live OAuth client accepts the redirect.
- Token exchange succeeds.
- Token refresh succeeds after access token expiry.
- Quote submission succeeds against production API.

Required action:

- Build production.
- Load the production artifact in Chrome.
- Authenticate with a real Quotewise account.
- Capture a real public Twitter/X tweet.
- Submit quote.
- Verify the quote/sighting in Quotewise.
- Restart Chrome and confirm auth state restores.
- Force or wait for token refresh and confirm the user is not logged out.

## Should Fix Before Public Launch

### 5. Fix version and release drift

Versions are currently inconsistent:

- `manifest.prod.json`: `1.4.6`
- `package.json`: `1.4.4`
- checked-in `manifest.json`: `1.4.2`
- `package-lock.json`: `1.0.0`

Required action:

- Fix `scripts/bump-version.js` to update `manifest.prod.json`, `manifest.dev.json`, `manifest.json`, `package.json`, and `package-lock.json`.
- Add a release check that fails if versions are inconsistent.
- Decide which manifest is canonical for store upload.

### 6. Trim the upload artifact

The production build emits `.d.ts` and `.d.ts.map` files because `tsconfig.json` has declaration output enabled. This is not usually a rejection by itself, but it increases review surface and makes the package noisier than necessary.

Required action:

- Package only the files needed by Chrome:
  - `manifest.json`
  - `background/service-worker.js`
  - `content/index.js`
  - `icons/*`
- Consider a dedicated packaging script, for example `npm run package`, that builds and zips only those files.

### 7. Avoid `innerHTML` for API-provided links

Several UI components use `innerHTML`. Most dynamic text is escaped, but API-provided URLs are still assembled into HTML attributes.

Relevant files:

- `src/content/ui/components/duplicate-badge.ts`
- `src/content/ui/components/originator-lookup.ts`
- `src/content/ui/components/quote-preview.ts`
- `src/content/ui/overlay-bar.ts`

Required action:

- Use `document.createElement`, `textContent`, and `setAttribute`.
- Validate API-provided URLs with `new URL(...)`.
- Allow only expected `https://quotewise.io/...` links where practical.
- Add `rel="noopener noreferrer"` on external links.

### 8. Use alarms, not `setInterval`, for service worker cleanup

`src/background/storage-cleanup.ts` uses `setInterval`. In Manifest V3, service workers are ephemeral and timers can be canceled when the worker terminates.

Required action:

- Convert periodic storage cleanup to `chrome.alarms`.
- Register the alarm listener at top level.
- Keep cleanup best-effort and idempotent.

## Good News

The extension is fundamentally in decent shape for review:

- Uses Manifest V3.
- Has a service worker background architecture.
- Uses OAuth 2.0 Authorization Code + PKCE rather than session-cookie scraping.
- Uses bearer tokens without `credentials: "include"`.
- Keeps host permissions scoped to Quotewise and Twitter/X.
- Has a focused, user-triggered overlay capture flow.
- Has tests around API auth, token refresh, Twitter extraction, validation, and UI components.

## Local Verification Run

These commands passed locally:

```sh
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
```

Jest result:

```text
17 test suites passed
224 tests passed
```

Production webpack build completed successfully.

Additional local checks:

- No `eval`, `new Function`, or remote hosted executable code found in production bundles.
- Production `dist/manifest.json` is generated from `manifest.prod.json`.
- `cookies` permission is present in production manifest but unused in source.

## Store Listing Checklist

Before submission, prepare:

- Accurate single purpose statement.
- Accurate short and long description.
- Current screenshots showing the overlay on a Twitter/X tweet page.
- Explanation of why the extension needs access to Twitter/X and Quotewise.
- Privacy policy URL.
- Developer support/contact information.
- Dashboard data-use declarations matching the implementation.
- Permission justifications matching `manifest.prod.json`.

## Policy References

- Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Chrome extension permission declaration guidance: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Chrome permission warning guidance: https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
- Manifest V3 service worker migration guidance: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers

