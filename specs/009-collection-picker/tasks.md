---
description: "Task list for Per-Capture Collection Picker & Add-to-Collection for Existing Quotes"
---

# Tasks: Per-Capture Collection Picker & Add-to-Collection for Existing Quotes

**Input**: Design documents from `specs/009-collection-picker/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/collections-api.md, quickstart.md

**Tests**: INCLUDED (mandated by Constitution Article VI — test-first for deterministic logic; fixture characterization for DOM/UI). Kept targeted, not per-function exhaustive.

**Organization**: By user story (US1 P1 → US2 P2 → US3 P3) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)

## Path Conventions

Single existing extension project — `src/`, `tests/` at repo root (per plan.md).

---

## Phase 1: Setup

- [ ] T001 Verify clean baseline before changes: `bun run type-check && bun run lint && bun run test` all green (repo root). No new npm dependencies or manifest permissions are introduced by this feature (Article III).
- [ ] T002 [DEP] Backend **resolved** (bead `qw-si1t`, ADR-0006): the existing slug-keyed `POST /v1/collections/{slug}/quotes/` + `member_collections {slug,name}` on the duplicate-check response. NOT extension code — confirm it's deployed to the target env before live/E2E validation (T023); unit tests stub the client meanwhile.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: All user stories depend on this phase.

- [ ] T003 [P] Add message + settings types in `src/types/chrome.ts`: `MessageType.ADD_QUOTE_TO_COLLECTION`; `Settings.lastUsedCollectionSlugs: string[]` (default `[]`); rename `Settings.defaultCollectionId` → `defaultCollectionSlug` (slug, `string | null`).
- [ ] T004 [P] Add API types in `src/types/api.ts`: `member_collections: { slug: string; name: string }[]` on the duplicate match (**always present** — read unconditionally); `AddToCollectionRequest { quote_id }` (collection identified by slug in the path) and `AddToCollectionResult { success; alreadyMember?; error? }`.
- [ ] T005 [P] settings-store: normalize/get/update/clear for `lastUsedCollectionSlugs` (string[] coercion, dedupe, change-guarded write) + rename `defaultCollectionId` → `defaultCollectionSlug` in `src/settings/settings-store.ts`; update the options-page selector (`src/options/index.ts`) to use `collection.slug` as the option value. No legacy migration — drop any stored `defaultCollectionId` (pre-prod, sole user). Test-first in `tests/settings/settings-store.test.ts`. (deps: T003)
- [ ] T006 [P] API client `addQuoteToCollection(collectionSlug, quoteId)` → `POST /v1/collections/{slug}/quotes/` treating 201 and 200 both as success (idempotent), mapping 404 (not-owned) and 400 (`QUOTE_NOT_FOUND`) to per-collection failures, plus `member_collections` parsing (always an array of `{slug,name}`), in `src/api/quotewise-api.ts`. Test-first in `tests/api/quotewise-api.test.ts`. (deps: T004)
- [ ] T007 [P] [US1] Pure helpers in `src/content/ui/components/collection-seed.ts`: `seedSelection(lastUsedSlugs, defaultSlug, autoAddOn, available)` (precedence last-used → default → blank, drop slugs not in `available`) and `summarizeAdds(results)` → `{ succeeded, failed }`. Keys on slug. Test-first in `tests/content/ui/collection-seed.test.ts`. (deps: T003, T004)
- [ ] T008 Background plumbing in `src/background/api-handler.ts`: route `ADD_QUOTE_TO_COLLECTION` to the client; handle `LIST_COLLECTIONS` by serving the `chrome.storage.local` cache (`collectionsCache` `{ collections, default_collection_id, ts }`, ~5 min TTL) when fresh, else fetching and caching. The collection list is fetched ONLY in response to an explicit picker-open `LIST_COLLECTIONS` request — **NEVER on tweet-page load** (Article II.1, FR-022/FR-023). Support a force-refresh (cache-bypass) variant for the picker's manual Refresh (FR-028). (deps: T006)

**Checkpoint**: Types, storage, client, and routing ready — user stories can begin.

---

## Phase 3: User Story 1 - Pick destination collection(s) at capture time (Priority: P1) 🎯 MVP

**Goal**: Beside Capture, a multi-select picker files a new quote into chosen existing collection(s), overriding the default for that capture only.

**Independent Test**: With ≥2 collections, capture a new quote, tick a non-default collection, confirm it lands only there and the default is unchanged next time.

- [ ] T009 [P] [US1] Picker fixture/characterization test (multi-select render, empty state, staged selection, keyboard/ARIA) in `tests/content/ui/collection-picker.test.ts`.
- [ ] T010 [US1] Create `CollectionPicker` component in `src/content/ui/components/collection-picker.ts`: multi-select checklist from the collection list (served from cache when warm, else fetched on open with a brief loading state — FR-022/SC-004), honest empty state (create in web app — FR-003), staged `Set`, ARIA labels + keyboard + glyph/text not color-alone, no host layout shift (FR-026), no inline-create; include a Refresh control that force-refetches the list and reconciles staged selections against the new list (FR-028). (deps: T008)
- [ ] T011 [US1] Render the picker for NEW quotes (authenticated + not private — FR-001/021) beside Capture in `src/content/ui/overlay-bar.ts`; seed via `seedSelection` (auto-add ON → default pre-checked, OFF → blank; last-used empty at this story); selections staged until explicit capture (FR-005). (deps: T010, T007)
- [ ] T012 [US1] Capture submit path in `src/content/ui/overlay-bar.ts`: capture is allowed with **zero selected collections** (FR-002) — `submitQuote` with no `collection_id` and no membership calls. With ≥1 selected, `submitQuote` carries the first selected collection **slug** in `collection_id` (map its `collection_warning` into that collection's per-collection result), then `addQuoteToCollection(slug, quoteId)` for each remaining selected collection. The capture MUST survive any collection-add failure (FR-013, no rollback). (deps: T011, T006)
- [ ] T013 [US1] Success/partial-failure UI in `src/content/ui/overlay-bar.ts` via `summarizeAdds`: full success → brief confirmation naming the collection(s) + auto-hide, no Undo (FR-015); partial → surface which collection(s) failed (never reported as added) — target is stay-open per-collection inline retry, with the defined warning+auto-hide fallback acceptable (FR-013/FR-015, spec Assumptions); selection overrides default for this capture only and does not mutate the stored default (FR-004). (deps: T012, T007)
- [ ] T014 [US1] After a successful add, drive the toolbar badge to the existing `InCollection` (✓) state — replace the hardcoded `'exists_not_collected'` in the `UPDATE_COLLECTION_BADGE` path (FR-025) in `src/content/ui/overlay-bar.ts`; verify routing through `src/background/icon-state-resolver.ts`. (deps: T012)

**Checkpoint**: New captures can be filed into chosen collections — MVP shippable.

---

## Phase 4: User Story 2 - Add an already-captured quote to my collection(s) & see membership (Priority: P2)

**Goal**: On an already-captured quote, show which collections already hold it and let the user add it to more (membership-only).

**Independent Test**: On a quote already in Quotewise, confirm "✓ In your collection" naming collection(s), an addable-only picker, and that adding files membership only (no sighting/source URL).

- [ ] T015 [P] [US2] Add `partitionMembership(match, allCollections)` → `{ alreadyIn, addable }` (keyed on slug; `member_collections` always an array) to `src/content/ui/components/collection-seed.ts`; test-first in `tests/content/ui/collection-seed.test.ts`. (deps: T007)
- [ ] T016 [US2] Render "✓ In your collection" naming `member_collections` (`{slug,name}`, FR-007) in `src/content/ui/components/duplicate-badge.ts`. (deps: T004, T008)
- [ ] T017 [US2] Already-captured picker: read-only "Already in: …" plus an editable list of only not-yet-member collections via `partitionMembership` (FR-008/010), wired in `src/content/ui/components/duplicate-badge.ts` + `src/content/ui/overlay-bar.ts`. (deps: T016, T015, T010)
- [ ] T018 [US2] Add-existing action in `src/content/ui/overlay-bar.ts`: one `addQuoteToCollection` per checked collection — membership only, no sighting/source URL (FR-009); best-effort with honest per-collection outcome (retry target / warning fallback — FR-012/013/015); badge → `InCollection` (reuse T014). (deps: T017, T006, T014)

**Checkpoint**: Already-captured quotes are no longer a dead end; US1 + US2 both work independently.

---

## Phase 5: User Story 3 - Dropdown default settings + remembered last-used set (Priority: P3)

**Goal**: Configure auto-add/default from the overlay dropdown (one shared value) and remember the last-used collection set to pre-seed the picker across restarts/devices.

**Independent Test**: Change the default in the dropdown → options page agrees. File into a set, restart (and check a 2nd device) → picker pre-selects that set.

- [ ] T019 [US3] Add the Auto-add toggle + default-collection selector to the overlay dropdown in `src/content/ui/components/account-menu.ts`, reading/writing the SAME `defaultCollectionSlug` value via `settings-store` (FR-019/020); populate the selector from the cached collection list using `collection.slug` as the value. (deps: T005, T008)
- [ ] T020 [US3] Persist the last-used set of **slugs** on each completed add (change-guarded `storage.sync` write) in the add-completion paths of `src/content/ui/overlay-bar.ts`; `seedSelection` now resolves last-used → default → blank precedence (FR-016/017/018). (deps: T013, T018, T005)

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 [P] Wipe `collectionsCache` (`storage.local`) and `lastUsedCollectionSlugs` (`storage.sync`) on logout, private mode, and manual clear-data in `src/background/privacy-cleanup.ts` (FR-024).
- [ ] T022 [P] Accessibility + honest-copy pass across the new picker, status, dropdown, and confirmation UI (FR-026/027): keyboard operation, visible focus, ARIA labels, glyph+text (not color alone), no fake urgency/overstated membership.
- [ ] T023 Run `quickstart.md` manual validation (SC-001…SC-009), including: `GET /v1/collections/` fires ONLY on explicit picker open and NEVER on tweet-page load (Article II.1); no collection fetch/UI when logged out or in private mode (SC-007); warm-cache picker renders synchronously while a cold open may show a brief loading state (SC-004). (Live paths require T002's backend shipped.)
- [ ] T024 [P] Final gate: `bun run type-check && bun run lint && bun run test` green; confirm coverage on the new deterministic helpers (`collection-seed`, `settings-store`, API client).
- [ ] T025 [P] Disclosure review (Article II.3): verify/update the Chrome Web Store listing + privacy policy to disclose the new collection-list fetch (on picker open), the `storage.local` collection cache, and the synced `lastUsedCollectionSlugs`; keep in sync with what is actually sent/stored. (Docs/policy, not extension code.)

---

## Dependencies & Execution Order

### Phase order
- Setup (P1) → Foundational (P2, BLOCKS all stories) → US1 (P3) → US2 (P4) → US3 (P5) → Polish (P6).
- US1 is the MVP. US2 is independently valuable and can be built right after Foundational if US1 isn't required first. US3 layers on the US1/US2 add paths.

### Key cross-task deps
- T005←T003; T006←T004; T007←T003,T004; T008←T006.
- US1: T010←T008; T011←T010,T007; T012←T011,T006; T013←T012,T007; T014←T012.
- US2: T015←T007; T016←T004,T008; T017←T016,T015,T010; T018←T017,T006,T014.
- US3: T019←T005,T008; T020←T013,T018,T005.
- Polish: T021/T022/T024/T025 independent; T023 last for manual validation (needs T002 backend for live checks).

### Parallel opportunities
- Foundational: T003, T004, T005, T006, T007 are all `[P]` (distinct files); T008 after T006.
- US1 test T009 `[P]` alongside early US1 work. US2 T015 `[P]`. Polish T021/T022/T024/T025 `[P]`.
- Within `overlay-bar.ts` (T011–T014, T018, T020) tasks are sequential — same file, not `[P]`.

---

## Parallel Example: Foundational

```bash
# Distinct files, no incomplete deps — run together:
Task: "T003 add types in src/types/chrome.ts"
Task: "T004 add types in src/types/api.ts"
Task: "T005 settings-store lastUsedCollectionSlugs (+test)"
Task: "T006 api client addQuoteToCollection (+test)"
Task: "T007 collection-seed seedSelection/summarizeAdds (+test)"
```

---

## Implementation Strategy

### MVP (User Story 1)
1. Phase 1 Setup → 2. Phase 2 Foundational (T003–T008) → 3. Phase 3 US1 (T009–T014) → **STOP, validate US1 independently** → demo.

### Incremental delivery
US1 (MVP) → US2 (already-captured add) → US3 (dropdown + memory) → Polish. Each increment is independently testable and ships value without breaking the prior.

---

## Notes
- `[P]` = different files, no incomplete deps. Most `overlay-bar.ts` tasks are serial.
- Deterministic logic (`collection-seed`, `settings-store`, API client) is test-first; the picker UI is fixture-characterized (Article VI).
- The capture-survives-filing-failure invariant (FR-013) is the non-negotiable behavior; inline retry MAY degrade to "capture + warning + auto-hide" if idempotency proves hard (spec Assumptions).
- Commit after each task or logical group; stop at any checkpoint to validate a story.
