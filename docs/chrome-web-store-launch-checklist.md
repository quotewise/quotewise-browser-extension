# Chrome Web Store — Launch Checklist

Single-page gate for the v1 public launch. **Beads epic `qw-0psq` is canonical** — this doc is a
generated snapshot (2026-07-18) for handing to a reviewer. When status here and beads disagree,
beads wins. Regenerate from `bd show qw-0psq`.

**Submission status (2026-07-18):** listing is a **Draft** in the CWS dashboard.
Item ID = `mkdijeljnpdejecbaogcjkkpbjfeakhn`. Store-listing **copy is done**; graphic assets,
the client P1 bugs, and the OAuth smoke test are what remain (see below).

Companion docs: [`chrome-web-store-listing.md`](./chrome-web-store-listing.md),
[`chrome-web-store-assets-plan.md`](./chrome-web-store-assets-plan.md),
[`chrome-web-store-permissions.md`](./chrome-web-store-permissions.md),
[`chrome-web-store-privacy-practices.md`](./chrome-web-store-privacy-practices.md).

## Gate 1 — Client code must-fix (blocks submit)

- [x] `qw-0psq.1` (P0) Double-submit re-entrancy guard in `submitQuote()`
- [ ] `qw-0psq.2` (P1) Overlay dead-Submit when `refresh()` returns null; media-only tweet wrong message
- [ ] `qw-0psq.3` (P1) Overlay ignores `SESSION_EXPIRED` / `INSUFFICIENT_PRIVILEGES` mid-action
- [ ] `qw-0psq.5` (P1) Overlay a11y: focus-on-open, aria-live status region, inert on hide
- [ ] `qw-0psq.7` (P1) Overlay failure-path tests (submit-failure/Retry, double-click, auth-expiry, null-refresh)

## Gate 2 — Backend launch dependencies

- [x] `qw-0psq.15` (P1) Hosted privacy policy updated for OAuth + extension data (PR #177, verified live)
- [x] `qw-0psq.25` (P1) Backend support for multi-platform quote capture
- [~] `qw-0psq.23` (P1) Gate low-reputation adds into moderation queue (`visibility=PENDING`) — *in progress*
- [ ] `qw-0psq.26` (P1) Extension adapters + live audits for multi-platform capture
- [~] `qw-0psq.22` (P2) check_duplicate provenance + sighting-vs-variant submission (ADR-0001/0002) — *in progress*

## Gate 3 — CWS submission paperwork

- [x] `qw-0psq.19` (P2) CWS developer account + draft item created (ID `mkdijeljnpdejecbaogcjkkpbjfeakhn`)
- [~] `qw-0psq.18` (P2) Listing **copy done**; **assets pending** — ≥1 screenshot 1280×800 (hard blocker), 128px store icon (dashboard flags guidelines), 440×280 promo tile (recommended)
- [ ] `qw-0psq.16` (P1) Fill Privacy practices tab (paste-ready in privacy-practices.md; policy unblocked) — confirm done in dashboard
- [ ] `qw-0psq.17` (P1) Permission justifications (identity, webNavigation, scripting, host)

## Gate 4 — Production validation

- [ ] `qw-0psq.20` (P1) Production OAuth smoke test with the real extension ID `mkdijeljnpdejecbaogcjkkpbjfeakhn`
  - Redirect `https://mkdijeljnpdejecbaogcjkkpbjfeakhn.chromiumapp.org/callback` is **already whitelisted**
    by the backend OAuth client's wildcard `https://*.chromiumapp.org/callback` (migration 0090, `environment.ts:178`),
    so no per-ID registration is needed — this is now just the runtime round-trip: login → capture → submit →
    verify → restart Chrome (auth restores) → force token refresh (stays logged in).
  - Verify the **prod** OAuth DB has a real seeded client, not the placeholder-looking `OAUTH_CLIENT_ID`
    (`environment.ts:179`). See `docs/server-launch-adrs/ADR-0004-oauth-production-redirect-readiness.md`.

## Hardening — not launch-blocking (P2/P3)

- [ ] `qw-0psq.4` (P2) Backend outage masquerades as healthy `new_quote` in overlay
- [ ] `qw-0psq.6` (P2) Neutralize `javascript:` URIs in API-provided href (defense-in-depth)
- [ ] `qw-0psq.11` (P3) Gate console.error that dumps full API error body in prod
- [ ] `qw-0psq.12` (P3) Narrow host permission `*.quotewise.io` → `api.quotewise.io`
- [ ] `qw-0psq.9` (P3) Remove unused `web_accessible_resources` content/* block
- [ ] `qw-0psq.10` (P3) Stop emitting `.d.ts`/`.d.ts.map` into `dist`
- [ ] `qw-0psq.13` (P3) Reconcile manifest versions, delete dead root manifest.json, add release tag
- [ ] `qw-0psq.14` (P3) Clean repo cruft (test-popup files, orphan nested .beads)

## Submit mechanics (once Gates 1–4 pass)

1. `bun run build` → `dist/` (webpack copies `manifest.prod.json` → `dist/manifest.json`).
2. Zip `dist/` and upload to the CWS Developer Dashboard.
3. Note the assigned extension ID → register the production OAuth redirect URI on the backend, then run `qw-0psq.20`.
4. Fill **Store listing** (listing.md + assets), **Privacy practices** (privacy-practices.md), **Permissions justification** (permissions.md).
5. Remote code: answer **"No, I am not using remote code."**
6. Submit for review.
