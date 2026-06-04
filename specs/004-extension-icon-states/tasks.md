---
description: "Task list for Extension Toolbar Icon States"
---

# Tasks: Extension Toolbar Icon States

**Input**: Design documents from `/specs/004-extension-icon-states/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED. Constitution Article VI.1 mandates test-first for deterministic logic (the
resolver + duplicate-status mapping), and spec.md §Implementation/§Testing request them. Per-story
tests are written **red before** their implementation.

**Organization**: Tasks are grouped by user story (US1–US6 from spec.md, in priority order) so each
delivers an independently testable increment. NOTE: this is a **consolidation** feature — all stories
share one pure resolver (`icon-state-resolver.ts`) and one mapping (`duplicate-status.ts`); the
resolver grows one precedence branch per story (test-first). Tasks on the same file across stories
are therefore **sequential**, not `[P]`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6; Setup/Foundational/Polish carry no story label
- File paths are repo-relative (single-project MV3 layout per plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tooling and source assets needed before any state logic or art exists.

- [ ] T001 [P] Add the rasterizer devDependency: `bun add -d @resvg/resvg-js`; confirm it lands in `package.json` devDependencies and is pinned in `bun.lock` (Constitution III.2; dev-only, never shipped)
- [ ] T002 [P] Vendor the vector master to `assets/owl.svg` from the brand `quotewise.svg` (the **5-path** version with eye/nose/feet; **not** `quotewise-light.svg`), composited per FR-061: owl `beige` centered ~78% on a `#304f50` rounded square (radius ≈19%); document the grey params (owl `#dcdcdc` on `#6f6f6f`)
- [ ] T003 [P] Create `scripts/generate-icons.mjs` (resvg: `new Resvg(svg,{fitTo:{mode:'width',value:n},shapeRendering:2}).render().asPng()` per `n∈{16,32,48,128}`, emitting color + `-grey` PNGs to `public/icons/`) and add `"icons": "node scripts/generate-icons.mjs"` to `package.json` scripts (per contracts/icon-assets.md)
- [ ] T004 [P] Extend Chrome API mocks in `tests/setup.ts` to cover `chrome.action.setIcon` and `chrome.action.getBadgeText` (existing mock covers setBadgeText/Color/setTitle), and add red applicator tests in `tests/background/icon-applicator.test.ts`: correct color/grey icon paths, `tabId` included iff `scope==='tab'` or auth-cleanup `forceTabScope` is used, `setBadgeTextColor` is never called, and a prior tab-scoped `★` is overwritten on logout/session-expiry

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single resolver/applicator backbone every user story plugs into.

**⚠️ CRITICAL**: No user story can begin until this phase completes.

