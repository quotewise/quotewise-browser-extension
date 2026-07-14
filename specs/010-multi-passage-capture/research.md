# Research: Capture Multiple Passages from the Same Post (Spec 010)

Phase 0 output. Resolves the technical unknowns and records the best-practice decisions
(including Context7 consultation for the platform APIs this feature touches — the extension
has **zero runtime npm dependencies**, so the "packages" here are Chrome MV3 APIs, the DOM
Selection API, and the Jest/jsdom test stack).

---

## D1 — Text-scoped "already captured" classification (US1 core)

**Decision:** Make the duplicate classification **text-scoped**, not URL-scoped. Pass the current
selection text into `classifyDuplicateSighting` / `classifyMatchResolution`
(`src/utils/duplicate-status.ts`) and compare it (normalized — see D2) against the texts now
returned in `existing_sightings_for_url[]`. Block as `exact_sighting` only when the current
selection normalizes-equal to an existing passage; when the URL has captures but the selection is
new, return a non-blocking state that allows submit and drives the "adding another passage" copy.
For an exact match, resolve the "view quote" link from **that matched entry's** validated `web_url`
(the `existing_sightings_for_url[]` entry whose normalized text equals the selection), **not**
`matches[0]` (G2). Matching runs against the **returned set** (backend-capped at 50); a selection
matching a passage beyond the cap is not detectable client-side and falls through to submit, where
the backend deduplicates idempotently.

**Rationale:** The current block is the `existing_sightings_for_url.length > 0 → exact_sighting`
short-circuit (`duplicate-status.ts:29`) and the mirror at `:80`. The backend write path already
creates a distinct quote for distinct text at the same URL; the only blocker is this client
short-circuit. ADR-0007 (shipped) now returns every distinct quote at the URL **with text**, which
is exactly what the client needs to make the text-scoped decision locally.

**Alternatives considered:** (a) Server-side text-aware recommendation — rejected; ADR-0007
deliberately kept `recommendation`/`matches` unchanged and pushed the decision client-side, so
other clients are unaffected. (b) Rely on `matches[0]` — rejected; on a multi-passage URL the fast
path features the *earliest* quote in `matches[0]`, not necessarily the one the selection matches,
so the decision must use `existing_sightings_for_url[].text`, not `matches[0]`.

## D2 — Normalization for the "same passage" comparison

**Decision:** `normalizeQuoteText(s)` = `s.normalize('NFKC')` → collapse internal runs of whitespace
to a single space → `trim()`. Compare normalized selection to each normalized entry text; equality
= "already captured this passage." New pure helper in `src/utils/` (test-first).

