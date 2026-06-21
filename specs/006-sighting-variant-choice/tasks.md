---
description: "Task list for Similarity Duplicate — Add Sighting vs Add Variant"
---

# Tasks: Similarity Duplicate — Add Sighting vs Add Variant

**Input**: Design documents from `specs/006-sighting-variant-choice/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED — Constitution Article VI mandates test-first for deterministic logic; UI covered by jsdom component tests. Write each test, watch it FAIL, then implement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 (similar decision), US2 (couldn't-verify), US3 (conflict)
- ⚠️ **Shared-file note**: `src/content/ui/components/duplicate-badge.ts` and `src/content/ui/overlay-bar.ts` are edited in all three stories → those impl tasks are **sequential** (not [P]) across stories even though the stories are independently testable.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Add shared duplicate-check test fixtures (similar / conflict / exact / couldn't-verify / legacy-no-class variants of `DuplicateCheckResult`) in `tests/helpers/duplicate-fixtures.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — every story routes through the classifier and the shared types.

- [X] T002 Extend API types in `src/types/api.ts`: add `match_source`, `match_class`, `existing_sighting_for_this_url` (all optional) to `DuplicateCheckResult.matches[]`; add `link_to_quote_id?: number` + `user_intent?: 'sighting' | 'variant'` to `QuoteSubmissionRequest`; add `action?: 'created' | 'sighting_added'` to `QuoteSubmissionResult`
- [X] T003 [P] Write FAILING unit tests for `classifyMatchResolution` in `tests/utils/duplicate-status.test.ts` (precedence `couldnt_verify` → `exact` → `conflict` → `similar` → `none`; legacy `recommendation` near-match when `match_class` absent → `similar`; absent fields never throw → `none`)
- [X] T004 Implement `classifyMatchResolution(result)` in `src/utils/duplicate-status.ts` to pass T003 (pure, total, degrade-not-throw per Article V)
- [X] T005 Refactor `DuplicateBadge.update()` to dispatch via `classifyMatchResolution` and extend `DuplicateBadgeCallbacks` with `onResolveDecision`, `onRetry`, `onResolveConflict` in `src/content/ui/components/duplicate-badge.ts` — preserve existing `exact`/`none` rendering; leave `similar`/`conflict`/`couldnt_verify` branches as no-op stubs for the story phases

**Checkpoint**: Types + classifier + badge dispatch ready — stories can begin.

---

## Phase 3: User Story 1 — Resolve a similar (near-match) quote (Priority: P1) 🎯 MVP

**Goal**: For a same-originator `similar` match, show the existing quote + diff and offer "Add as variant" (always) and "Add another sighting" (date-gated); submit the chosen `link_to_quote_id` + `user_intent`.

**Independent Test**: Stub a `similar` duplicate-check result; verify both buttons render when the tweet predates the recorded quote (variant-only otherwise), each submits the correct pair, and the confirmation matches the response `action`.

### Tests for User Story 1 (write first, must FAIL)

- [X] T006 [P] [US1] FAILING tests for `buildSimilarMatchView` in `tests/content/similar-diff.test.ts` (variant always available; sighting available only when tweet date < quote date; `quoteId` int coercion incl. NaN→null; no-text fallback to link-only; non-`https:` URL rejected)
- [X] T007 [P] [US1] FAILING tests for submit threading in `tests/api/quotewise-api.test.ts` (`submitQuote` includes `link_to_quote_id` + `user_intent` when both present, omits when not; surfaces response `action`)
- [X] T008 [P] [US1] FAILING overlay tests in `tests/content/ui/overlay-bar.test.ts` (choosing sighting/variant calls submit with correct `{linkToQuoteId,userIntent}`; confirmation copy from `action` → "Sighting added"/"Added as variant"; double-click a decision button → exactly one submit, FR-011/qw-0psq.1)

### Implementation for User Story 1

- [X] T009 [US1] Rework `buildSimilarMatchView` + `renderSimilarDiff` in `src/content/ui/components/similar-diff.ts` — two equal-weight `type="button"` controls (no disabled placeholder), date-gated sighting, keyboard-operable + `aria-label`s (Article VII), `href` set via property with `https:` validation (qw-0psq.6); pass T006
- [X] T010 [US1] Wire the `similar` branch of `DuplicateBadge` → `renderSimilarDiff(...)` and forward `onResolveDecision` in `src/content/ui/components/duplicate-badge.ts`
- [X] T011 [US1] Thread `link_to_quote_id` + `user_intent` into the POST body and return `action` in `src/api/quotewise-api.ts`; forward both fields through `SUBMIT_QUOTE` in `src/background/api-handler.ts` (`handleSubmitQuote` — pass `message.data` through **without a field whitelist**; `service-worker.ts:1683` already delegates the message wholesale, verified); pass T007
- [X] T012 [US1] In `src/content/ui/overlay-bar.ts`: add `submitQuote(opts?: {linkToQuoteId?, userIntent?})` threading the pair; wire `onResolveDecision` → submit; set confirmation copy from `action`; add the `isSubmitting` re-entrancy guard (qw-0psq.1); pass T008

**Checkpoint**: US1 fully functional — the MVP for `qw-hsly`.

---

## Phase 4: User Story 2 — "Couldn't verify" blocks submission until retry (Priority: P2)

**Goal**: A failed duplicate check shows an honest "couldn't verify" state, disables Submit, offers Retry, and never presents a healthy new-quote state (kills the fabricated fallback).

**Independent Test**: Stub a check failure (non-2xx / `search_metadata.error`); verify the warning + disabled Submit + Retry, and that Retry re-runs the check.

### Tests for User Story 2 (write first, must FAIL)

