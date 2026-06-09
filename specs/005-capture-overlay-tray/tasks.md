---
description: "Task list for Capture Overlay Tray (005)"
---

# Tasks: Capture Overlay Tray — Cleanup, Privacy, Progress & Variant Flow

**Input**: Design documents from `specs/005-capture-overlay-tray/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED and **test-first**. The constitution (Article VI) mandates TDD for deterministic logic and
characterization tests for DOM/Shadow-DOM UI; every contract file carries an explicit "Test contract" section.

**Organization**: Tasks are grouped by user story (US1–US9) so each is implementable and testable independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: User story (US1–US9); Setup/Foundational/Polish carry no story label
- Exact file paths are included in every task

## Path Conventions

Single-project MV3 extension (per plan.md): `src/` at repo root, tests in `tests/` mirroring `src/`. Use **Bun**.

> ⚠️ **Shared-file hotspot**: `src/content/ui/overlay-bar.ts` is edited by US1, US2, US5, US6, US7, US8. Tasks that
> edit it are **NOT [P]** with each other across stories — serialize them (execution order below) or expect merge
> conflicts. The same applies to `src/background/service-worker.ts` (US4, US5, US6, US7) and `src/types/chrome.ts`
> (T001/T002).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared type/mocks scaffolding used across stories. No new runtime dependency, no new permission.

- [X] T001 Add `Settings` interface + `DEFAULT_SETTINGS` const (privateMode, autoAddToCollection, defaultCollectionId, firstRunNoticeShown) to `src/types/chrome.ts` per data-model §1
- [X] T002 Add new `MessageType` members `OPEN_OPTIONS_PAGE`, `CHECK_NOW`, `CLEAR_USER_DATA`, `LIST_COLLECTIONS` to `src/types/chrome.ts` per contracts/messages.md (same file as T001 → after T001)
- [X] T003 [P] Extend chrome mock in `tests/setup.ts` with `chrome.storage.sync` (get/set), `chrome.storage.onChanged` (addListener/emit), and `chrome.runtime.openOptionsPage` stubs (extend, don't redefine)

**Checkpoint**: Shared types + test mocks ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Plumbing that multiple user stories depend on. ⚠️ Complete before US4–US7.

- [X] T004 [P] Write FAILING tests for the settings store (get merges over defaults; `updateSettings` issues exactly one `chrome.storage.sync.set({settings})`; `onSettingsChanged` fires only for `area==='sync'` `settings` changes; unsubscribe stops callbacks; serialized settings ≪ 8192 B) in `tests/settings/settings-store.test.ts` per contracts/settings-storage.md
- [X] T005 Implement `src/settings/settings-store.ts` (`getSettings`, `updateSettings`, `onSettingsChanged`) to pass T004 (blocks US5/US6/US7)
- [X] T006 [P] Export canonical `USER_IDENTIFYING_CACHE_KEYS` (currentTweet, preloadedOriginator, preloadedDuplicateCheck, lastAuthCheck, originator_search_history) from `src/background/storage-cleanup.ts` per data-model §2 (blocks US4)

**Checkpoint**: Settings store + cache-key set ready — user stories can begin.

---

## Phase 3: User Story 1 — Clean capture tray (Priority: P1) 🎯 MVP

**Goal**: Remove engagement-metric + author/date chips from the tray; keep raw metrics in the debug diagnostics only.

**Independent Test**: Prod build → no metric/author/date chips in the tray. `[DEV]` build → metrics present in
`GET_DIAGNOSTICS`/`debugLog`, still absent from the tray. Extraction (`TwitterData`) unchanged.

- [X] T007 [P] [US1] Characterization test: rendered tray markup has no metric chips (replies/retweets/likes/views/bookmarks) and no author/date chip in a prod build; `GET_DIAGNOSTICS` still carries metrics under `DEBUG_MODE`, in `tests/content/overlay-metrics.test.ts`
- [X] T008 [US1] Remove `buildMetaChips()` (≈overlay-bar.ts:410-433), the `#meta-row` markup, and its `.chip`/`.meta-row` styles from `src/content/ui/overlay-bar.ts` (FR-001)
- [X] T009 [US1] Verify/route raw extracted metrics through the existing `GET_DIAGNOSTICS`/`debugLog` channel gated by `DEBUG_MODE` (`src/background/service-worker.ts` diagnostics + `src/config/environment.ts`); confirm extraction in `src/platforms/twitter/adapter.ts` is untouched (FR-002/003)

