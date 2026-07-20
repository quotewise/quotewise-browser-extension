# ADR-0005 — Privacy policy + data-handling disclosure update

- **Status:** ✅ Implemented & deployed 2026-06-20 · Remaining: CWS dashboard Privacy-practices tab (`qw-0psq.16`) + permission justifications (`qw-0psq.17`) — dashboard tasks, not code. "Quotosaurus LLC" confirmed as the intended legal entity.
- **Date:** 2026-06-19 (proposed) · 2026-06-20 (deployed & verified)
- **Priority:** P1 — **LAUNCH-GATING** (Chrome Web Store requirement)
- **Related beads:** `qw-0psq.15` (update hosted privacy policy), `qw-0psq.16` (CWS Privacy practices tab)

## Context

The Chrome Web Store **requires** an accurate, hosted privacy policy for any extension that collects or transmits user data — which this one does. Good news: the backend **already hosts** the pages:

- `quotewise/urls.py` → `path("terms/", …)`, `path("privacy/", …)`
- `templates/quotewise/privacy.html`

The problem is **content accuracy**. Per the 2026-04-21 pre-ship review, the existing publishing/privacy language still references the old `quotosaurus.com` domain and **session-cookie** auth. The extension has since moved to `quotewise.io` and **OAuth 2.0 Bearer tokens** (no cookies/CSRF). A privacy policy that does not match actual behavior is itself a rejection/enforcement risk.

## Data the extension actually handles (must be disclosed)

Reads from the page (Twitter/X): tweet text, author username/display-name/verified/avatar URL, engagement metrics, tweet date, tweet URL, protected-tweet flag.

Stores in `chrome.storage.local`: OAuth access/refresh tokens (+ expiries, scopes), `currentTweet`, `preloadedOriginator`, `preloadedDuplicateCheck`, a short-lived `collectionsCache`, recent originator search history. Synced settings include collection defaults and the `lastUsedCollectionSlugs` convenience list. Logout/private-mode/clear-data clears user-data caches and collection selections; logout clears tokens.

Transmits to `https://api.quotewise.io` (Bearer auth): captured quote text, originator slug, source URL, social handle, platform — to `/v1/quotes/`, `/v1/quotes/check_duplicate/`, `/v1/quotes/preflight/`, `/v1/originators/by-handle/`. On explicit collection picker/settings open, fetches the user's collection names/slugs from `/v1/collections/`; on explicit add/capture, sends selected collection slug(s) to `/v1/quotes/` and `/v1/collections/{slug}/quotes/`.

## Decision (proposed)

Update the hosted `/privacy/` (and `/terms/` as needed) to:

1. Remove all stale `quotosaurus.com` and **session-cookie** language; describe **OAuth 2.0 Bearer** auth and `quotewise.io`.
2. Describe **what** the extension reads, stores (incl. OAuth tokens in extension storage), and transmits, and **to where** (`api.quotewise.io`).
3. State the **purpose** (building the user's personal quote library) and an affirmative **limited-use** statement: data is **not sold**, **not used for advertising**, and **not used for any purpose unrelated to the extension's single purpose**.
4. State **retention** (how long captured data and tokens are kept; that logout/clear-data removes local caches/tokens).
5. Be reachable at a **permanent public URL** (not behind login) — this URL goes into the CWS "Privacy policy URL" field (`qw-0psq.16`).

The wording must match the CWS Privacy-practices tab disclosures so the two are consistent. The applicable data types are **website content** and **authentication information** (OAuth tokens); do **not** declare **user activity**, which CWS defines as behavioral monitoring (clicks, scroll, keystroke logging) that this extension does not perform.

## What we need from the backend

1. Update `templates/quotewise/privacy.html` content per the above (and `/terms/` if it references the extension).
2. Confirm the canonical public privacy-policy URL to enter in the dashboard.

## Consequences

- **Positive:** Clears the single most common first-submission rejection trigger and keeps disclosures truthful.
- **Cost:** Content edit only; no schema change.

## Acceptance

- `/privacy/` accurately describes OAuth Bearer auth, `quotewise.io`, the data flows above, retention, and limited-use — with no `quotosaurus.com`/cookie references.
- The URL is public and entered in the CWS Privacy practices tab, consistent with the declared data types.
