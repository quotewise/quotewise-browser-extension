# Feature Specification: Capture Overlay Tray — Cleanup, Privacy, Progress & Variant Flow

**Feature Branch**: `005-capture-overlay-tray`

**Created**: 2026-06-07

**Status**: Draft

**Input**: User description: "Iterate the in-page capture-overlay-tray (X/Twitter): remove developer-only tweet
metrics from the UI; add privacy controls (logout + a 'Private mode' that pauses all background network calls) with
a one-time first-run notice; add a canonical settings/options page plus a lightweight tray account menu; give slow
requests staged progress feedback; pin the refresh/close controls to the top-right of the whole tray; and turn the
'similar but not exact' match into an actionable, provenance-aware flow built on a word-level diff. Keep auth/Private
state synchronized with the spec-004 toolbar icon, adding a new 'Paused' ambient state."

## Overview

The in-page **capture-overlay-tray** is the Shadow-DOM bar injected on X/Twitter tweet pages when the user opens the
extension. It is where a user reviews the captured quote and submits it. In this spec, **tray** means that injected
Shadow-DOM bar; **overlay** / **open overlay** refers to the tray when it is visible to the user. This spec (005)
governs the **tray itself**, a **new settings/options page**, and the **privacy controls** layered over the capture
flow.

It delivers five themes:

1. **Declutter** — remove the developer-oriented tweet-metric chips from the tray; preserve the raw metrics for
   developers only, via the existing debug diagnostics channel.
2. **Privacy & account control** — surface the existing logout flow, and add a **Private mode** that pauses *all*
   capture/pre-action background network activity (the user-controlled-preload control mandated by the constitution),
   with an honest one-time first-run notice on the first eligible overlay open.
3. **Progress** — show staged status feedback for captures that take longer than a moment.
4. **Predictable controls** — pin the refresh/close controls to the top-right of the whole tray.
5. **Provenance-aware "similar" flow** — replace the read-only "similar version" badge with a **word-level diff**
   and a date-gated "add earlier sighting" action.

### Scope boundary

- **Spec 004 — Toolbar Icon** owns the `chrome.action` icon/badge. 005 only *drives one addition* to it: a new
  **Paused** ambient state (grey owl + pause glyph) shown while Private mode suppresses background checks. The
  authoritative icon resolution, state table, and precedence remain spec-004's contract; 005 specifies the new state
  and its precedence slot, to be folded into spec 004.
- **Spec 002 — Sighting Status UI** owns the overlay's coarse sighting-status badges. 005 extends the
  **similar/duplicate region** of the tray with the diff + add-sighting action; where the two overlap, the diff flow
  refines (does not replace) 002's badges.
- **Spec 003 — Twitter DOM Parsing** owns extraction. 005 does **not** change what is extracted; it only changes
  what the tray *displays*.

### Constitution alignment

- **Article II.1 (User-Controlled Preload)**: "Private mode" is the required global setting that disables all
  pre-action network calls; Private mode defaults **OFF** (preload enabled) and MUST be honored globally when ON.
- **Article II.2 (Minimal Local Storage / logout wipe)**: logout MUST clear tokens **and** all user-identifying
  cache (`currentTweet`, `preloadedOriginator`, `preloadedDuplicateCheck`, and any per-user caches); a manual
  "clear my data" affordance MUST exist and clear the same set.
- **Article VII.1 (Quiet Presence)**: no UI may be injected on tweet-page load; the first-run notice therefore
  renders **inside the overlay on the first eligible explicit open**, never as a standalone page-load injection.
- **Article VII.2 (Accessibility)** & **VII.3 (Honest Copy)**: all new UI is keyboard-operable, conveys status by
  glyph/text (never color alone), honors `prefers-reduced-motion`/`prefers-contrast`, and uses non-manipulative copy.

## Clarifications

### Session 2026-06-07

- Q: On logout / "Clear my data", which preferences survive vs. are wiped with the user-identifying caches (FR-031
  vs SC-006)? → A: Device preferences (`privateMode`, `autoAddToCollection`, `firstRunNoticeShown`) survive logout
  and clear-data; only the account-bound `defaultCollectionId` is cleared on logout.
- Q: With Private mode ON, when the user opens the overlay, do duplicate/originator lookups run automatically? →
  A: No — the overlay opens silent and presents an explicit **"Check now"** control; lookups run only when the user
  activates it (Private mode stays ON, toolbar stays **Paused**).