**Checkpoint**: Tray is decluttered; developers retain metrics via diagnostics. SC-001 satisfied.

---

## Phase 4: User Story 2 — Top-anchored controls (Priority: P1)

**Goal**: Pin refresh + close to the top-right, top-aligned, across collapsed and expanded tray states.

**Independent Test**: Collapse then expand the tray → refresh/close stay top-right/top-aligned, no host-page layout
shift, both keyboard-reachable with visible focus, close operable via keyboard.

- [X] T010 [P] [US2] Characterization test: refresh/close are top-right + top-aligned in both collapsed and expanded markup; no layout shift; controls keyboard-reachable with focus state, in `tests/content/overlay-controls.test.ts`
- [X] T011 [US2] Re-anchor refresh/close to top-right + top-aligned via CSS (replace `align-items: center` reliance on `.bar`; anchor the `.section.right` controls to the tray top) in `src/content/ui/overlay-bar.ts` (FR-010) — **after T008 (same file)**
- [X] T012 [US2] Add keyboard operability, visible focus styles, and ARIA labels to refresh/close (and ensure overlay stays dismissable, no layout shift) in `src/content/ui/overlay-bar.ts` (FR-011) — **after T011 (same file)**

**Checkpoint**: Controls stable + accessible. SC-002 satisfied.

---

## Phase 5: User Story 3 — Staged submit progress (Priority: P1)

**Goal**: Dedicated submit progress surface (`Checking quote`→`Saving to Quotewise`→`Confirming`) above the button
while the button stays in the action state; tentative long-wait copy; honest errors; reduced-motion aware.

**Independent Test**: Throttle network → button shows `Submitting...`, progress area advances through the phases
with a linear bar above the button, then shows rotating `Quotewise may be ...` copy if still pending, then resolves;
`prefers-reduced-motion` → static/no-animation bar with text; error mid-flow → honest error + Retry, never success.

- [X] T013 [P] [US3] Test-first: progress phase machine + explicit submit rendering (button remains `Submitting...`; progress area advances in order above the button; delayed secondary `Quotewise may be ...` copy rotates and clears; reduced-motion → static/no-animation bar with text; error at any phase → error+retry, never success), in `tests/content/progress-indicator.test.ts` per contracts/progress-and-submit.md §A
- [X] T014 [P] [US3] Implement `src/content/ui/components/progress-indicator.ts` (`CaptureProgressPhase` machine, optional debounce via `src/utils/debounce.ts`, linear-bar renderer, reduced-motion guard) to pass T013
- [X] T015 [US3] Wire staged phases into the submit flow (checking→submitting→confirming→success/error + retry; success only after confirmation; submit phases held briefly for polish) in `src/content/ui/components/action-button.ts` and `src/content/ui/overlay-bar.ts` (FR-020..023) — **overlay-bar.ts edit after T012**

**Checkpoint**: Honest staged progress. SC-003 satisfied.

---

## Phase 6: User Story 4 — Log out & clear my data (Priority: P1)

**Goal**: Logout clears tokens + user-identifying cache + nulls `defaultCollectionId`, cancels refresh, preserves
device prefs; "Clear my data" does the cache wipe without touching login. (UI lives in US6.)

**Independent Test**: Logout → toolbar logged-out, zero background calls on tweet loads, cache keys gone, tokens
cleared, refresh alarm cancelled, device prefs intact, `defaultCollectionId` null. Clear-data → same cache wipe,
login unchanged. No secret in any log.

- [X] T016 [P] [US4] Test-first: `OAUTH_LOGOUT` clears `oauth_*` + `USER_IDENTIFYING_CACHE_KEYS` + nulls `defaultCollectionId`, cancels `token-refresh` alarm, preserves the 3 device prefs, blocks in-flight-after-logout cache writes, emits no secret, in `tests/background/logout.test.ts` per contracts/progress-and-submit.md §B
- [X] T017 [P] [US4] Test-first: `CLEAR_USER_DATA` clears the cache set + nulls `defaultCollectionId`, preserves device prefs AND tokens/login, in `tests/background/clear-data.test.ts` per contracts/progress-and-submit.md §C
- [X] T018 [US4] Extend the `OAUTH_LOGOUT` handler to wipe `USER_IDENTIFYING_CACHE_KEYS`, null `settings.defaultCollectionId`, and guard against in-flight preflight/originator responses repopulating caches post-logout, in `src/background/service-worker.ts` (FR-031/032/034)
- [X] T019 [US4] Add the `CLEAR_USER_DATA` message handler (cache-set wipe + null `defaultCollectionId`, no login change) in `src/background/service-worker.ts` (FR-033) — **after T018 (same file)**

