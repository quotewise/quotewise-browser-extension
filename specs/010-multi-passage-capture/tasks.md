---
description: "Task list for Spec 010 — Capture Multiple Passages from the Same Post"
---

# Tasks: Capture Multiple Passages from the Same Post

**Input**: Design documents from `/specs/010-multi-passage-capture/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D8), data-model.md, contracts/duplicate-check-consumed.md, quickstart.md

**Regenerated 2026-07-13** (analyze pass 2). Resolves, in addition to pass 1: identifier-only payload
wording (C1), Shadow-DOM panel fixture characterization (C4), UX/a11y coverage (C5), disclosure sync
(C6), text-required blocking (I1), one unified `'unknown'` count state (I2), panel independent of
selection (I3), "up to 5 + N more" wording (I4), badge saturation + exact-count title (I5), malformed
shape assertions (U1), FR-007 source-URL assertion (G1), T017 not `[P]` (O1), snippet truncation (A1).

**Tests**: INCLUDED. Two kinds, per Constitution Art. VI:
- **Test-first (red before green)** for *deterministic logic*: `normalizeQuoteText`, the text-scoped
  classifier + matched-link resolver, the count resolver, and the identifier-only preflight payload.
  Their tests are written and MUST FAIL before implementation.
- **Characterization (after implementation)** for *DOM / Shadow-DOM UI*: the in-post-content
  selection guard **and the passages panel**, asserted against **captured-HTML fixtures** (VI.2), plus
  the overlay flow via the existing `getSelection()` stub.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (P1) or US2 (P2); no label for Setup / Foundational / Polish
- Exact file paths are included in each task

## Path Conventions

Single-project MV3 extension: sources under `src/`, tests under `tests/` (mirrors `src/`).

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Confirm the baseline is green: run `bun run test && bun run type-check && bun run lint` and note the pre-change pass state (SC-006 regression guard).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The consumed-response type surface both stories read from. MUST complete before US1 or US2.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Extend `src/types/api.ts` — on the `DuplicateCheckResult` `existing_sightings_for_url[]` entry add optional `text?: string`, `short_code?: string | null`, `web_url?: string | null`; add top-level optional `existing_sightings_total?: number`. All optional-on-read (Art. V drift tolerance) per contracts §1.

**Checkpoint**: Response shape available — US1 and US2 can proceed (in parallel if staffed).

---

## Phase 3: User Story 1 - Capture another passage from a post I already captured from (Priority: P1) 🎯 MVP

**Goal**: Make the "already captured" block text-scoped, not URL-scoped, so a *new* selection on an already-captured post is submittable and framed as "Capture another passage"; an identical selection still blocks (linking to *that* passage). Client-only; ships against the live backend. Includes the **Article II privacy fix** — the automatic preflight becomes identifier-only.

**Independent Test**: On a long tweet/X Article, capture the full post; reopen the overlay, highlight a *different* line → Submit enabled → creates a second distinct quote at the same URL. Re-selecting the *same* line shows "Already captured this passage" (disabled) linking to the matched quote.

### Tests for User Story 1 (test-first — write and see them FAIL before implementing) ⚠️

- [ ] T003 [P] [US1] Write `tests/utils/quote-text.test.ts` for `normalizeQuoteText`: NFKC + collapse internal whitespace + trim; `"  A\n B "` and `"A B"` normalize equal; NFKC-equivalent forms normalize equal; case preserved (case-distinct strings stay distinct). (research D2)
- [ ] T004 [P] [US1] Write `tests/utils/duplicate-status.test.ts`: **(a)** text-scoped classifier — URL with a prior passage **and a different** `currentText` ⇒ NOT `exact`/`exact_sighting` (allow); **same** `currentText` (normalized) ⇒ `exact`/`exact_sighting` (block); `currentText` **omitted/empty ⇒ non-blocking** (never `exact` from URL presence alone — FR-002/I1). **(b)** `matchedSightingForText(result, currentText)` returns the `existing_sightings_for_url[]` entry whose normalized text equals the selection — assert its `web_url`, and that it is **not** `matches[0]` when several passages exist (G2). **(c)** malformed shapes: `existing_sightings_for_url` **not an array**, or an entry whose `text` is a **non-string** ⇒ excluded from the match set, never throws (U1). **Note (C1/VI.2)**: case (a) IS the **failing reproduction** of the URL-scoped duplicate-block bug — it fails against current code (which returns `exact` from URL presence alone) and runs **before** the fix (T007 → T009/T010). Per VI.2's own rule, the overlay/badge UI is **characterized afterward** (T012/T023), not red-first. (research D1)
- [ ] T005 [P] [US1] Write/extend `tests/background/service-worker.test.ts`: the **`automatic-preflight`** `PREFLIGHT_CHECK` payload contains **no quote text and no tweet/user data beyond `{handle, source_url}`** (⊆ the Article II allowlist) — assert that set is exactly the tweet/user data present, and the only other field is the fixed client `platform` constant equal to `"twitter"` (permitted per Art. II.1, amendment v1.1.0 — non-identifying, never user data). The **`explicit-duplicate-check`** path still includes `text`. Fails against current code where the automatic preflight sends `text: postData.text` (CON1/C1/FR-014; contracts §1b).

### Implementation for User Story 1

- [ ] T006 [US1] Create `src/utils/quote-text.ts` exporting `normalizeQuoteText(s: string): string` = `s.normalize('NFKC')` → collapse `\s+` to a single space → `trim()`. (contracts §2; **depends on T003**)
- [ ] T007 [US1] Text-scope the classifier in `src/utils/duplicate-status.ts`: `classifyDuplicateSighting(result, currentText?)` and `classifyMatchResolution(result, currentText?)` return `exact_sighting`/`exact` **only** when `normalizeQuoteText(currentText)` equals some `normalizeQuoteText(existing_sightings_for_url[i].text)`; URL has ≥1 passage but no match ⇒ non-blocking (allow); `currentText` **omitted/empty ⇒ a non-blocking state, never `exact` from URL presence alone** (FR-002/I1). **Remove** the `existing_sightings_for_url.length > 0 → exact` short-circuits (~L29 and ~L80). Add `matchedSightingForText(result, currentText)` returning the normalized-equal entry (G2). (contracts §2, research D1; **depends on T004, T006**)
- [ ] T008 [US1] In `src/background/service-worker.ts`: remove `text: postData.text` from the **automatic-preflight** `PREFLIGHT_CHECK` data (~L3558) so the passive payload carries **no quote text and no tweet/user data beyond `{handle, source_url}`**; the fixed `platform` constant (`"twitter"`) stays (permitted per Art. II.1 amendment v1.1.0 — a non-identifying client build constant). Leave the `explicit-duplicate-check` site (~L3369, which sends `text`) unchanged. (FR-014, research D5; **depends on T005**)
- [ ] T009 [US1] In `src/content/ui/overlay-bar.ts`: pass the **resolved current text** (`selectedText` || the extracted full-post `currentData.text`) into the classifier (T007) — a whitespace-only selection falls back to full-post text and receives normal duplicate status; only a genuine extraction failure (no text at all) is non-blocking (I3). Relax the submit `exact_sighting` guard to the text-scoped result; extend the selection watcher (`startSelectionWatcher`, today Article-only ~L887) to **all** posts so a selection change re-runs the duplicate check and updates preview + submit label; reuse the already-resolved originator across passages (partial reset — clear selection/preview/duplicate state, keep originator); **guard the non-blocking fuzzy lookup so a superseded selection's late response is ignored** (tag each request with its selection; apply only if it still matches the current selection — newest-selection-wins, U2); after a successful capture, invalidate `preloadedDuplicateCheck` so status refreshes (FR-004, FR-005, FR-010). (**depends on T007**)
- [ ] T010 [US1] In `src/content/ui/components/duplicate-badge.ts`: gate the "Already captured this passage" + View-quote directive on the **text match** (not URL presence), with the View link resolved from the **matched entry's** `web_url` via `matchedSightingForText` (G2, **not** `matches[0]`); add the `new-at-known-url` copy/directive — Submit **enabled** with "Capture another passage" / "Add this passage" plus a notice that the post already has a captured quote. Keyboard-operable + visible focus + ARIA; status by glyph/text not color alone (FR-003, FR-004, FR-012). (**depends on T007**; shares file with T018 → sequence)
- [ ] T011 [US1] In `src/content/ui/components/similar-diff.ts`: pass the current selection text into `classifyMatchResolution` so a near-identical selection at an **already-known URL** reaches the similar/variant path instead of the removed URL-exact short-circuit (G1-pass1). (**depends on T007**)

### Flow characterization for User Story 1

- [ ] T012 [US1] Characterize the flow in `tests/content/ui/overlay-bar.test.ts` using the existing `window.getSelection()` stub (tests/setup.ts): a new distinct selection on an already-captured URL ⇒ Submit enabled + "Capture another passage" + originator preserved; a matching selection ⇒ Submit disabled; a selection change re-runs the check; `preloadedDuplicateCheck` invalidated after submit. **G3 targeted assertions**: exact text shown with no editable field (FR-006); **unauthenticated** still blocks (login gate not overridden); **low-confidence** extraction still refuses (FR-013). **FR-007/G1 assertion**: a submitted passage carries the post's `source_url`, and two distinct passages produce two submits sharing that URL (distinct quotes; no URL change or merge). **AMB1 network assertion**: opening the overlay and changing the selection update the panel/count/exact-match from **cached** URL-scoped data with **no blocking network call** (mock `sendMessage`; assert submit-state + panel resolve without awaiting it); the text-bearing fuzzy/similar lookup is a **non-blocking** explicit-action request that updates the similar UI when it returns. **U2 stale-response test**: after two rapid selection changes, a late fuzzy response for the *first* selection does NOT overwrite the current (second) selection's state — newest-selection-wins (stale responses dropped). (research D7; **depends on T009, T010**)
- [ ] T013 [US1] Characterize `tests/content/ui/components/similar-diff.test.ts`: a near-match (non-identical) selection at an already-known URL routes to the sighting-vs-variant choice rather than being blocked as URL-exact. (**depends on T011**)

### Fixtures & DOM/UI characterization for User Story 1 (captured-HTML, Art. VI.2)

- [ ] T014 [P] [US1] Add captured-HTML fixtures under `tests/fixtures/`: one **ordinary X post** and one **X Article** (real captured markup), plus a small fixture-loader helper if none exists. Closes C3-pass1's "no captured HTML fixture exists." Reused by T015 (guard) and T023 (panel). (research D7)
- [ ] T015 [US1] Characterize the **in-post-content selection guard** against both fixtures in `tests/content/` (ordinary post + Article): an in-content selection is accepted as a passage; a selection anchored outside post content (nav / sidebar / another post) is rejected — verified for **ordinary posts**, not only Articles (the watcher-to-all-posts change). (VI.2; **depends on T014, T009**)

**Checkpoint**: US1 fully functional and independently testable — a user can capture a second distinct passage; the passive preflight sends no quote text; the exact-match link points to the matched passage. MVP **feature-complete** here — but **not releasable** until the Polish gates (T024–T027) and the mandatory VI.3 drift-check (T028–T029) are done (Constitution VI.3 / IX; see C2).

---

## Phase 4: User Story 2 - See what a post already holds when it has multiple captured passages (Priority: P2)

**Goal**: Show a global "N passages captured from this post" panel (up to 5 snippets + "+N more") **whenever the URL has captures**, and surface the distinct-passage count on the toolbar badge (numeric only at ≥ 2; saturates at `9+` with the exact count in the accessible title). Consumes the shipped ADR-0007 fields, defensively validated to a single `'unknown'` neutral state.

**Independent Test**: On a post with 6 captured passages, open the overlay → panel lists 5 entries (snippet + working `web_url` link each) plus "+1 more"; the toolbar icon shows `6` and its hover/title reads "… 6 passages captured from this post". Exactly 1 capture → single-capture glyph (no number); 0 → "new".

### Tests for User Story 2 (test-first for the deterministic resolvers) ⚠️

- [ ] T016 [P] [US2] **(a)** Write count-resolver cases in `tests/background/icon-state-resolver.test.ts` **and** `tests/utils/duplicate-status.test.ts` covering **every row of the canonical count truth table** (contracts §2): `result` null **or** `search_metadata.error === true` ⇒ `'unknown'`; valid non-negative-integer `existing_sightings_total` ⇒ that count (`>= 2` badge, `1` glyph, `0` "new"); total absent + list a valid array with **length < 50** ⇒ that length (exact); total absent + list **length == 50** ⇒ `'unknown'` (may be capped); total **present-but-malformed** **or** list present-but-not-array ⇒ `'unknown'`; **both absent (clean success)** ⇒ `0` ("new"). `'unknown'` ⇒ neutral 'has captures', **no numeric badge**, never `0`/"new" (C4/I1/I2/INC1). **(b) CON2 applicator test-first**: extend `tests/background/icon-applicator.test.ts` — **replace** the existing `never calls setBadgeTextColor` invariant with the new behavior: for a count-badge presentation, assert saturating badge text (`1`–`9` then `9+`), an exact-count `setTitle`, and that `setBadgeTextColor`/`setBadgeBackgroundColor` **are** called; written to FAIL before T021. (research D4, D8)

### Implementation for User Story 2

- [ ] T017 [US2] Add `passageCountForUrl(result): number | 'unknown'` to `src/utils/duplicate-status.ts`, implementing the **canonical count truth table (contracts §2)** exactly: `result` null or `search_metadata.error === true` ⇒ `'unknown'`; else `existing_sightings_total` if a non-negative integer (authoritative); else (total absent) `existing_sightings_for_url.length` **only if a valid array with length < 50** else `'unknown'`; total present-but-malformed or list present-but-not-array ⇒ `'unknown'`; both absent (clean success) ⇒ `0` — never NaN/negative/throw (C4/I1/I2/INC1). Sequence after T007 (same file — **not `[P]`**, O1). (contracts §2)
- [ ] T018 [US2] In `src/content/ui/components/duplicate-badge.ts`: render the passages panel **whenever the URL has captures**, driven by validated URL-passage data / `passageCountForUrl` — **independent of the current selection's block/allow classification** (I3), so it shows in both `already-captured-here` and `new-at-known-url` states. Heading: "N passages captured from this post" from `existing_sightings_total`; when count is `'unknown'` ⇒ a neutral "this post already has captures" heading with **no number** (I2). Then **up to 5** `existing_sightings_for_url[]` entries, each a `text` snippet **truncated by character count** (slice the **original verbatim `text`** — do **NOT** normalize for display; normalization is only for identity matching — to 100 chars + `…` when longer; deterministic and unit-testable, **NOT** CSS `line-clamp`; I2/INC2/A1) and **linked to `web_url` when valid** (scheme-validated via `safeHref`; missing/invalid ⇒ snippet without link), plus **"+N more"** when more passages exist than shown (I4); missing `text` ⇒ skip entry. Links keyboard-operable + visible focus + ARIA (FR-008/011/012; contracts §1,§4). (**depends on T002, T017**; shares file with T010 → sequence)
- [ ] T019 [US2] In `src/background/icon-state-resolver.ts`: thread the passage count (from `passageCountForUrl`, T017) into presentation — `>= 2` ⇒ count-badge; `1` ⇒ single-capture glyph; `0` ⇒ unchanged; `'unknown'` ⇒ neutral 'has captures' presentation with **no numeric badge** (I2). (**depends on T016, T017**; research D8)
- [ ] T020 [P] [US2] In `src/config/icon-states.ts`: add the count-badge presentation (badge text/color) for total ≥ 2, reusing the existing collected/exists palette for contrast. (contracts §3)
- [ ] T021 [US2] In `src/background/icon-applicator.ts`: apply the count via `chrome.action.setBadgeText({ tabId, text })` — the badge **saturates at `9+`** (Chrome's ~4-char limit; `""` clears) — acceptable **only because** `chrome.action.setTitle({ tabId, title })` is **always** set and **carries the EXACT count in words** (e.g. "Quotewise — 12 passages captured from this post"), which screen readers announce (FR-009/I5). Plus `setBadgeTextColor`/`setBadgeBackgroundColor`. Per-tab (`tabId`). (**depends on T016** — the failing applicator test that replaces the old `never setBadgeTextColor` invariant (CON2) — **T019, T020**; research D4, Art. VII.2)
- [ ] T022 [US2] In `src/background/service-worker.ts`: pass the validated count from the cached duplicate-check result into the resolver→applicator path; ensure the post-capture `preloadedDuplicateCheck` invalidation (T009) drives a re-resolve so count/panel/icon are not stale (FR-010, I4-pass1). (**depends on T019, T021, and T009**; shares file with T008 → sequence)

### Panel characterization for User Story 2 (captured-HTML fixture, Art. VI.2)

- [ ] T023 [US2] Characterize the panel in `tests/content/ui/components/duplicate-badge.test.ts` (**corrected path**, A2-pass1) **against the captured-HTML fixtures from T014** (Shadow-DOM UI MUST be fixture-characterized — C4): multi-passage response ⇒ heading with correct count, ≤ 5 linked snippets + capped-list "+N more"; snippet **character-truncated** to ≤ ~100 chars + `…` (deterministic — assert the rendered snippet text length, INC2/A1); `web_url` failing `safeHref` ⇒ snippet without link; **malformed shapes** (non-array list, non-string `text`, `'unknown'` count) ⇒ neutral "this post already has captures", no number, never throws (U1/I2); panel renders in the `already-captured-here` state too (I3); empty set ⇒ no panel; the "already captured" View link targets the **matched** entry, not the first (G2). **A11y (VII/C5):** panel links keyboard-operable with **visible focus** + ARIA, status by glyph/text not color alone; panel inherits the overlay's shared dismissability / `prefers-reduced-motion` / `prefers-contrast` / no-layout-shift (cite shared overlay coverage). (**depends on T014, T018**)

**Checkpoint**: US1 + US2 both work independently; the overlay and toolbar honestly reflect how many passages a post holds; malformed counts degrade to one neutral state.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T024 Run the full suite + static checks: `bun run test`, `bun run type-check`, `bun run lint` — all green (SC-006).
- [ ] T025 Manual e2e per `quickstart.md` §"End-to-end" on a long tweet / thread / X Article: capture full post → new passage submittable (`action="created"`) → re-select passage #2 blocks with a View link to **that matched** quote → panel shows ≤ 5 snippets + "+N more" (and still shows while blocked) → badge count appears only at ≥ 2, saturates `9+` while the title states the exact count → single/zero-capture posts unchanged. Confirm the **G3 protected paths** (login, low-confidence, verbatim/no-edit) are unaffected. **A11y walkthrough (VII/C5)**: "Capture another passage" and panel links are keyboard-reachable with visible focus, the overlay stays dismissable, no host-page layout shift, and reduced-motion / high-contrast are honored. **SC-006 targeted regressions (G1)**: on a single/zero-capture post, the **attribution-conflict** resolution and the **spec-009 collection-picker** behave exactly as before — a passage whose text matches a quote attributed to a different originator routes through the unchanged conflict path; the per-passage collection picker still seeds last-used → default → blank.
- [ ] T026 Constitution/permission check: `git diff manifest*.json` empty (no new permissions); **verify the automatic-preflight request carries no quote text and no tweet/user data beyond `{handle, source_url}`**; the only other field is the fixed `platform` constant (`"twitter"`), permitted per Art. II.1 (amendment v1.1.0) (FR-014); `web_url` navigates only on http/https (Art. II/III per quickstart §"Verify no regressions").
- [ ] T027 **Disclosure sync (Art. II.3, C6)**: the pre-action egress changed (quote text removed from the automatic preflight), so verify and, if needed, update **`docs/chrome-web-store-listing.md`**, **`docs/chrome-web-store-privacy-practices.md`**, and **`docs/chrome-web-store-permissions.md`** so they accurately state the pre-action bound (`{tweet_id, handle, source_url}` + the fixed non-identifying `platform` constant; **no quote text**). Also flag the **external Chrome Web Store dashboard listing / privacy-practices form** (owned by the store-listing maintainer) for the same update. Documentation/disclosure check — no code.

---

## Phase 6: Standing Gate — Live-X DOM Drift Check (Constitution VI.3)

**Purpose**: Satisfy the mandatory scheduled drift check (VI.3), folded into this feature per the 2026-07-13 governance decision (bead `qw-5j5nj`). Repo infra, independent of US1/US2 — can run anytime after Setup.

- [ ] T028 Add a scheduled, **non-blocking** drift-check workflow **`.github/workflows/drift-check.yml`** — **cron `0 6 * * *`** (daily 06:00 UTC), **`permissions: { issues: write, contents: read }`** — running the checker **`scripts/drift-check.mjs`** that loads the spec-003 DOM selectors and asserts they still match a **pinned set of stable public X targets** (define `DRIFT_TARGETS` in the script: one status URL + one X Article URL, documented as the canonical fixtures). On mismatch it opens/updates a **single deduplicated issue** keyed by the label **`dom-drift`** + a fixed title (via `actions/github-script`: find the open `dom-drift` issue and comment, else create — never duplicate). The check step uses **`continue-on-error: true`** and this is a **separate workflow** from `ci.yml` (never gates PRs). **U1 specifics**: (1) **selector source** — the checker imports the spec-003 selector constants from a **single machine-readable module** shared with production (export them from `src/platforms/twitter/adapter.ts`, or extract to `src/platforms/twitter/selectors.ts` the adapter imports) so the checker cannot drift from the real selectors; (2) **rendering** — X is a JS-rendered SPA, so each target is loaded in **headless Chromium (Playwright, a CI-only dev dependency)**, waiting for the `article` element before evaluating selectors; (3) **failure classification** — network / HTTP / rate-limit / nav-timeout (per-target **30 s** timeout) ⇒ **inconclusive**: logged, job stays neutral, **no issue filed**; a target that **renders** but whose required selectors return no match ⇒ **drift**: file/update the `dom-drift` issue. Only the drift class opens an issue. (Constitution VI.3; AMB2/U1)
- [ ] T029 Verify VI.3 compliance: the workflow runs on a **schedule** (not only push/PR), does **not** gate the build (CI stays green on selector drift), and **opens a tracked issue** on simulated drift. Close bead `qw-5j5nj` when green.

**Checkpoint**: The mandatory live-X drift check runs on a cadence and files issues without breaking the build — VI.3 satisfied.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: none — run first for the baseline.
- **Foundational (T002)**: after Setup — BLOCKS US1 and US2 (both read the extended response type).
- **US1 (T003–T015)**: after T002. Ships independently (client-only; live backend).
- **US2 (T016–T023)**: after T002. Consumes shipped ADR-0007. Independently testable; **T022 requires T009** (US1's cache invalidation) for the "refresh after capture" scenario — otherwise US2's panel/badge are independent.
- **Polish (T024–T027)**: after the desired stories are complete.
- **Phase 6 (T028–T029, VI.3 drift check)**: independent repo infra — runs anytime after Setup; not gated by US1/US2.

### Within/Across Stories (test-first + shared files)

- **Test-first (C2-pass1)**: T003 → T006; T004 + T006 → T007; T005 → T008; T016 → T017/T019. Deterministic-logic tests precede their implementation; never `[P]` with it.
- **Ordering**: T006 before T007; T007 before T009/T010/T011 **and T017** (shared file); T014 before T015 and T023; T009/T010 before T012; T011 before T013; T017 before T018/T019; T019 + T020 before T021; T019/T021 + **T009** before T022; T018 before T023.
- **Shared-file sequencing (NOT `[P]` against each other)**:
  - `src/utils/duplicate-status.ts` — T007 (US1 classifier + resolver) then T017 (US2 count helper). *(O1: T017 is not `[P]`.)*
  - `src/content/ui/components/duplicate-badge.ts` — T010 (US1 copy/link) then T018 (US2 panel).
  - `src/background/service-worker.ts` — T008 (US1 preflight) then T022 (US2 count plumbing).

### Parallel Opportunities

- **US1 tests**: T003, T004, T005 are `[P]` (three distinct test files) — all *tests*, before any implementation.
- **Fixtures**: T014 `[P]`.
- **US2**: T016 and T020 are `[P]` (resolver test + icon-states table). **T017 is NOT `[P]`** (shares `duplicate-status.ts` with T007 — O1).
- After T002, US1 and US2 can be staffed in parallel; mind the three shared files above.

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 baseline → T002 type surface → T003–T015 (US1).
2. **STOP and VALIDATE** (validation checkpoint, **not a release**): capture a second distinct passage end-to-end; verify identical-selection block links to the matched quote; verify the automatic preflight sends **no quote text**. **Any actual release additionally requires** the Polish gates (T024–T027) and the VI.3 drift-check (T028–T029) — Constitution VI.3 / IX (C2).

### Incremental Delivery

1. Setup + Foundational → response type ready.
2. US1 → text-scoped capture + identifier-only preflight (MVP feature-complete; release-gated on Polish + VI.3).
3. US2 → passages panel (≤5 + "+N more", selection-independent) + accessible count badge (≥ 2), defensively validated to one `'unknown'` state.
4. Polish → full regression + manual e2e + permission/privacy check + disclosure sync.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- Deterministic logic is **test-first**; DOM/Shadow-DOM UI (guard **and panel**) is **characterized** against captured-HTML fixtures (VI.2) and the `getSelection()` stub — never red-first against live X.
- Malformed/missing data ⇒ one `'unknown'` neutral state ("this post already has captures", no number), never `0`/"new", never throw — Art. V / C4 / I2.
- Pre-action egress is **reduced** to `{handle, source_url}` (+ non-identifying `platform` constant); no quote text (Art. II fix); disclosure re-synced (T027). Badge paired with an exact-count `setTitle`.
- **V.2 (kill-switch)** is a standing tracked requirement per constitution amendment v1.1.0 (bead `qw-g4s31`), deferred — not addressed here. **VI.3 (live-X drift check) IS built here** (Phase 6, T028–T029; bead `qw-5j5nj`).
- Commit after each story checkpoint.