- Q: Where are user settings (`privateMode`, `autoAddToCollection`, `defaultCollectionId`, `firstRunNoticeShown`)
  persisted? → A: `chrome.storage.sync` — they roam across the user's signed-in Chrome devices; the first-run notice
  therefore fires once per synced Chrome profile, not strictly per browser install.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A clean capture tray focused on the quote (Priority: P1)

A user opens the tray to capture a quote and sees the quote and the actions that matter — not a row of engagement
metrics (likes/retweets/replies/views/bookmarks) that are irrelevant to capturing a quote. A developer can still
inspect the raw extracted metrics through the existing debug diagnostics channel.

**Why this priority**: The metrics are visual noise that distract from the capture decision and imply the extension
cares about engagement. Removing them is a pure, client-only win that improves every capture. Client-only (no
backend), so it ships first.

**Independent Test**: Open the tray on a tweet; confirm no engagement-metric chips render. In a `[DEV]` build,
confirm the same metrics are present in the diagnostics output. Delivers a cleaner tray with zero feature loss for
developers.

**Acceptance Scenarios**:

1. **Given** an authenticated user on a tweet in a production build, **When** the tray opens, **Then** no tweet
   engagement-metric chips (replies, retweets, likes, views, bookmarks) and no author/date chip appear anywhere in
   the tray.
2. **Given** a `[DEV]`/debug build, **When** a tweet is extracted, **Then** the full set of extracted metrics is
   available in the debug diagnostics object — and still **absent** from the visible tray UI.
3. **Given** any build, **When** a tweet is extracted, **Then** extraction itself (text, author, tweet id, date) is
   unchanged — only the tray's *display* of metrics is removed.

---

### User Story 2 - Predictable, top-anchored tray controls (Priority: P1)

A user wants the refresh and close controls in a consistent, reachable place regardless of how tall the tray is.
The controls stay pinned to the top-right corner of the whole tray, top-aligned, even when the tray expands from the
collapsed bar to the taller capture view.

**Why this priority**: Controls that drift to the vertical center of a growing tray are hard to find and hit;
anchoring them is a small, client-only layout fix that makes the tray feel stable. Ships first.

**Independent Test**: Open the tray (collapsed), then expand it to the capture view; confirm refresh/close stay
top-right and top-aligned in both states, with no layout shift of the host page.

**Acceptance Scenarios**:

1. **Given** the collapsed tray, **When** it is shown, **Then** refresh and close sit at the top-right, top-aligned.
2. **Given** the tray expanded to the multi-row capture view, **When** it grows taller, **Then** refresh and close
   remain anchored at the top-right corner (not vertically centered).
3. **Given** keyboard navigation, **When** the user tabs through the tray, **Then** the controls are reachable and
   show a visible focus state, and close is operable via keyboard.

---

### User Story 3 - See that a slow capture is progressing (Priority: P1)

A user on a slow connection submits a quote and, instead of a frozen button, sees honest staged feedback reflecting
the actual steps ("Checking…" → "Submitting…" → "Confirming…"). Fast captures show nothing distracting.

**Why this priority**: Closes the "is it broken or just slow?" gap on the most important action (submission) without
backend changes. Ships first.

**Independent Test**: Throttle the network; submit a quote; confirm staged status text appears (after a short delay)
and advances through the phases, then resolves to success/error. On a fast connection, confirm no flicker.

**Acceptance Scenarios**:

1. **Given** a submission that completes within the debounce window (~400 ms), **When** the user submits, **Then**
   no staged progress text flashes — only the normal success/error result.
2. **Given** a submission slower than the debounce window, **When** each phase is reached, **Then** the tray shows a
   status string for that phase, advancing as the operation proceeds, and clears on completion.
3. **Given** `prefers-reduced-motion`, **When** progress is shown, **Then** any spinner animation is suppressed and
   the textual status alone conveys progress.
4. **Given** a submission error at any phase, **When** it fails, **Then** the tray shows an honest error and a way to
   retry; it MUST NOT show a success or "Done" state.

---

### User Story 4 - Log out and clear my data (Priority: P1)

A privacy-conscious user wants to log the extension out so their browsing no longer reaches the Quotewise backend,
and to be sure no personal data lingers locally. Logging out clears tokens and all user-identifying cache; a
separate "clear my data" action does the same without changing login state semantics.