- [ ] T005 [P] Define presentation types: `IconPresentation` and `TabContext` in `src/background/icon-state-resolver.ts`; `QuoteStatus` type in `src/utils/duplicate-status.ts` (per data-model §3 / contracts/icon-state-resolver.md C1–C2)
- [ ] T006 [P] Create the canonical state/title table `src/config/icon-states.ts` — 10 canonical states / 11 title rows of `{ iconVariant, badgeText, badgeColor, title, scope }` from data-model §4 (Error has two tooltips), single voice "Quotewise — …" (including neutral AuthPending; no `setBadgeTextColor` field; FR-003)
- [ ] T007 Implement the **pure** `resolveIconPresentation(auth, dup, tab)` precedence **skeleton** in `src/background/icon-state-resolver.ts`: total, no-throw, no `chrome.*`; precedence ladder shell per data-model §6 returning ambient **Ready** as the default and reserving the AuthPending branch. Per-state branches are added in the story phases (contracts C1)
- [ ] T008 Implement `applyIconPresentation(p, tabId, options?)` in `src/background/icon-applicator.ts` — the **only** `chrome.action` caller: `setIcon` color/grey by `iconVariant`; `setBadgeText`/`setBadgeBackgroundColor`; `setTitle`; include `{ tabId }` **iff** `scope==='tab'` or `options.forceTabScope===true`; **never** call `setBadgeTextColor` (FR-003, contracts C3)
- [ ] T009 Implement `mapRecommendationToQuoteStatus(result)` scaffold in `src/utils/duplicate-status.ts` returning `'None'` for `null`/`search_metadata.error` (FR-041); keep existing `classifyDuplicateSighting`/`getMatchForDuplicateSightingState` for the tray (contracts/duplicate-status-mapping.md)
- [ ] T010 Wire resolver→applicator into `src/background/service-worker.ts` at all event points (`tabs.onUpdated` complete, `tabs.onActivated`, `webNavigation.onHistoryStateUpdated`, `TWEET_DATA_EXTRACTED`, and `AuthStateManager` state-change/`updateBadge`) and implement the **clearing/overwrite** paths: non-tweet page / tab-switch-away clears `setBadgeText({tabId,text:''})` and reapplies the resolved ambient/auth state for that tab; auth transitions also apply the resolved global auth state with `forceTabScope` to all open tweet tabs/recorded tab ids so prior tab-scoped badge/icon state cannot shadow LoggedOut/AuthPending/Ready/Error (FR-002, SC-003, SC-007; contracts C4)
- [ ] T011 Delete the three legacy presentation sources and fix all references (FR-070, SC-005): `getBadgeConfig`/`updateBadgeState`/`updateBadgeFromAuthStatus` in `src/background/auth-monitor.ts`; `getStateBadgeText`/`getStateBadgeColor` in `src/auth/auth-state-machine.ts` (keep the FSM + `getStateMessage`); `updateExtensionIconForTweetPage`/`updateCollectionBadgeForTweet`/`getCollectionBadgeConfig`/`updateCollectionBadge` in `src/background/service-worker.ts`. Run `bun run type-check` to prove no dangling imports

**Checkpoint**: One deterministic resolver+applicator is wired; legacy sources gone. Resolver returns Ready for all inputs until stories add branches.

---

## Phase 3: User Story 1 - Signed-in at a glance (Priority: P1) 🎯 MVP

**Goal**: Greyed owl when `UNAUTHENTICATED`, full-color owl when `AUTHENTICATED` — distinguishable by **artwork alone**.

**Independent Test**: Log out → toolbar owl is grey (no tooltip needed); log in → owl is full color (SC-001).

### Tests (write FIRST, ensure they FAIL)

- [ ] T012 [P] [US1] Asset-pipeline test `tests/assets/icon-pipeline.test.ts`: all 8 PNGs exist under `public/icons/`, each is `n×n`, and each `icon{n}-grey.png` is measurably less saturated than `icon{n}.png` (FR-062, data-model §8)
- [ ] T013 [P] [US1] Resolver tests in `tests/background/icon-state-resolver.test.ts`: `UNAUTHENTICATED` ⇒ `iconVariant:'grey'`, `badgeText:''`, `scope:'global'`, title "log in to capture"; `AUTHENTICATED` non-tweet ⇒ `'color'` Ready, no badge; `UNKNOWN`/`CHECKING`/`AUTHENTICATING` ⇒ color, no badge, neutral title "Quotewise" and no quote-status badge

### Implementation

- [ ] T014 [US1] Generate the assets: run `bun run icons` to emit the color + `-grey` PNG sets into `public/icons/`; commit the binaries (makes T012 pass; regenerates color set from the vector per FR-060)
- [ ] T015 [US1] Implement the **LoggedOut**, **AuthPending**, and **Ready** ambient branches in `resolveIconPresentation()` (`src/background/icon-state-resolver.ts`): `UNAUTHENTICATED`→grey global; transitional auth→neutral color/no badge; `AUTHENTICATED`→color Ready (makes T013 pass)
- [ ] T016 [US1] Change `action.default_title` "Capture Quote" → "Quotewise" in `manifest.prod.json`, `manifest.dev.json`, and root `manifest.json` (prod/dev are build-effective; root is kept in sync for local/manual consistency — FR-071, Constitution IX)