**Rationale:** Mirrors the backend's `text_hash` normalization (NFKC + whitespace-collapse) so the
client's "same passage" decision agrees with what the backend would dedupe. `String.prototype.
normalize('NFKC')` is native (no dependency). If the client mis-allows, the backend is idempotent
(`sighting_added`), so the failure mode is a harmless no-op, never a duplicate quote.

**Alternatives considered:** Exact `===` after trim (spec-clarify option B) — rejected; trivial
whitespace/Unicode differences would read as "new," creating confusing `sighting_added` no-ops.
Case-insensitive (option C) — rejected; would wrongly merge case-distinct quotes.

## D3 — Selection-driven, contextual re-capture (US1 UX)

**Decision:** No persistent "capture another" control. Extend the existing selection watcher
(`startSelectionWatcher`, today gated to X Articles at `overlay-bar.ts` ~line 887) to **all posts**,
so a selection change re-runs the duplicate check and updates the preview + submit label. When the
URL already has captures and the current selection is new, the submit action reads "Capture another
passage" / "Add this passage" and a notice states the post already has a captured quote.

**Rationale:** ~99% of captures are single-quote; a persistent post-success button would tax the
common case (spec clarification 2026-07-02). Reusing the watcher keeps the common flow untouched —
if the user never re-selects, nothing changes. After a successful submit the overlay keeps its
current success→auto-hide behavior; the *next* passage is initiated by a new selection, not a button.

**Alternatives considered:** Persistent post-success button (option A) — rejected by the user.
Button-only (option C) — rejected; less fluid, still adds chrome to the common case.

## D4 — Toolbar badge count + accessibility (US2 / FR-009, FR-012)

**Decision:** When `existing_sightings_total >= 2`, show the count on the action badge via
`chrome.action.setBadgeText({ text, tabId })` (per-tab), formatted `1`–`9` then `9+`, with
`setBadgeTextColor` for contrast; reuse the existing collected/exists color. For `== 1` keep the
current single-capture glyph; for `0`, the "new" state. **Always** also set the action **title**
(`chrome.action.setTitle`) to a words phrase — e.g. "Quotewise — 3 passages captured from this post"
— because the badge text is **not** exposed to assistive tech.

**Rationale (Context7 — `/websites/developer_chrome_extensions_reference_api`):** `setBadgeText`
fits "only about four" characters and its text is **not** read by screen readers, whereas `setTitle`
"is also used by screen readers." So the numeric badge alone would violate Constitution Art. VII.2
(status must not be conveyed by glyph/color alone and must be screen-reader accessible); pairing it
with an explicit `setTitle` count satisfies the gate. `tabId` scopes the badge to the tweet's tab
and auto-resets when the tab closes.

**Alternatives considered:** Show the count at `>= 1` — rejected; a single capture is already the
existing ✓/= state, so the count only adds information at ≥2. Longer badge text (e.g. "3 quotes") —
rejected; ~4-char limit.

## D5 — Identifier-only passive preflight (Privacy / Art. II fix)

**Decision:** Make the **automatic (page-load) preflight** identifier-only. Remove
`text: postData.text` from the `automatic-preflight` `PREFLIGHT_CHECK` payload
(`service-worker.ts` ~L3558) so passive egress carries **no quote text / user content** — limited to
`handle` + `source_url` plus the non-identifying `platform` constant (redundant with `source_url`),
a subset of the Article II allowlist `{tweet_id, handle, source_url}`. The
badge count and passages panel read the URL-derived response fields (`existing_sightings_total`,
per-entry `text`/`web_url`) — these come back from `source_url` alone (ADR-0007), no text needed.
US1's per-passage exact match runs **locally** against the returned `existing_sightings_for_url[]`.
The **text-bearing** fuzzy/similarity lookup stays on the **explicit** overlay path
(`overlay-bar.ts checkDuplicate` → `CHECK_DUPLICATE`, which already sends `text` at L1918) and the
`explicit-duplicate-check` preflight site (~L3369, keeps `text`) — both are explicit user actions.
After a successful capture, invalidate `preloadedDuplicateCheck` so the count/panel refresh (FR-010).

**Rationale:** Art. II.1 (line 112) bounds pre-action egress to `{tweet_id, handle, source_url}` and
states quote **text** MUST leave only on an explicit action. The automatic preflight previously sent
`postData.text` on page load — a **pre-existing Article II violation**. Since `existing_sightings_total`
and the passage list are URL-derived, dropping the text costs nothing for US1's exact matching; it
only removes passive **fuzzy** ("similar") state from the toolbar icon before the user acts —
accepted tradeoff, and the fuzzy state resolves the instant the overlay opens or the user selects
(an explicit action where text egress is permitted). This turns "no new egress" into a genuine
**reduction** in egress and a privacy-policy-consistent fix.

**Alternatives considered:** (a) Keep passive text for pre-click fuzzy icon + amend the constitution
(interview option B) — rejected by the user; the feature doesn't need passive text and it exfiltrates
content the server can't otherwise fetch for protected/login-walled posts. (b) Narrow amend: passive
text only for public tweets (option C) — rejected; more code to thread a distinction the feature
doesn't require.

## D6 — API drift tolerance for the new fields (Resilience / Art. V)

**Decision:** Read all new fields defensively: missing `existing_sightings_total` → fall back to
`existing_sightings_for_url.length`; entry missing `text` → exclude it from the match set (never
crash); entry missing `web_url`/`short_code` → render the snippet without a link; unexpected shape →
degrade to the neutral "this post already has captures" state (FR-011). Validate `web_url` scheme
with the existing `safeHref` before rendering (Art. III), as `duplicate-badge.ts` already does.

**Rationale:** Art. V.2 mandates ignoring unknown fields, treating missing as absent, and degrading
rather than throwing when `api.quotewise.io` shape shifts under an installed build.

## D7 — Test strategy for selection + classification (Quality / Art. VI)

**Decision:** Split by what is under test:
- **Deterministic logic** — `normalizeQuoteText`, the text-scoped classifier, the matched-link
  resolver, and the badge-count resolution in `icon-state-resolver.ts` — is developed **test-first**
  (Art. VI.1), driven by plain data (no DOM).
- **DOM/Shadow-DOM behavior** — the `in-post-content` selection guard (now exercised on **ordinary
  posts** for the first time, not just X Articles) and the Shadow-DOM passages panel — is
  characterized against **captured-HTML fixtures**: one ordinary post and one X Article captured
  from live X into `tests/fixtures/` (Art. VI.2). The pure selection-*text* value can still use the
  existing `window.getSelection()` stub, but which container counts as "in-post content" is
  DOM-structure-dependent and MUST be asserted against real captured markup.

**Rationale:** Constitution VI.2 (line 244) mandates that DOM extraction and Shadow-DOM UI be tested
via **characterization tests against captured HTML fixtures**, not red-first against live X. This
feature newly runs the in-post-content guard on ordinary posts, whose DOM differs from Articles;
a jsdom stub cannot catch a container-selector mismatch that a captured fixture would. This closes
analyze finding C3. (Context7 — `/jsdom/jsdom`: jsdom v30 implements Selection APIs, but
`Selection.toString()` over arbitrary ranges is unreliable, reinforcing fixture-based structural
assertions over synthesized selection ranges.) Verify the stub shape against `tests/setup.ts`; add a
small fixture-loader helper if none exists.

## D8 — Badge count plumbing (where the number comes from)

**Decision:** Thread `existing_sightings_total` (or `existing_sightings_for_url.length` fallback)
from the duplicate-check result through `mapRecommendationToQuoteStatus` / a new sibling in
`duplicate-status.ts` into `resolveIconPresentation` (`icon-state-resolver.ts`) and out to
`icon-applicator.ts`'s `setBadgeText`/`setTitle`. `service-worker.ts` already caches the
duplicate-check result and drives the resolver/applicator — extend that path, don't add a new one.

**Rationale:** Keeps the single existing resolve→apply pipeline (Art. V idempotent, rebuildable
badge state) rather than introducing a parallel badge path.