**Checkpoint**: Privacy data-hygiene levers work. SC-004 satisfied.

---

## Phase 7: User Story 5 — Private mode, first-run notice & Paused toolbar (Priority: P1)

**Goal**: Global Private mode suppresses ALL capture/pre-action background calls (passive browsing + overlay open)
until explicit "Check now"/capture; toolbar shows **Paused**; one-time in-overlay first-run notice.

**Independent Test**: Private mode OFF → auto checks + quote-status icon. ON → zero preflight/duplicate/originator
requests across tweets incl. overlay open; toolbar Paused (grey owl + `⏸︎`); "Check now" runs lookups
only on activation, stays Paused; auth-maintenance traffic is excluded; first-run notice appears once per synced
profile on the first authenticated, Private-mode-OFF overlay open, never on page load. (Tests set
`settings.privateMode` directly; the user toggle ships in US6.)

- [X] T020 [P] [US5] Test-first: extend `tests/background/icon-state-resolver.test.ts` with Paused precedence rows (Paused wins over Loading/AuthPending/Unsupported/SupportedIdle/quote-status when `privateMode`; Error/LoggedOut still win over Paused) per contracts/private-mode-and-toolbar.md §C
- [X] T021 [P] [US5] Test-first: Private-mode network gate — each automatic preflight/duplicate/originator entry point makes no network call when `privateMode===true`; `CHECK_NOW` does and leaves Private mode ON; toggle ON stops scheduling, OFF resumes next tweet; auth-maintenance traffic is excluded from this assertion, in `tests/background/private-mode.test.ts` per contracts/private-mode-and-toolbar.md §A
- [X] T022 [US5] Add `ICON_STATES.Paused` (grey owl, badge `⏸︎`, title "Quotewise — paused (private mode)", scope global) to `src/config/icon-states.ts` (FR-090, spec-004 amendment)
- [X] T023 [US5] Add a `privateMode` input + the Paused branch (after `UNAUTHENTICATED→LoggedOut`, before `Loading`) to `src/background/icon-state-resolver.ts`, and thread `privateMode` (read via settings-store, refreshed via `onSettingsChanged`) at every `applyResolvedIconForTab` call site in `src/background/service-worker.ts` (FR-091)
- [X] T024 [US5] Gate the automatic preflight/duplicate/originator entry points (`requestTweetDataExtraction`, `runAutomaticPreflightForExtractedTweet`/`checkQuoteCollectionStatus`, `scheduleAutomaticOriginatorProbe`) on `settings.privateMode` in `src/background/service-worker.ts` (FR-040/041/044) — **after T023 (same file)**
- [X] T025 [US5] Implement the `CHECK_NOW` handler (explicit duplicate+originator lookup for the current tweet only; stale-tab no-op; keeps Paused) in `src/background/service-worker.ts` (FR-044) — **after T024 (same file)**
- [X] T026 [P] [US5] Test-first + implement `src/content/ui/components/first-run-notice.ts` (in-overlay, non-blocking, dismissible, one-time; keyboard/ARIA) with trigger cases in `tests/content/first-run-notice.test.ts` per FR-043
- [X] T027 [US5] Wire the first-run notice into the overlay open path (show only when `authenticated && !privateMode && !firstRunNoticeShown`; set `firstRunNoticeShown` on show/dismiss; no separate checks-ran storage flag; never injected on page load) and add the "Check now" control shown under Private mode, in `src/content/ui/overlay-bar.ts` (FR-043/044) — **overlay-bar.ts edit after T015**
- [X] T028 [US5] Fold the Paused state into spec-004 docs: add the state + precedence slot to `specs/004-extension-icon-states/contracts/icon-state-resolver.md` and its data-model/state table (single authoritative resolver preserved)

**Checkpoint**: Constitution Article II.1 switch live; SC-005/SC-006 satisfied.

---

## Phase 8: User Story 6 — Settings page & tray account menu (Priority: P1 shell)

**Goal**: Canonical `options_ui` page (account identity, state-aware auth action, Private toggle, clear-data) + tray
account menu (auth action, Private toggle, Open settings). Icon click toggles the overlay (no popup). Live
cross-surface sync.