**Checkpoint**: Logged-out is visible at a glance. MVP shippable.

---

## Phase 4: User Story 2 - New & capturable ★ (Priority: P1)

**Goal**: `★` blue `#0072B2` on a tweet with no qualifying duplicate.

**Independent Test**: Open a tweet whose duplicate check returns `recommendation: new_quote` → `★` blue, tooltip "New quote — not in Quotewise yet".

### Tests (write FIRST, FAIL)

- [ ] T017 [P] [US2] Mapping tests in `tests/utils/duplicate-status.test.ts`: `null` ⇒ `None`; `search_metadata.error:true` ⇒ `None`; `new_quote`/`new_quote_known_author` ⇒ `New`; a low-similarity `match_type:'similar'` result with `recommendation:'new_quote'` ⇒ `New`; unknown `recommendation` ⇒ `New` (safe default, no throw)
- [ ] T018 [P] [US2] Resolver test in `tests/background/icon-state-resolver.test.ts`: `AUTHENTICATED` + tweet + `new_quote` ⇒ `★ #0072B2`, `scope:'tab'`

### Implementation

- [ ] T019 [US2] Implement the **New** row (and unknown-default) in `mapRecommendationToQuoteStatus()` (`src/utils/duplicate-status.ts`)
- [ ] T020 [US2] Implement the quote-status path of `resolveIconPresentation()` to render the mapped New status via `src/config/icon-states.ts` (depends on T019)

**Checkpoint**: New tweets read as `★`.

---

## Phase 5: User Story 3 - Already collected ✓ (Priority: P1)

**Goal**: `✓` green `#009E73` when any match has `in_user_collections: true`; **beats** every other quote-status state.

**Independent Test**: Revisit a tweet you collected → `✓` green even when `recommendation` is `duplicate` (SC-003 precedence).

### Tests (write FIRST, FAIL)

- [ ] T021 [P] [US3] Mapping test in `tests/utils/duplicate-status.test.ts`: a match with `in_user_collections:true` **and** `recommendation:'duplicate'` ⇒ `InCollection` (collection beats all recommendation tiers)
- [ ] T022 [P] [US3] Resolver precedence test in `tests/background/icon-state-resolver.test.ts`: InCollection wins over Exact (data-model §6.1 tie row)

### Implementation

- [ ] T023 [US3] Implement the **InCollection** short-circuit (ladder row 1) in `mapRecommendationToQuoteStatus()` (`src/utils/duplicate-status.ts`)
- [ ] T024 [US3] Ensure `resolveIconPresentation()` renders InCollection via the canonical table: `✓`, `#009E73`, `scope:'tab'`, and title "Already in your collection" (T022 must fail before this branch and pass after)

**Checkpoint**: Collected tweets read as `✓`, ahead of all other dup states.

---

## Phase 6: User Story 4 - Exact `=` vs Similar `~` (Priority: P2)

**Goal**: `=` orange `#E69F00` for an exact dup; `~` purple `#CC79A7` for a near/similar version — distinct in **both** shape and color.

**Independent Test**: A known exact-text tweet → `=` orange; a paraphrase → `~` purple; the two are not confusable at 16px (SC-006).

### Tests (write FIRST, FAIL)

- [ ] T025 [P] [US4] Mapping tests in `tests/utils/duplicate-status.test.ts`: `duplicate`/`duplicate_known_author` ⇒ `Exact`; `new_version`/`new_version_known_author` ⇒ `Similar`
- [ ] T026 [P] [US4] Resolver test in `tests/background/icon-state-resolver.test.ts`: Exact ⇒ `= #E69F00`; Similar ⇒ `~ #CC79A7` (distinct glyph+color)

### Implementation