**Why this priority**: Logout is the strongest privacy lever (background checks require auth, so logout stops them),
the flow already exists in the auth layer but has no UI, and the constitution mandates the logout-wipe and a manual
clear-data affordance. Client-only. Ships first.

**Independent Test**: While authenticated, invoke logout from the tray account menu (and from settings); confirm the
toolbar returns to the logged-out state, no further automatic backend calls occur on tweet loads, and the
user-identifying caches are gone. Invoke "clear my data"; confirm the same caches are cleared.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they choose "Log out", **Then** OAuth tokens are cleared, all
   user-identifying cached data (`currentTweet`, `preloadedOriginator`, `preloadedDuplicateCheck`, per-user caches)
   is wiped, scheduled token-refresh is cancelled, and the toolbar shows the logged-out state.
2. **Given** a logged-out user, **When** they load a tweet, **Then** no automatic preflight/duplicate/originator
   network calls are made.
3. **Given** any user, **When** they choose "Clear my data", **Then** the same user-identifying cache set is cleared;
   login state is only affected if the user also chose to log out.
4. **Given** logout, **When** completed, **Then** no token, cookie, or secret value appears in any log, error, or
   diagnostic output.

---

### User Story 5 - Pause background activity without logging out (Private mode) (Priority: P1)

A user wants the at-a-glance convenience of staying logged in but does not want the extension to contact the backend
as they browse. They turn on **Private mode**: all capture/pre-action background network activity (preflight,
duplicate, originator lookups) is suppressed until they explicitly act to capture. The toolbar reflects this with a
distinct **Paused** state. The first eligible time the overlay opens for an authenticated user with automatic checks
enabled, a one-time, dismissible notice explains the behavior and points to the setting.

**Why this priority**: This is the constitution's mandated user-controlled-preload switch (Article II.1) and the
primary "great UX + privacy" lever. Client-only. Ships first.

