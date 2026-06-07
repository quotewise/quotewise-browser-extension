# Phase 0 Research: Capture Overlay Tray (005)

All design tensions resolved. Best-practice items were verified against the official Chrome Extensions docs via
Context7 (`/websites/developer_chrome_google_cn_extensions`); algorithmic/UX items are grounded in the codebase and
constitution. No NEEDS CLARIFICATION remain (the spec's three Session-2026-06-07 clarifications are folded in).

---

## R1. Where to persist user settings — `chrome.storage.sync` (single object key)

**Decision**: Persist all four preferences under **one** `chrome.storage.sync` key named `settings`:
`{ privateMode: boolean, autoAddToCollection: boolean, defaultCollectionId: string | null, firstRunNoticeShown:
boolean }`. Wrap reads/writes in a typed `settings/settings-store.ts` that exposes `getSettings()`,
`updateSettings(partial)` (read-merge-write), and `onSettingsChanged(cb)`.

**Rationale**:
- Clarification 2026-06-07 mandates `chrome.storage.sync` (roams across the user's signed-in Chrome devices); the
  first-run notice therefore fires once per synced profile, not per install — this matches FR-043/SC-006.
- **Context7-verified quotas**: sync allows 512 items, 102 400 bytes total, **8 192 bytes/item**, **1 800 writes·
  hr⁻¹ / 120·min⁻¹**. A single small object costs 1 item and 1 write per change — orders of magnitude inside every
  limit, and avoids burning the per-item budget with four separate keys.
- The official storage example stores options under a single `options` object and reads it back with one `get` —
  we mirror that exactly.

**Alternatives considered**:
- *Four separate sync keys* — rejected: 4× the item/write pressure for no benefit, and partial-write race windows.
- *`chrome.storage.local`* — rejected: violates the explicit clarification (must roam) and the per-profile
  first-run semantics.
- *`chrome.storage.session`* — rejected: cleared on browser restart; settings must persist.

---

## R2. Keeping all surfaces in sync without a reload (FR-053) — `chrome.storage.onChanged`

**Decision**: Every context (service worker, content tray, options page) subscribes to
`chrome.storage.onChanged` and reacts when `area === 'sync' && changes.settings`. The writer just calls
`chrome.storage.sync.set({ settings })`; readers re-derive. No custom broadcast/message fan-out for settings.

**Rationale**:
- This is the **canonical Chrome pattern** (Context7: the options-page example pairs `storage.sync.set` on the
  options page with `storage.onChanged` in the service worker to "apply settings immediately"). It is event-driven,
  survives SW restarts, and inherently satisfies FR-053 / FR-092 ("takes effect across surfaces without manual
  reload") with zero polling.
- Toggling Private mode from the tray menu writes `settings`; the SW's `onChanged` listener re-resolves the toolbar
  (→ Paused) and the options page's listener updates its toggle — all from one write.

**Alternatives considered**:
- *`AUTH_STATE_SUBSCRIBE`-style message bus for settings* — rejected: re-implements what `onChanged` gives free,
  adds a port to keep alive, and misses cross-device updates that `onChanged` delivers natively.

---

## R3. Options surface — `options_ui` full page + open via the service worker

**Decision**: Register `"options_ui": { "page": "options.html", "open_in_tab": true }` in all three manifests.
Build `public/options.html` + a single-file `src/options/index.ts` webpack entry. The tray "Open settings" action
sends a new `OPEN_OPTIONS_PAGE` message; the **service worker** calls `chrome.runtime.openOptionsPage()`.

**Rationale**:
- Context7 confirms `options_ui` is the MV3 way; `open_in_tab: true` gives a full-page surface with room for the
  collection picker and account block (the spec calls it a "canonical settings/options page" reachable via
  "standard Chrome entry points" — Details → *Extension options* opens it either way).
- `chrome.runtime.openOptionsPage()` (Chrome 99+, returns a Promise; "never reloads the caller") is the official
  way to open it from other extension UI — but it is **not available in content scripts**. The tray is a content
  script, so it must message the SW, which owns the call. This is why a dedicated `OPEN_OPTIONS_PAGE` message exists
  rather than calling the API in the tray.
- No `html-webpack-plugin` is introduced — `options.html` is a static shell copied via the existing
  `copy-webpack-plugin`, keeping the build uniform and the bundle single-file (Constitution V.3).
- The toolbar icon click is **unchanged** (still opens the in-page overlay); no `default_popup` is added (FR-052,
  spec-004 contract preserved).

**Alternatives considered**:
- *Browser-action popup* — **explicitly out of scope** (spec) and would replace the icon-click overlay behavior.
- *`options_page` (legacy key)* — rejected: `options_ui` is the current MV3 recommendation and supports
  `open_in_tab`.
- *`open_in_tab: false` (embedded)* — viable, but the collection picker + account identity read better as a full
  page; embedded is cramped inside chrome://extensions. Chosen `true`.

---

## R4. Private mode gating — one global boolean checked at the preflight entry points

**Decision**: Gate the **automatic** network paths in `service-worker.ts` on `settings.privateMode`. When ON, the
SW makes **no** preflight/duplicate/originator call for passive browsing *or* on overlay open. The overlay instead
exposes an explicit **"Check now"** control (new `CHECK_NOW` message) that runs the lookups for the current tweet
only on activation. Default OFF (preload enabled).

**Gate points** (from the code map):
- `requestTweetDataExtraction()` / the `chrome.tabs.onUpdated` + `webNavigation.onHistoryStateUpdated` listeners —
  skip auto-extraction-driven preflight when Private mode is ON (no `currentTweet`-triggered lookups).
- `runAutomaticPreflightForExtractedTweet()` / `checkQuoteCollectionStatus()` — early-return when Private mode ON.
- `scheduleAutomaticOriginatorProbe()` — do not schedule when Private mode ON.

**Rationale**:
- Article II.1 requires exactly this switch ("a setting MUST exist to disable all pre-action network calls … honored
  globally when disabled"). Spec 005 makes it user-visible as "Private mode."
- Clarification 2026-06-07: with Private mode ON, **opening the overlay does not auto-lookup** — the overlay opens
  silent and shows "Check now". This is stricter than "no passive calls" and is captured by gating the overlay's
  open path too; the lookups are reachable only via the explicit `CHECK_NOW`.
- Toggling mid-session: turning ON stops subsequent checks immediately and re-resolves the toolbar to Paused;
  turning OFF resumes on the next tweet (edge cases in spec). The SW reads `settings.privateMode` per-decision (or
  caches it and refreshes via `onChanged`) so the toggle takes effect without reload.

**Alternatives considered**:
- *Gate only in the content tray* — rejected: the SW is where automatic preflight is scheduled; gating only the UI
  would still emit background requests (fails SC-005's "zero background requests").
- *Reuse the existing `settings.duplicateCheck` flag* — rejected: that in-memory SW setting is not user-controlled,
  not persisted to sync, and not the constitution's global preload switch. Private mode supersedes it.

---

## R5. Logout / "Clear my data" — centralized cache-key wipe, preference preservation, in-flight guard

**Decision**: Define the canonical **user-identifying cache key set** in one place (extend `storage-cleanup.ts`):
`currentTweet`, `preloadedOriginator`, `preloadedDuplicateCheck`, `lastAuthCheck`, `originator_search_history`, and
any per-user cache. Both **logout** and **"Clear my data"** clear this set from `chrome.storage.local` **plus** the
account-bound `settings.defaultCollectionId`. Both **preserve** the device prefs `privateMode`,
`autoAddToCollection`, `firstRunNoticeShown`. Logout additionally clears `oauth_*` tokens and cancels the
`token-refresh` alarm (existing `auth-flow.logout()` + `token-storage.clearTokens()`); "Clear my data" leaves login
state untouched.

**In-flight-after-logout guard**: a preflight/originator response that returns *after* logout MUST NOT repopulate
caches — the logged-out state wins (spec edge case). Implement by checking auth state (or a logout epoch/sequence)
before any post-logout cache write.

**Rationale**:
- Article II.2 + FR-031/033 mandate the wipe set and the manual clear-data affordance; Clarification 2026-06-07
  fixes precisely which keys survive vs. clear. Today `logout()` clears tokens + alarm but **does not** clear
  `preloadedOriginator`/`preloadedDuplicateCheck` (code map) — this feature closes that gap.
- Centralizing the key list prevents the two flows from drifting and gives the tests one source of truth.
- Article III.3: none of these flows may emit token/cookie/secret values into logs/errors/diagnostics (FR-034).

**Alternatives considered**:
- *`chrome.storage.local.clear()`* — rejected: would also wipe `authState` bookkeeping and any device-scoped local
  data indiscriminately; we clear a precise, tested key set instead.

---

## R6. Staged submit progress — debounced phase machine, reduced-motion aware

**Decision**: Model submit as an explicit phase machine `idle → checking → submitting → confirming →
success | error`. Render staged text only after a **~400 ms** debounce (reuse `utils/debounce.ts`); operations
faster than the window show no progress (just the final result). Suppress any spinner under
`prefers-reduced-motion` and convey progress by text alone. On error at any phase, show an honest error + retry and
**never** a success/"Done" state.

**Rationale**:
- FR-020..023 + SC-003. Today `action-button.ts` only flips to a single "Submitting…" label (code map) — there is
  no phasing, no debounce, no reduced-motion guard.
- The ~400 ms threshold is the spec's tunable starting point (Assumptions); it is the debounce window, validated for
  flicker-free fast captures.
- Honesty (VII.3): "Confirming…" precedes any success; success is shown only after the create call resolves.

**Alternatives considered**:
- *Always-on spinner* — rejected: flickers on fast captures and ignores reduced-motion.
- *Indeterminate %s* — rejected: dishonest precision; staged text reflects the actual steps.

---

## R7. Word-level diff — hand-rolled LCS util, no new dependency

**Decision**: Implement `utils/word-diff.ts` as a small, deterministic **LCS-based** word diff returning a token
list of `{ value, type: 'equal' | 'added' | 'removed' }`. Tokenize on whitespace (preserve word boundaries).
Render in `similar-diff.ts` with **typography/markers** for added/removed (e.g. underline + "＋", strike + "−"),
never color alone, honoring `prefers-contrast`. Show **no** similarity percentage; include a "view existing quote"
link from `matches[].url`/`short_code`. Show only for near matches (`recommendation === 'new_version'` family); if
`matches[].text` is absent, degrade to the existing read-only "similar version" badge.

**Rationale**:
- The on-record text needed for the diff is **already returned** by the API (`matches[].text`, similarity present
  but deliberately not shown) — code map confirms; this is client-only (FR-070..073, SC-008, Dependency "already
  available").
- **Article III.2 (dependency discipline)** + the repo's **zero runtime dependencies**: a ~50-line LCS over word
  tokens is well-bounded deterministic logic we can TDD (Article VI.1). Adding a library for this would need written
  justification for negative value. *(Per the project's Context7 rule, library docs were not consulted for a
  from-scratch algorithm — only for the Chrome APIs above.)*
- WCAG 1.4.1 (FR-072): diff differences must be decodable without color → markers + text, verified under simulated
  deuteranopia/protanopia and high-contrast (SC-008).

**Alternatives considered**:
- *`diff` (jsdiff) `diffWords`* — rejected: adds a runtime dependency (Article III.2) for logic we can own in ~50
  tested lines; provenance/footprint cost unjustified.
- *Character-level diff* — rejected: spec mandates **word-level**; char diffs are noisier for quote text.

---

## R8. Toolbar "Paused" state — minimal amendment to spec-004's single resolver

**Decision**: Add `ICON_STATES.Paused = { iconVariant: 'grey', badgeText: '‖', badgeColor: <neutral>, title:
'Quotewise — paused (private mode)', scope: 'global' }` to `config/icon-states.ts`. Add **one** branch to
`resolveIconPresentation()` immediately after the `UNAUTHENTICATED → LoggedOut` check (resolver line 45-47) and
before the `Loading` check (line 49): `if (privateMode) return ICON_STATES.Paused;`. Thread a `privateMode: boolean`
input into the resolver (added to `TabContext` or as a 4th param — see below).

**Precedence (FR-091)**: `Error → Logged-out → Paused → Loading → Auth-pending → Unsupported → Supported-idle →
quote-status badges`. Because `LoggedOut` returns first, a logged-out user never reaches Paused (correct: Paused is
a logged-in-but-paused signal); for all logged-in/pending states, Private mode ON wins over Loading/Auth-pending/
idle/quote-status — exactly the spec's ordering.

**Resolver input plumbing**: prefer a dedicated `privateMode` **parameter** on `resolveIconPresentation(auth, dup,
tab, privateMode)` because Private mode is **global**, not per-tab; folding a global into `TabContext` would
mis-signal scope. The SW reads `settings.privateMode` (cached, refreshed via `onChanged`) and passes it at every
`applyResolvedIconForTab` call site. *(Implementation may instead add it to `TabContext` if that minimizes call-site
churn; both satisfy FR-090/091 — the parameter form is the recommended, more honest shape.)*

**Rationale**:
- Spec scope boundary: 004 owns the resolver/table/precedence; 005 *adds* one state and its slot, folded back into
  004's contract, preserving the **single authoritative resolver** (no parallel logic).
- Grey owl already exists (`GREY_ICON_PATHS`); badge `‖` + title make it decodable by artwork+glyph, not color
  (FR-090, VII.2). Badge text is an image → the `setTitle` carries the meaning for AT.

**Alternatives considered**:
- *A new "paused" icon artwork* — unnecessary; grey owl + pause glyph is sufficient and reuses existing assets.
- *Resolving Paused in a separate pre-step outside the resolver* — rejected: violates the single-resolver contract.

---

## R9. Add earlier sighting (US9 / FR-080..083) — blocked on API, ships hidden

**Decision**: Implement the date-gate logic and UI **disabled/hidden** behind a capability check: offer "add as
earlier sighting of this similar quote" **only** when the matched record's **published date** is present in the API
response **and** the current tweet's posted date is strictly earlier. The matched record's **record-creation
timestamp MUST NOT** be used as a fallback. Until django-api adds the published date to `check_duplicate`/`preflight`
`matches[]`, the action stays hidden. Label it honestly as adding a **sighting** (not a "variant").

**Rationale**:
- Hard blocker documented in spec Dependencies (a): today only record-creation time is returned, which is not an
  acceptable provenance reference (code map: `matches[].originator` has birth/death years but no `quote_date`).
  Gating to hidden is honest degradation (Article V.2, VII.3), not a violation.
- Tweet posted date is already extracted (`TwitterData.date`), so the comparison input exists; only the *reference*
  date is missing.
- The backend folds a near match into a **sighting** today; "variant" intent needs Dependency (b) (submit intent
  param) — out of scope until then (FR-083, Out of Scope).

**Alternatives considered**:
- *Use record-creation time as a stand-in* — **explicitly forbidden** (FR-082); rejected.
- *Hide the whole near-match region until the API ships* — rejected: the **diff** (R7) is independently shippable
  now; only the add-sighting affordance is gated.

---

## R10. Removing metric chips while preserving developer diagnostics (FR-001/002)

**Decision**: Delete the `buildMetaChips()` row and its `#meta-row` markup/styles from `overlay-bar.ts`
(lines 410-433 + associated CSS/markup). Ensure the raw extracted metrics remain reachable through the existing
**`GET_DIAGNOSTICS`** message / `debugLog`, gated by `DEBUG_MODE` (`config/environment.ts:34`,
`[DEV]`/`[STAGING]`/NODE_ENV). Extraction itself (`TwitterData` incl. metrics + date) is **unchanged** (FR-003).

**Rationale**:
- FR-001 removes the chips from the tray; FR-002 keeps them for developers via the *existing* debug channel — no new
  user-facing surface. `TwitterData` still carries `likes/retweets/replies/views/bookmarks` + `platform_data`, so the
  diagnostics object already has them; we only stop *rendering* them in the tray.
- SC-001: production build shows zero metric chips; debug build keeps 100% inspectable.

**Alternatives considered**:
- *CSS-hide the chips in prod* — rejected: dead DOM + leak risk; the spec says **remove** the region.
- *Add a new debug-only metrics panel in the tray* — rejected: FR-002 says use the *existing* diagnostics channel,
  not a new UI.

---

## Cross-cutting confirmations

- **No new manifest permission** (FR-101, SC-010): `options_ui`, settings (`storage`), and collections (host access
  already granted) reuse existing permissions. Verified `cookies` is already absent from all three manifests.
- **No new runtime dependency** (Article III.2): the diff is hand-rolled; everything else uses platform/`chrome.*`
  APIs.
- **`splitChunks: false`** preserved; the new `options/index` entry bundles to a single file (Constitution V.3).
- **Accessibility baseline** (FR-100): all new controls keyboard-operable, ARIA-labelled, glyph/text-redundant,
  reduced-motion/contrast aware — verified per surface in the contracts.