- [ ] T027 [US4] Implement the **Exact** + **Similar** rows in `mapRecommendationToQuoteStatus()` (`src/utils/duplicate-status.ts`); recommendation tiers are mutually exclusive, but keep the final ladder ordered per FR-030 once Conflict is added
- [ ] T028 [US4] Manual legibility check (quickstart §5 / research D9): render `=` vs `~` at real 16px and 32px in the toolbar; if `~`/`=` wash out, substitute within the same shape family — never color-only

**Checkpoint**: Exact and similar are separately legible.

---

## Phase 7: User Story 5 - Attribution conflict ⚠ (Priority: P2)

**Goal**: `⚠` vermillion `#D55E00` when the quote already exists attributed to a different originator.

**Independent Test**: A tweet whose text exists under a different originator (`recommendation: attribution_conflict`) → `⚠`, tooltip "Heads up — attributed to someone else in Quotewise".

### Tests (write FIRST, FAIL)

- [ ] T029 [P] [US5] Mapping test in `tests/utils/duplicate-status.test.ts`: `attribution_conflict`/`attribution_conflict_resolved` ⇒ `Conflict`
- [ ] T030 [P] [US5] Resolver test in `tests/background/icon-state-resolver.test.ts`: Conflict ⇒ `⚠ #D55E00`, `scope:'tab'`; record whether the glyph uses plain `⚠` or text-presentation `⚠︎` so the manual 16px emoji-render check has a fixed expected value

### Implementation

- [ ] T031 [US5] Implement the **Conflict** row in `mapRecommendationToQuoteStatus()` (`src/utils/duplicate-status.ts`) before Exact/Similar in the final ladder (FR-030 order; recommendations are mutually exclusive but docs/tests stay consistent)

**Checkpoint**: Misattribution is surfaced early.

---

## Phase 8: User Story 6 - Work-in-progress ● and errors ! (Priority: P3)

**Goal**: a **static** `●` sky `#56B4E9` while a check is in flight; `!` vermillion `#D55E00` for `SESSION_EXPIRED`/`INSUFFICIENT_PRIVILEGES` (no ring), beating any quote badge.

**Independent Test**: trigger a check → static `●` (no animation); expire the session on a duplicate tweet → `!` (Error wins over the dup badge, SC-003).

### Tests (write FIRST, FAIL)

- [ ] T032 [P] [US6] Resolver test in `tests/background/icon-state-resolver.test.ts`: `isCheckInFlight:true` ⇒ static `● #56B4E9`, `scope:'tab'`
- [ ] T033 [P] [US6] Resolver test in `tests/background/icon-state-resolver.test.ts`: `SESSION_EXPIRED`/`INSUFFICIENT_PRIVILEGES` ⇒ `! #D55E00`, `scope:'global'`, and Error beats a co-occurring exact-dup result (SC-003)

### Implementation

- [ ] T034 [US6] Implement the **Loading** branch in `resolveIconPresentation()` (static `●`; **no** animation — FR-013) (`src/background/icon-state-resolver.ts`)
- [ ] T035 [US6] Implement the **Error** branch at the top of the precedence ladder in `resolveIconPresentation()` (distinct titles for session-expired vs insufficient-priv) (`src/background/icon-state-resolver.ts`)
- [ ] T036 [US6] Set `TabContext.isCheckInFlight` at the start of the duplicate/preflight check and clear it on completion in `src/background/service-worker.ts`, re-resolving on each edge (FR-013)