**Independent Test**: Open options page → account identity + working auth action + Private toggle + clear-data. Tray
account menu → quick auth action, Private toggle, Open settings. Icon click → overlay opens via `SHOW_OVERLAY` when
closed and closes when already visible (no popup and no `default_popup`). Toggle Private on options page → tray +
toolbar reflect it without reload.

- [X] T029 [US6] Add `"options_ui": { "page": "options.html", "open_in_tab": true }` to `manifest.json`, `manifest.prod.json`, and `manifest.dev.json` (single-source rule; no new permission; do not add `default_popup`) per contracts/options-page.md
- [X] T030 [US6] Add the `'options/index': './src/options/index.ts'` webpack entry and a `copy-webpack-plugin` pattern copying `public/options.html` → `dist/` in `webpack.config.js` (keep `splitChunks: false`)
- [X] T031 [P] [US6] Create `public/options.html` shell loading `options/index.js` via `<script defer type="module">`
- [X] T032 [US6] Implement `src/options/index.ts`: account identity, state-aware Log out/Log in action (`OAUTH_LOGOUT`/`OAUTH_LOGIN`) with polished busy state, Private-mode toggle (`updateSettings`), Clear my data (`CLEAR_USER_DATA`); subscribe via `onSettingsChanged`; keyboard/ARIA/honest copy (FR-050)
- [X] T033 [P] [US6] Implement `src/content/ui/components/account-menu.ts`: state-aware Log out/Log in action, Private-mode toggle, "Open settings" (sends `OPEN_OPTIONS_PAGE`); menu focus management, Escape-to-close, ARIA (FR-051)
- [X] T034 [US6] Add the `OPEN_OPTIONS_PAGE` handler calling `chrome.runtime.openOptionsPage()` in `src/background/service-worker.ts` (content scripts can't call it directly) (FR-051) — **after T025 (same file)**
- [X] T035 [US6] Mount the account menu into the tray (open/close, keyboard/ARIA) in `src/content/ui/overlay-bar.ts` (FR-051) — **overlay-bar.ts edit after T027**
- [X] T036 [P] [US6] Characterization test: manifests have `options_ui` and no `default_popup`; toolbar icon-click sends `SHOW_OVERLAY` and toggles the tray when already visible (the legacy `OPEN_POPUP` path is not used by `chrome.action.onClicked`); options controls present + labelled; auth/clear-data send correct messages; tray account-menu auth action sends `OAUTH_LOGOUT`/`OAUTH_LOGIN` as appropriate; changing Private mode in one surface updates the other via `onChanged` (no reload); "Open settings" sends `OPEN_OPTIONS_PAGE` (never calls `openOptionsPage` from content), in `tests/options/options-page.test.ts` and `tests/content/account-menu.test.ts`

**Checkpoint**: Settings home + account menu live; FR-052/053 satisfied. **P1 MVP set (US1–US6) complete.**

---

## Phase 9: User Story 7 — Default collection auto-add (Priority: P2)

**Goal**: Pick a default collection in settings; on submit, auto-add the capture to it when enabled; collection
failure never loses the quote.

**Independent Test**: Picker lists collections + preselects server default; enable auto-add → capture lands in
collection; disable → not added; simulate collection failure → quote still succeeds with honest notice; no
collections/list fails → honest empty/error, auto-add inert.

- [X] T037 [P] [US7] Test-first: submit includes verified `collection_id` (UUID string) when `autoAddToCollection` ON + `defaultCollectionId` set; omitted when OFF; collection-add failure → quote create still succeeds + honest "collection step didn't complete" path, in `tests/api/collection-autoadd.test.ts`; picker empty/error state + auto-add inert behavior in `tests/options/options-page.test.ts` per contracts (US7)
- [X] T038 [US7] Add optional `collection_id` (verified django-api `QuoteCreateSerializer` / `QuoteViewSet.create` field) to `QuoteSubmissionRequest` in `src/types/api.ts` and thread it into `submitQuote` in `src/api/quotewise-api.ts` (FR-061/062)
- [X] T039 [US7] Add the `LIST_COLLECTIONS` handler (reuse `listCollections()`) in `src/background/service-worker.ts` / `src/background/api-handler.ts` (FR-060)
- [X] T040 [US7] Add the default-collection picker + auto-add toggle to `src/options/index.ts` (populate from `LIST_COLLECTIONS`, preselect `default_collection_id`, honest empty/error state, persist choice to `settings`) (FR-060) — **after T032 (same file)**
- [X] T041 [US7] Apply auto-add on submit (read `settings.autoAddToCollection`/`defaultCollectionId`; on collection failure keep the successful quote and surface honest notice via the progress/error path) in `src/content/ui/overlay-bar.ts` / `action-button.ts` (FR-061/063) — **overlay-bar.ts edit after T035**

**Checkpoint**: SC-007 satisfied.

---

## Phase 10: User Story 8 — Similar-match word-level diff (Priority: P2)

**Goal**: Replace the read-only near-match badge with a word-level diff (captured vs on-record), no percentage,
plus a "view existing quote" link; degrade gracefully when on-record text is missing.

**Independent Test**: Near match → marked word diff + view link, no %; decodable under simulated deuteranopia/
protanopia + reduced motion/high contrast; exact/no-match → no diff; missing on-record text → read-only fallback.

- [X] T042 [P] [US8] Test-first: `diffWords` LCS (identical→all equal; pure insert/delete; substitution; reorder; empty captured/on-record; unicode/emoji), in `tests/utils/word-diff.test.ts` per contracts/similar-diff.md §A
- [X] T043 [P] [US8] Implement `src/utils/word-diff.ts` (`WordDiffToken`, `diffWords` LCS over whitespace tokens, **no dependency**) to pass T042
- [X] T044 [P] [US8] Characterization test: near-match (`new_version` family) renders marked diff + view link, no similarity %, markers decodable without color; exact/no-match render no diff; missing `matches[].text` → read-only fallback, in `tests/content/similar-diff.test.ts` per contracts/similar-diff.md §B
- [X] T045 [US8] Implement `src/content/ui/components/similar-diff.ts` (render `diffWords` with marker+typography for added/removed, `prefers-contrast` aware, view link from `matches[].url`/`short_code`, read-only fallback) (FR-070..073)
- [X] T046 [US8] Integrate `similar-diff` into the near-match path (replace the read-only near-match presentation for the `new_version` family) in `src/content/ui/components/duplicate-badge.ts` and `src/content/ui/overlay-bar.ts` (FR-070) — **overlay-bar.ts edit after T041**

**Checkpoint**: SC-008 satisfied.

---

## Phase 11: User Story 9 — Add earlier sighting (Priority: P3 — BLOCKED on django-api)

**Goal**: Date-gated "add as earlier sighting" action, offered only when the matched record's **published date** is
available AND the tweet is strictly older. Ships **hidden/disabled** until the API exposes that date; never uses
record-creation time. Honest "sighting" label.

**Independent Test**: Until `matches[].quote_date` ships → action hidden (even when a record-creation timestamp is
present). Once present → offered only when tweet strictly older, with the "older than our records" hint; otherwise
read-only. Label says "sighting", never "variant".

- [X] T047 [P] [US9] Test-first: capability gate — `addSighting.available===false` whenever `quote_date` absent (incl. record-creation present, which must NOT be used); `eligible` only when `quote_date` present AND `TwitterData.date` strictly earlier; label is the sighting wording, in `tests/content/add-sighting.test.ts` per contracts/similar-diff.md §C
- [X] T048 [US9] Add optional, consumed-only `quote_date` to `DuplicateCheckResult.matches[]` in `src/types/api.ts` (may be absent; absence ⇒ feature unavailable, not an error) (data-model §9)
- [X] T049 [US9] Implement the `SimilarMatchView.addSighting` capability check + hidden/disabled UI (date-gate; honest sighting label; never record-creation fallback) in `src/content/ui/components/similar-diff.ts` (FR-080..083) — **after T045 (same file)**
- [X] T050 [US9] Record the blocking django-api dependency (`matches[].quote_date` published date) in the spec Dependencies + keep the action hidden until shipped; optionally file a bd issue `--labels chrome-ext,django-api` (no `--repo`) tracking the unblock

**Checkpoint**: SC-009 satisfied in its gated (hidden) form; unblocks when the API field ships.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Constitution conformance + release hygiene across all stories.

- [X] T051 [P] Accessibility audit (FR-100): every new surface (options page, account menu, progress indicator, first-run notice, similar-diff) is keyboard-operable, ARIA-labelled, status by glyph/text not color, honors `prefers-reduced-motion`/`prefers-contrast`
- [X] T052 [P] Verify no new manifest permission and `cookies` absent in all three manifests; `package.json` `dependencies` stays empty (FR-101/SC-010)
- [X] T053 Verify `splitChunks: false` preserved and `options/index` bundles to a single file; run `bun run build`, `bun run type-check`, `bun run lint` green
- [X] T054 Run `specs/005-capture-overlay-tray/quickstart.md` validation across US1–US9
- [X] T055 [P] Secret-hygiene check (FR-034/Article III.3): no token/cookie/secret value appears in logs, errors, or diagnostics from the logout / clear-data / private-mode flows

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: T001→T002 (same file); T003 [P].
- **Foundational (P2)**: T004→T005; T006 [P]. Depends on Setup. **Blocks US4 (T006), US5/US6/US7 (T005).**
- **User stories (P3+)**: depend on Foundational. Recommended order by priority: US1→US2→US3→US4→US5→US6 (P1),
  then US7, US8 (P2), then US9 (P3).
- **Polish (P12)**: after all targeted stories.

### Story dependencies & shared-file serialization

- **US1 → US2 → US5(T027) → US6(T035) → US7(T041) → US8(T046)**: all edit `overlay-bar.ts` — serialize in this order.
- **US4(T018,T019) → US5(T023,T024,T025) → US6(T034) → US7(T039)**: all edit `service-worker.ts` — serialize.
- **US5** requires Foundational T005 (settings-store) + reads icon-states/resolver.
- **US6** requires Foundational T005; its options page (T032) is a prerequisite for **US7 T040** (picker added there).
- **US7** requires US6 options page (T040 extends `options/index.ts`).
- **US8** is otherwise independent (new files + `duplicate-badge.ts`/`overlay-bar.ts` integration).
- **US9** requires **US8** (`similar-diff.ts` from T045).

### Within each story

- Tests are written FIRST and must FAIL before implementation (TDD, Article VI.1).
- Types/util before consumers; service-worker handlers before UI wiring.

---

## Parallel Opportunities

- **Setup**: T003 [P] alongside T001/T002.
- **Foundational**: T006 [P] alongside T004/T005.
- **Cross-story (after Foundational)**: stories touching disjoint files can run in parallel — e.g. **US3**
  (progress, mostly new files), **US4** (service-worker, but coordinate with US5/US6 ordering), and **US8** (new
  util + new component) have little file overlap with each other.
- **Within a story** — examples:
  - US3: `T013 [P]` + `T014 [P]` (test + new component) before `T015` wiring.
  - US4: `T016 [P]` + `T017 [P]` (two independent test files) before `T018`/`T019`.
  - US5: `T020 [P]` + `T021 [P]` + `T026 [P]` (resolver test, gate test, notice component) before SW wiring.
  - US8: `T042 [P]` + `T043 [P]` + `T044 [P]` (diff test, diff util, render test) before `T045`/`T046`.

### Parallel example — User Story 8

```bash
# Launch the independent US8 pieces together (test-first):
Task: "diffWords LCS tests in tests/utils/word-diff.test.ts"          # T042 [P]
Task: "Implement src/utils/word-diff.ts (LCS, no dep)"               # T043 [P]
Task: "similar-diff render characterization in tests/content/similar-diff.test.ts"  # T044 [P]
# Then T045 (render component) → T046 (integrate into duplicate-badge/overlay-bar)
```

---

## Implementation Strategy

### MVP first (P1 shell = US1–US6)

1. Setup (Phase 1) → Foundational (Phase 2).
2. US1 (declutter) — ship the cleanest, lowest-risk win first.
3. US2 (controls) → US3 (progress) → US4 (logout/clear-data) → US5 (Private mode/Paused) → US6 (settings/menu).
4. **STOP & VALIDATE**: the P1 privacy + UX shell is independently testable and demoable.

### Incremental delivery (P2/P3)

5. US7 (default-collection auto-add) — needs the US6 options page.
6. US8 (similar-match diff) — independently shippable now (on-record text already returned).
7. US9 (add earlier sighting) — implement gated/**hidden**; flip on when django-api ships `matches[].quote_date`.

### Notes

- [P] = different files, no incomplete-task dependency; respect the overlay-bar.ts / service-worker.ts hotspots.
- Verify each test FAILS before implementing (TDD).
- No new manifest permission; no new runtime dependency; `splitChunks: false`; manifests kept in sync.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