**Independent Test**: With Private mode OFF (default), confirm automatic checks run and the spec-004 quote-status
icon appears. Turn Private mode ON; load tweets and confirm **zero** capture/preflight background requests occur —
including when the overlay is opened, until the user activates **"Check now"** — the toolbar shows the Paused state,
and explicit Check-now/capture still works (and only then makes capture/preflight network calls). Auth-maintenance
traffic such as token refresh/session checks is outside this switch and may continue so the user stays logged in.
Confirm the first-run notice appears exactly once (per the user's synced Chrome profile) on the first eligible
authenticated, Private-mode-OFF overlay open.

**Acceptance Scenarios**:

1. **Given** Private mode is OFF (default), **When** an authenticated user opens a tweet, **Then** automatic
   checks run and the toolbar resolves a quote-status state per spec 004.
2. **Given** Private mode is ON, **When** the user browses tweets (including opening the overlay), **Then** no
   preflight/duplicate/originator network request is made for any tweet until the user explicitly activates the
   overlay's **"Check now"** control or initiates capture.
3. **Given** Private mode is ON, **When** the user explicitly captures, **Then** the necessary network calls run for
   that explicit action only, and quote text is sent only on the explicit submit (never during passive browsing).
4. **Given** Private mode is ON, **When** the toolbar icon is resolved, **Then** it shows the **Paused** ambient
   state — grey owl + pause glyph `‖`, tooltip "Quotewise — paused (private mode)" — distinguishable by artwork +
   glyph, not color alone.
5. **Given** an authenticated user with Private mode OFF and `firstRunNoticeShown === false`, **When** the user opens
   the overlay, **Then** a one-time, non-blocking, dismissible notice appears *inside the overlay* explaining
   automatic status checks and how to turn them off, marks `firstRunNoticeShown` when shown/dismissed, and never
   appears again after being shown/dismissed. No separate "automatic checks have run" storage flag is required.
6. **Given** the first-run notice has been shown once, **When** the user reloads/reopens later, **Then** it is not
   shown again (the shown-state persists across service-worker restarts).

---

### User Story 6 - Manage settings from a real settings page (Priority: P1 shell)

A user wants a proper place to manage the extension: see which account they're signed in as, log out, toggle Private
mode, clear their data, and (later) pick a default collection and auto-add behavior. A canonical options page serves
this; a lightweight account menu in the tray offers the same quick actions plus "Open settings". The toolbar icon
click keeps opening the in-page overlay (no browser-action popup is introduced).

**Why this priority**: A settings home is the canonical Chrome pattern and the natural host for logout, Private mode,
clear-data, and the collection options. The **shell** (account, logout, Private mode, clear data) is client-only and
ships first; collection wiring is P2 (User Story 7).

**Independent Test**: Open the options page via the standard Chrome entry points; confirm it shows account identity,
a working logout, a Private-mode toggle, and clear-data. Open the tray account menu; confirm quick logout, Private
mode toggle, and "Open settings" work. Confirm clicking the toolbar icon still opens the overlay.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they open the options page, **Then** it shows their account identity
   (e.g. username) and controls for logout, Private mode, and clear-my-data.
2. **Given** the tray is open, **When** the user opens the tray account menu, **Then** they can log out, toggle
   Private mode, and choose "Open settings", with all controls keyboard-operable and ARIA-labelled.
3. **Given** any state, **When** the user clicks the toolbar icon, **Then** the in-page overlay opens (the icon-click
   behavior from spec 004 is unchanged — no popup replaces it).
4. **Given** a setting is changed on the options page, **When** the change is made, **Then** it takes effect across
   the extension (tray menu and toolbar reflect the same state) without requiring a manual reload.

---

### User Story 7 - Capture into my collection by default (Priority: P2)

A user who collects quotes wants new captures to land in their chosen collection automatically. From settings they
pick a **default collection** (from their existing collections) and enable **auto-add**; on submit, the captured
quote is added to that collection.

**Why this priority**: A high-value convenience that the backend already fully supports (collections list with a
default, and add-to-collection on quote create). Client-only extension work, but layered above the P1 settings shell,
so it is P2.

**Independent Test**: In settings, confirm the default-collection picker lists the user's collections and preselects
their server-side default; enable auto-add; capture a quote; confirm it is added to that collection. Disable auto-add;
capture; confirm it is not auto-added.

**Acceptance Scenarios**:

1. **Given** an authenticated user with collections, **When** they open settings, **Then** the default-collection
   picker is populated with their collections and preselects their existing server-side default.
2. **Given** auto-add is ON and a default collection is set, **When** the user submits a capture, **Then** the quote
   is added to that collection as part of the submission.
3. **Given** auto-add is OFF, **When** the user submits a capture, **Then** the quote is created without being added
   to a collection.
4. **Given** a transient collection error on submit, **When** add-to-collection fails, **Then** the quote
   submission itself still succeeds and the user is informed the collection step did not complete (honest copy, no
   silent loss).

---

### User Story 8 - Understand a "similar but not exact" match (Priority: P2)

When the backend reports a near match ("similar but not exact"), the user wants to *see* how the captured text
differs from what is already on record, not a meaningless percentage. The tray shows a **word-level diff** between
the captured text and the on-record quote, with differences clearly marked (by marker/typography, not color alone),
plus a link to view the existing quote.

**Why this priority**: Turns a dead-end informational badge into a decision aid. The on-record text needed for the
diff is already returned by the API, so this is client-only — but it sits above the P1 layout work, so P2.

**Independent Test**: On a tweet whose text is a near match to an existing quote, open the tray; confirm a word-level
diff renders between captured and on-record text with differences marked and no similarity percentage shown, plus a
"view existing" link.

**Acceptance Scenarios**:

1. **Given** a near match (recommendation in the `new_version` family, including `new_version_known_author`),
   **When** the tray shows the match, **Then** it renders a word-level diff of captured vs. on-record text with
   added/removed words clearly marked.
2. **Given** the diff is shown, **When** the user views it, **Then** no similarity percentage is displayed, and a
   link to the existing quote on Quotewise is available.
3. **Given** color-vision deficiency or `prefers-contrast`, **When** the diff is shown, **Then** differences are
   distinguishable without relying on color (e.g. underline/strike/markers + text), per WCAG 1.4.1.
4. **Given** an exact match or no match, **When** the tray shows the result, **Then** the diff view is not shown
   (it is specific to near matches).

---

### User Story 9 - Add an earlier sighting to improve provenance (Priority: P3 — blocked on API)

When a near/duplicate match exists and the current tweet **predates** the matched record's published date, the user
can add this tweet as an **earlier sighting**, improving the quote's provenance ("who said it first"). The action is
offered *only* when the current tweet is older than our records, with an honest hint; otherwise the match is
read-only. Because the action is labelled by what the backend actually does today (it folds a near match into a
**sighting** on the existing quote), it is described as adding a sighting, not creating a separate variant.

**Why this priority**: Provenance is valuable, but the gating reference data is **not yet available from the API**
(see Dependencies): the duplicate-check/preflight payload exposes the matched quote's record-creation timestamp, not
its published date, and record-creation time is **not** an acceptable provenance reference. This story is therefore
**blocked** until the API exposes the matched record's published date, and the action stays hidden/disabled until then.

**Independent Test (once unblocked)**: On a tweet older than the matched record's published date, confirm an "add as
earlier sighting" action is offered with the "older than our records" hint and adds a sighting on submit. On a tweet
newer than/equal to the record, confirm the action is not offered. Until the API field ships, confirm the action is
hidden/disabled.

**Acceptance Scenarios**:

1. **Given** the matched record's published date is available **and** the current tweet's posted date is strictly
   earlier, **When** the tray shows the match, **Then** an "add as earlier sighting of this similar quote" action is
   offered with the hint "This tweet is older than our records".
2. **Given** the current tweet is not older than the matched record's published date, **When** the tray shows the
   match, **Then** the match is read-only and no add-sighting action is offered.
3. **Given** the matched record's published date is **not** present in the API response, **When** the tray shows the
   match, **Then** the add-sighting action is hidden/disabled (record-creation time MUST NOT be used as a fallback
   reference).
4. **Given** the action is taken, **When** the user confirms, **Then** the submission adds a **sighting** to the
   existing quote (the label MUST NOT claim it creates a distinct new variant until the backend supports that intent).

---

### Edge Cases

- **Private mode + open overlay**: With Private mode ON, opening the overlay performs **no** automatic lookups; the
  overlay shows an explicit **"Check now"** control and the duplicate/originator lookups run only when the user
  activates it. Passive tweet *browsing* (no overlay) MUST make no calls; Private mode stays ON and the toolbar stays
  **Paused** after a Check-now; quote text/writes still only go out on explicit submit.
- **Private mode toggled mid-session**: turning Private mode ON MUST stop subsequent background checks immediately;
  the toolbar MUST re-resolve to Paused. Turning it OFF MUST resume normal behavior on the next tweet.
- **Logout while a capture/preflight is in flight**: in-flight responses MUST NOT repopulate caches after logout;
  the logged-out state wins.
- **First-run notice vs. Quiet Presence**: the notice MUST NOT inject any UI on page load; it appears only within the
  overlay on an explicit open when the trigger conditions are met (`authenticated && !privateMode &&
  !firstRunNoticeShown`).
- **Near match with missing on-record text**: if the on-record text is absent for some reason, the tray MUST degrade
  to the existing read-only "similar version" presentation rather than rendering a broken diff.
- **Collections unavailable / empty**: if the user has no collections or the list fails to load, the default-collection
  picker MUST show an honest empty/error state and auto-add MUST be effectively off (no silent failure on submit).
- **Reduced motion**: spinners MUST be suppressed under `prefers-reduced-motion`; textual progress remains.
- **Metrics in non-debug build**: the diagnostics channel that carries metrics MUST remain debug-gated; metrics MUST
  NOT leak into production-visible UI or into content-bearing telemetry.

## Requirements *(mandatory)*

### Functional Requirements

**Tray cleanup & developer diagnostics**

- **FR-001**: The tray MUST NOT display tweet engagement metrics (replies, retweets, likes, views, bookmarks) or the
  author/date chips. The metric-chip region MUST be removed from the tray.
- **FR-002**: The raw extracted metrics MUST remain available to developers through the existing debug diagnostics
  channel, gated by the existing debug-mode condition; they MUST NOT appear in any production-visible UI.
- **FR-003**: Tweet extraction (text, author, tweet id, date, etc.) MUST be unchanged; only the tray's display of
  metrics is removed.

**Tray layout & controls**

- **FR-010**: The refresh and close controls MUST be pinned to the top-right of the whole tray, top-aligned, and MUST
  remain anchored there when the tray expands from the collapsed bar to the taller capture view.
- **FR-011**: All tray controls MUST be keyboard-operable with visible focus states and ARIA labels; the overlay MUST
  remain dismissable and MUST NOT cause host-page layout shift (Article VII.1/VII.2).

**Progress feedback**

- **FR-020**: For the capture/submit flow, the tray MUST show staged status text reflecting the actual phases
  (e.g. "Checking…", "Submitting…", "Confirming…"), advancing as the operation proceeds and clearing on completion.
- **FR-021**: Staged progress MUST appear only after a short debounce (~400 ms) so operations faster than the window
  show no progress flash.
- **FR-022**: Any spinner/animation MUST be suppressed under `prefers-reduced-motion`; the textual status MUST convey
  progress on its own. Progress copy MUST be honest and MUST NOT show success before confirmation.
- **FR-023**: On error at any phase, the tray MUST show an honest error and a retry affordance, and MUST NOT show a
  success/"Done" state.

**Authentication, logout & data hygiene**

- **FR-030**: The UI MUST surface the existing logout action from both the tray account menu and the options page.
- **FR-031**: Logout MUST clear OAuth tokens, cancel scheduled token refresh, and wipe all user-identifying cached
  data (`currentTweet`, `preloadedOriginator`, `preloadedDuplicateCheck`, and any per-user caches) (Article II.2).
  Logout MUST also clear the account-bound `defaultCollectionId` (it references the signed-in account's collection),
  but MUST preserve the device-level preferences `privateMode`, `autoAddToCollection`, and `firstRunNoticeShown`
  (these are install/profile settings, not user-identifying cache, and persist in `chrome.storage.sync`).
- **FR-032**: After logout the toolbar MUST resolve to the logged-out state and the system MUST make no automatic
  background network calls until the user re-authenticates.
- **FR-033**: A manual "Clear my data" affordance MUST exist (in settings) and MUST clear the same user-identifying
  cache set as logout (Article II.2), including the account-bound `defaultCollectionId`. It MUST preserve the
  device-level preferences `privateMode`, `autoAddToCollection`, and `firstRunNoticeShown`, and MUST NOT change
  login state.
- **FR-034**: No token, cookie, or secret value may appear in any log, error message, or diagnostic/telemetry output
  produced by these flows (Article III.3).

**Privacy / Private mode**

- **FR-040**: A **Private mode** setting MUST exist that, when ON, suppresses **all** capture/pre-action background
  network calls (preflight, duplicate, originator lookups) for passive tweet browsing. It MUST default to **OFF**
  (preload enabled) and MUST be honored globally when ON (Article II.1).
- **FR-041**: With Private mode ON, network calls MUST occur only on an explicit user action; quote text and any
  write (submission) MUST occur only on explicit submit, never during passive browsing (Article II.1).
- **FR-042**: With Private mode ON, the toolbar MUST resolve to a new **Paused** ambient state (see Toolbar
  Coordination); toggling Private mode MUST re-resolve the toolbar on the next `chrome.storage.onChanged` event,
  without requiring a manual reload.
- **FR-043**: On the first explicit overlay open where the user is authenticated, Private mode is OFF, and
  `firstRunNoticeShown` is false, the system MUST show a one-time, non-blocking, dismissible notice **inside the
  overlay** (never injected at page load), explaining automatic status checks and how to disable them. Showing or
  dismissing the notice MUST set `firstRunNoticeShown` in `chrome.storage.sync`. The shown-state MUST persist across
  service-worker restarts and across the user's signed-in Chrome devices, and the notice MUST NOT reappear once
  shown/dismissed (it also survives logout — see FR-031). The system MUST NOT add a separate
  "automatic checks have run" storage flag.
- **FR-044**: With Private mode ON, opening the overlay MUST NOT automatically run any duplicate/originator/preflight
  lookup. The overlay MUST instead present an explicit **"Check now"** control; the lookups for the current tweet run
  only when the user activates it. After a Check-now, Private mode remains ON and the toolbar stays in the **Paused**
  state; quote text and any write still occur only on explicit submit (Article II.1).

**Settings / options surface**

- **FR-050**: The extension MUST provide a canonical settings/options page that opens via the standard Chrome entry
  points, hosting: account identity, logout, Private-mode toggle, clear-my-data, and (per FR-06x) the
  default-collection picker and auto-add toggle.
- **FR-051**: The tray MUST provide a lightweight account menu exposing quick logout, the Private-mode toggle, and
  an "Open settings" action.
- **FR-052**: The toolbar icon click MUST continue to open the in-page overlay; no browser-action popup may replace
  that behavior (spec 004).
- **FR-053**: Settings changes MUST take effect across surfaces (tray menu, toolbar resolution, capture flow) without
  requiring a manual reload.

**Collections**

- **FR-060**: Settings MUST present a default-collection picker populated from the user's collections, preselecting
  the user's existing server-side default; it MUST show an honest empty/error state when no collections exist or the
  list fails to load.
- **FR-061**: When auto-add is ON and a default collection is selected, submitting a capture MUST add the quote to
  that collection as part of the submission.
- **FR-062**: When auto-add is OFF, submitting a capture MUST NOT add the quote to any collection.
- **FR-063**: If add-to-collection fails on submit, the quote submission MUST still succeed and the user MUST be
  honestly informed the collection step did not complete (no silent loss).

**Similar-match diff**

- **FR-070**: For a near match ("similar but not exact"; recommendation in the `new_version` family, including
  `new_version_known_author`), the tray MUST render a **word-level diff** between the captured text and the
  on-record quote text, marking added/removed words.
- **FR-071**: The diff MUST NOT display a similarity percentage, and MUST provide a link to view the existing quote
  on Quotewise.
- **FR-072**: Diff differences MUST be distinguishable without relying on color alone (markers/typography + text),
  per WCAG 1.4.1, and MUST honor `prefers-contrast`.
- **FR-073**: The diff view MUST be shown only for near matches; exact/no-match results MUST NOT render it. If the
  on-record text is unavailable, the tray MUST degrade to the existing read-only "similar version" presentation.

**Add earlier sighting (provenance) — blocked on API**

- **FR-080**: An "add as earlier sighting of this similar quote" action MUST be offered **only** when the matched
  record's **published date** is available **and** the current tweet's posted date is strictly earlier; it MUST then
  show the hint "This tweet is older than our records".
- **FR-081**: When the current tweet is not strictly older than the matched record's published date, the match MUST
  be read-only (no add-sighting action).
- **FR-082**: The matched record's record-creation timestamp MUST NOT be used as a provenance reference. Until the
  API exposes the matched record's published date, the add-sighting action MUST remain hidden/disabled.
- **FR-083**: The action's label MUST honestly reflect current backend behavior — adding a **sighting** to the
  existing quote — and MUST NOT claim it creates a distinct new variant until the backend supports such an intent.

**Toolbar coordination (spec-004 amendment)**

- **FR-090**: A new **Paused** ambient toolbar state MUST be defined and applied when Private mode is ON: grey owl
  artwork + pause glyph `‖`, tooltip "Quotewise — paused (private mode)". It MUST be distinguishable by
  artwork/glyph, not color alone.
- **FR-091**: In spec-004 precedence, **Paused** MUST sit **just below Logged-out** and above all remaining states:
  `Error → Logged-out → Paused → Loading → Auth-pending → Unsupported → Supported-idle → quote-status badges`. This
  amendment MUST be reflected in the spec-004 state table/resolver (single authoritative resolver preserved).
- **FR-092**: Toolbar and tray MUST stay synchronized with auth and Private-mode state: a change in either MUST
  re-resolve the toolbar and update the tray's account menu/settings reflection on the next
  `chrome.storage.onChanged` event, without requiring a manual reload.

**Cross-cutting (constitution)**

- **FR-100**: All new injected UI MUST meet WCAG 2.1 AA (keyboard operability, glyph/text not color alone, visible
  focus, ARIA labels, `prefers-reduced-motion`/`prefers-contrast`) and use honest, non-manipulative copy.
- **FR-101**: This feature MUST NOT add new manifest permissions or runtime dependencies without a written
  justification using the narrowest scope (Article III.1/III.2); the settings page and collections reuse existing
  permissions/host access.

### Key Entities

- **User settings**: preferences persisted in `chrome.storage.sync` (roam across the user's signed-in Chrome
  devices) — `privateMode` (bool, default off/preload-on), `autoAddToCollection` (bool), `defaultCollectionId` (the
  user's chosen collection), and the `firstRunNoticeShown` flag. The device-level prefs (`privateMode`,
  `autoAddToCollection`, `firstRunNoticeShown`) survive logout and "clear my data"; only the account-bound
  `defaultCollectionId` is cleared on logout.
- **Private-mode state**: the global on/off that gates all pre-action background network activity and drives the
  Paused toolbar state.
- **Capture progress**: the current phase of an in-flight capture (idle / checking / submitting / confirming /
  success / error) that the staged status renders.
- **Similar-match diff model**: the captured text + the on-record quote text + the computed word-level difference;
  plus the matched record's published date (when available) used to gate the add-sighting action.
- **Collection (reference)**: the user's collections, each with an identity, name, and a default flag, used to
  populate the picker and to auto-add on submit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a production build, zero tweet engagement-metric chips appear in the tray across the supported tweet
  layouts; in a debug build, 100% of the metrics remain inspectable via diagnostics.
- **SC-002**: Refresh and close are at the top-right, top-aligned, in both the collapsed and expanded tray, verified
  with no host-page layout shift.
- **SC-003**: For captures slower than the debounce window, users see staged progress that advances and resolves;
  captures faster than the window show no progress flash.
- **SC-004**: After logout, a user can verify (e.g. via the browser's network panel) that loading tweets makes no
  Quotewise background calls, and the user-identifying caches are empty.
- **SC-005**: With Private mode ON, browsing any number of tweets — including opening the overlay — produces **zero**
  capture/preflight Quotewise requests (preflight, duplicate, originator) until the user activates **"Check now"** or
  captures; the explicit Check-now/capture still works; the toolbar shows the Paused state and is decodable without
  color. Auth-maintenance traffic that keeps the user logged in (token refresh/session checks) is excluded from this
  criterion.
- **SC-006**: The first-run notice appears exactly once per the user's synced Chrome profile (its `firstRunNoticeShown`
  flag lives in `chrome.storage.sync` and survives logout), only on an explicit overlay open while authenticated and
  Private mode is OFF, and never injects UI before an explicit overlay open.
- **SC-007**: A user can set a default collection and have captures auto-added to it; toggling auto-add off stops
  auto-adding; a collection failure never loses the quote.
- **SC-008**: For a near match, users see a word-level diff (no percentage) that is decodable under simulated
  deuteranopia/protanopia and with reduced motion/high contrast.
- **SC-009**: The add-earlier-sighting action is offered only when the tweet is older than the matched record's
  published date, and is absent whenever that date is unavailable.
- **SC-010**: Every new state/affordance exposes a correct accessible label and is keyboard-operable; no new manifest
  permission is added.

## Dependencies

- **Quotewise API (already available)**: `check_duplicate` / `preflight` return the matched record's **text**,
  **originator**, and **similarity** (enables the word-level diff with no backend change). `GET /v1/collections/`
  returns the user's collections with a default; `POST /v1/quotes/` accepts optional `collection_id` (UUID string) to
  auto-add on submit. This field is verified against the django-api `QuoteCreateSerializer` and `QuoteViewSet.create`
  contract.
- **Quotewise API (django-api — required for P3 / future)**:
  - **(a) [hard blocker for FR-080..082]** Expose the matched record's **published date** (`quote_date`) on the
    `check_duplicate` / `preflight` `matches[]` payload. Today only the record-creation timestamp is returned, which
    is **not** an acceptable provenance reference; the add-earlier-sighting action stays disabled until this ships.
  - **(b) [future, for true variants]** A submit **intent** parameter (e.g. create-as-distinct-version) so an
    "add as variant" action can create a separate version rather than folding into a sighting. Until then, the action
    is honestly labelled as adding a sighting (FR-083).
- **Spec 004 (toolbar icon)**: requires the **Paused** state amendment (FR-090..091) to be folded into its state
  table/resolver/precedence.
- **Constitution**: Articles II (privacy), III (permissions), VII (UX) govern this feature directly.

## Out of Scope

- Any change to **what is extracted** from the page (spec 003 owns extraction).
- Re-derivation of the backend's similarity thresholds; the extension consumes the backend recommendation.
- A browser-action **popup** (explicitly excluded; icon-click keeps opening the overlay).
- True distinct **variant creation** as a first-class action (blocked on backend intent param; honest sighting
  labelling used in the interim).
- The spec-004 **icon resolver internals** beyond adding the Paused state and its precedence slot.
- Non-X/Twitter platforms (Article VIII — single-platform scope).

## Assumptions

- Authentication remains OAuth2 Bearer-token based; logout = clearing stored tokens (no cookie permission involved).
- The user's posted date for the current tweet is already available from extraction (used as the comparison input
  for date-gating once the matched record's published date is exposed).
- The collections endpoints behave as observed in the current backend; if a collection step fails, quote creation is
  independent and still succeeds.
- "Developers" means builds where the existing debug-mode condition is true (e.g. `[DEV]`/`[STAGING]` builds); the
  diagnostics channel is the existing one, not a new user-facing surface.
- The debounce threshold (~400 ms) is a tunable starting point, to be validated for flicker-free fast captures.