- [X] T013 [P] [US2] FAILING test in `tests/api/quotewise-api.test.ts`: `checkQuoteDuplicate` on non-2xx/network failure resolves to a result with `search_metadata.error === true` (not a fabricated healthy `new_quote`, FR-009)
- [X] T014 [P] [US2] FAILING tests in `tests/content/ui/components/duplicate-badge.test.ts` and `tests/content/ui/overlay-bar.test.ts`: `couldnt_verify` renders "Couldn't verify duplicates" + Retry; overlay disables Submit and Retry re-runs `checkDuplicate`

### Implementation for User Story 2

- [X] T015 [US2] Update `checkQuoteDuplicate` error handling in `src/api/quotewise-api.ts` to return `search_metadata.error: true` on failure; pass T013
- [X] T016 [US2] Implement the `couldnt_verify` branch of `DuplicateBadge` (warning glyph+text; keyboard-operable Retry `button` with an `aria-label`; status announced via `aria-live` and conveyed by glyph+text not color alone — FR-010/SC-006) wired to `onRetry`, in `src/content/ui/components/duplicate-badge.ts`
- [X] T017 [US2] In `src/content/ui/overlay-bar.ts`: `couldnt_verify` disables Submit and wires Retry → re-run `checkDuplicate`; pass T014

**Checkpoint**: US1 + US2 both work independently.

---

## Phase 5: User Story 3 — Different-originator conflict is blocked (Priority: P3)

**Goal**: A `conflict` match offers no sighting/variant, blocks submission, and links the user to resolve the attribution in Quotewise.

**Independent Test**: Stub a `conflict` result; verify no decision buttons, Submit blocked, and an attribution notice + resolve-in-Quotewise link (https-validated).

### Tests for User Story 3 (write first, must FAIL)

- [X] T018 [P] [US3] FAILING tests in `tests/content/ui/components/duplicate-badge.test.ts` and `tests/content/ui/overlay-bar.test.ts`: `conflict` shows the attribution notice + resolve link and no sighting/variant; overlay blocks submission for `conflict`

### Implementation for User Story 3

- [X] T019 [US3] Implement the `conflict` branch of `DuplicateBadge` (attribution notice naming the other originator from `match.originator.full_name`, with a generic fallback when that field is absent; keyboard-operable resolve-in-Quotewise link with an `aria-label`, `https:`-validated, via `onResolveConflict`; status by glyph+text not color — FR-010/SC-006) in `src/content/ui/components/duplicate-badge.ts`
- [X] T020 [US3] In `src/content/ui/overlay-bar.ts`: guard `submitQuote` to block when the current resolution is `conflict`; pass T018

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T021 [P] FR-013 degradation + FR-006/SC-007 regression tests in `tests/content/ui/components/duplicate-badge.test.ts`: (a) response lacking `match_class`/`match_source` → legacy recommendation rendering, no error; (b) an `exact`/URL match still renders the single-action "Already captured" behavior unchanged (FR-006); and confirm the existing spec-002 sighting-badge suite stays green (SC-007 regression guard)
- [X] T022 [P] Consolidate the duplicate `escapeHtml` helpers and assert no `javascript:` URI survives `href` validation across the touched components (qw-0psq.6) in `src/content/ui/components/` + a focused test
- [ ] T023 Run `bun run test` + `bun run type-check` + `bun run lint` (all green) and execute `quickstart.md` manual verification (US1–US3 + accessibility SC-006 + SC-002: confirmation appears within ~1s of the submit response — manual UX check, not auto-asserted)
- [X] T024 [P] Add a cross-reference note linking spec `002-sighting-status-ui` → this feature in `specs/002-sighting-status-ui/spec.md`
- [X] T025 [P] FR-012 invariant guard test: assert the overlay exposes **no editable quote-text input** (only excerpt selection) in `tests/content/ui/overlay-bar.test.ts`

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T005)** → **Stories** → **Polish (T021–T025)**.
- **Foundational blocks everything.** T002 (types) blocks T003+; T003 before T004 (TDD); T004 before T005 (badge dispatch uses the classifier).
- **US1 (P1)**: T006–T008 (tests, parallel) before T009–T012 (impl). T011 (api/handler) is independent of T009/T010 (components) — parallelizable; T012 (overlay) depends on T009–T011.
- **US2 (P2)** and **US3 (P3)**: depend only on Foundational; independent of US1 in behavior, but T016/T017/T019/T020 touch the same `duplicate-badge.ts` / `overlay-bar.ts` as US1 → run after US1's edits to those files (sequential, not [P]).
- **Within each story**: tests fail first → implement → green.

## Parallel Opportunities

- T003 [P] alongside T002's downstream (after types land).
- US1 tests T006 / T007 / T008 [P] together (different files).
- T011 (api + handler) [P] with T009/T010 (components) inside US1.
- Polish T021 / T022 / T024 / T025 [P].

## Implementation Strategy

- **MVP = User Story 1** (the two-button sighting/variant decision — the heart of `qw-hsly`). Complete Setup → Foundational → US1, then **stop and validate** against the spec acceptance scenarios before US2/US3.
- **Incremental**: US2 (resilience/honesty) and US3 (integrity guard) each add value without touching US1's behavior.
- Commit after each task or logical group; verify each test failed before implementing (Article VI).

## Notes

- Confirmation copy is authoritative from the response `action`; fall back to the sent `user_intent` only if `action` is absent.
- Equal-weight buttons, no default/primary (no nudge, Article VII.3); initial focus to the first action; no auto-submit on Enter (explicit activation, Article I).
- No new permissions, dependencies, storage keys, or backend changes.