**Checkpoint**: All 10 states render; precedence holds.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T037 [P] Totality sweep in `tests/background/icon-state-resolver.test.ts`: assert the resolver returns a valid `IconPresentation` (no throw/undefined) across `AuthState × recommendation × {collected?} × {tweet?,inFlight?}`, including transitional auth states with duplicate data (SC-005, data-model §8)
- [ ] T038 Manual acceptance: load unpacked from `dist/`, walk quickstart §4 (steps 1–10) and §5 a11y (DevTools "Emulate vision deficiencies": deuteranopia/protanopia/achromatopsia) at 1× and 2×; explicitly confirm `⚠` renders as a text glyph, not a color emoji, and glyphs target ≥3:1 non-text contrast at 16px (SC-002, SC-004)
- [ ] T039 [P] Add a CI guard that runs `bun run icons` then `git diff --exit-code public/icons/` to fail on un-regenerated/drifted assets (research D3)
- [ ] T040 [P] Green gate: `bun run type-check && bun run lint && bun run test`; grep the bundle/src to confirm `setBadgeTextColor` is never called (FR-003)
- [ ] T041 Confirm `manifest.prod.json`, `manifest.dev.json`, and root `manifest.json` agree on `default_title` and version (prod/dev are build-effective; root is consistency-only); update CLAUDE.md "Key Files" if the new module names warrant a pointer

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no deps — start immediately.
- **Foundational (P2)**: depends on Setup. **BLOCKS all user stories.** (T007→T008→T010→T011 are sequential on shared files; T005/T006 are `[P]`.)
- **User Stories (P3–P8)**: each depends only on Foundational. They are *logically* independent increments but **physically share** `icon-state-resolver.ts` and `duplicate-status.ts`, so run them in **priority order** (US1→US6) to avoid same-file churn.
- **Polish (P9)**: after the stories you intend to ship.

### Within each story

- Tests first (must FAIL), then implementation.
- Mapping row (`duplicate-status.ts`) before the resolver branch that renders it (e.g. T019→T020, T023→T024, T027, T031).

### Story-specific notes

- **US1** additionally needs the **art pipeline output** (T014) — it is the only story that introduces `setIcon`/the grey asset; later stories reuse the color set.
- **US3** depends conceptually on the quote-status path landed in **US2** (T020); keep US2 before US3.
- **US6**'s `isCheckInFlight` wiring (T036) touches `service-worker.ts` — sequence after Foundational's T010.

### Parallel opportunities

- Setup: T001–T004 all `[P]`.
- Foundational: T005, T006 `[P]`; T007/T008/T009 are separate files (`[P]`-eligible) but T010 depends on all three.
- Within a story, the two **test** tasks are `[P]` (mapping-test file ≠ resolver-test file ≠ asset-test file).
- Across stories: **not** parallel on the shared resolver/mapping files.

---

## Parallel Example: User Story 2

```bash
# Tests first (different files → parallel):
Task: "T017 mapping tests for New in tests/utils/duplicate-status.test.ts"
Task: "T018 resolver test for ★ in tests/background/icon-state-resolver.test.ts"
# Then implementation (sequential — resolver consumes the mapping):
#   T019 (duplicate-status.ts) → T020 (icon-state-resolver.ts)
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **STOP & VALIDATE** (SC-001: logged-out is visibly grey) → demo.

### Incremental delivery

US1 (signed-in visibility, MVP) → US2 (`★`) → US3 (`✓` + precedence) → US4 (`=`/`~`) → US5 (`⚠`) → US6 (`●`/`!`). Each story is a green-test increment that never regresses the prior ones, because all flow through the one resolver.

### Constitution gates carried through

- TDD for the resolver + mapping (VI.1) — tests precede every branch.
- Pure, total, no-throw resolver; no new persisted/in-memory authoritative state (V.1).
- Drift tolerance: unknown `recommendation` ⇒ New, errored check ⇒ no badge (V.2, FR-041).
- Every visual change pairs a self-contained `setTitle` (VII.2, FR-050); glyph+color redundancy (FR-051).
- No new permission; `@resvg/resvg-js` dev-only + lockfile-pinned (III).

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- The single-resolver design is deliberate (FR-070/SC-005): accept the same-file sequencing across stories as the price of eliminating the last-writer-wins race that motivated this spec.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
- Total: **41 tasks** (T001–T041).
