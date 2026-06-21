# Tasks: Extension Feedback Link

**Input**: Design documents from `/specs/007-extension-feedback-link/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feedback-entrypoints.md, quickstart.md

**Tests**: Included because the feature specification defines independent tests for all user stories and the plan requires deterministic URL/context and UI wiring coverage.

**Organization**: Tasks are grouped by user story to keep settings feedback, Gear-menu feedback, and safe triage context independently testable.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the existing extension project setup is ready for the feedback-link work without new dependencies or permissions.

- [X] T001 Verify `.gitignore` covers Node/extension build artifacts including `node_modules/`, `dist/`, `build/`, `*.log`, `.env*`, `coverage/`, and `.playwright-mcp/`.
- [X] T002 [P] Confirm no new runtime dependency is needed by inspecting `package.json` and preserving the existing dependency set.
- [X] T003 [P] Confirm no new browser permission is needed by inspecting `manifest.json`, `manifest.dev.json`, and `manifest.prod.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared feedback destination and background open path used by every user story.

**CRITICAL**: No settings-page or Gear-menu UI work should begin until this phase is complete.

- [X] T004 [P] Add failing destination-builder tests in `tests/utils/feedback-url.test.ts` for `https://quotewise.io/feedback/`, `src=chrome-ext`, version inclusion, `platform=twitter`, and omission of unavailable optional values.
- [X] T005 [P] Add failing background message tests in `tests/background/feedback-link.test.ts` proving `OPEN_FEEDBACK_PAGE` opens a new tab with the shared destination and returns a non-blocking failure response when `chrome.tabs.create` rejects.
- [X] T006 Add `OPEN_FEEDBACK_PAGE` to the `MessageType` enum in `src/types/chrome.ts`.
- [X] T007 Implement the shared feedback destination builder in `src/utils/feedback-url.ts` using only approved context values.
- [X] T008 Wire `MessageType.OPEN_FEEDBACK_PAGE` in `src/background/service-worker.ts` to build the feedback URL, call `chrome.tabs.create`, and return `{ success: true }` or `{ success: false, error }`.
- [X] T009 Run foundational focused tests for `tests/utils/feedback-url.test.ts` and `tests/background/feedback-link.test.ts`.

**Checkpoint**: The extension can open the hosted feedback page through one background-mediated message without adding permissions, storage, auth requirements, or sensitive context.

---

## Phase 3: User Story 1 - Send feedback from extension settings (Priority: P1) MVP

**Goal**: A user can open extension settings and activate a visible, keyboard-operable "Send feedback" action regardless of auth state.

**Independent Test**: Open the options page in authenticated, signed-out, session-expired, and insufficient-permissions states; confirm the feedback action is visible, sends `OPEN_FEEDBACK_PAGE`, and leaves settings unchanged.

### Tests for User Story 1

- [X] T010 [P] [US1] Add failing authenticated-state settings feedback assertions in `tests/options/options-page.test.ts` for visible button text, accessible focusable control, and `MessageType.OPEN_FEEDBACK_PAGE` dispatch.
- [X] T011 [P] [US1] Add failing signed-out/session-expired settings feedback assertions in `tests/options/options-page.test.ts` proving the feedback action remains available and does not require login.
- [X] T012 [P] [US1] Add failing settings navigation-failure assertions in `tests/options/options-page.test.ts` proving a non-blocking status message appears and existing controls remain usable.

### Implementation for User Story 1

- [X] T013 [US1] Add a support/help row with a "Send feedback" button in `src/options/index.ts` without changing existing Account, Privacy, or Collections controls.
- [X] T014 [US1] Wire the settings feedback button in `src/options/index.ts` to send `MessageType.OPEN_FEEDBACK_PAGE` and render success/failure status without writing settings.
- [X] T015 [US1] Run the focused options-page tests in `tests/options/options-page.test.ts`.

**Checkpoint**: User Story 1 is fully functional and testable from the extension settings page.

---

## Phase 4: User Story 2 - Send feedback from the tray Gear menu (Priority: P2)

**Goal**: A user can open the tray Gear menu and activate "Send feedback" directly beside existing account/settings actions without submitting or altering a capture.

**Independent Test**: Open the tray Gear menu; confirm "Send feedback" is present, keyboard reachable, sends `OPEN_FEEDBACK_PAGE`, and does not trigger login/logout, settings writes, quote submission, or capture-state mutation.

### Tests for User Story 2

- [X] T016 [P] [US2] Add failing Gear-menu feedback assertions in `tests/content/account-menu.test.ts` for direct "Send feedback" menu item visibility, keyboard reachability, and `MessageType.OPEN_FEEDBACK_PAGE` dispatch.
- [X] T017 [P] [US2] Add failing Gear-menu regression assertions in `tests/content/account-menu.test.ts` proving existing Private mode, Open settings, Log in, and Log out behavior remains unchanged.
- [X] T018 [P] [US2] Add failing Gear-menu failure-state assertions in `tests/content/account-menu.test.ts` proving a non-blocking status message appears when feedback opening fails.

### Implementation for User Story 2

- [X] T019 [US2] Add an `#account-send-feedback` menu button to `src/content/ui/components/account-menu.ts` directly with the existing Gear/account menu actions.
- [X] T020 [US2] Wire the Gear-menu feedback button in `src/content/ui/components/account-menu.ts` to send `MessageType.OPEN_FEEDBACK_PAGE`, close or preserve the menu consistently with existing actions, and render a recoverable failure status.
- [X] T021 [US2] Run the focused account-menu tests in `tests/content/account-menu.test.ts`.

**Checkpoint**: User Story 2 is fully functional and testable from the tray Gear menu.

---

## Phase 5: User Story 3 - Include safe triage context (Priority: P3)

**Goal**: Every extension feedback destination carries only approved non-sensitive context: `src=chrome-ext`, extension version when available, and `platform=twitter`.

**Independent Test**: Activate feedback from settings and the Gear menu; inspect the destination and confirm no quote text, selected text, tweet URL, social handle, user identifier, collection data, token, cookie, or auth detail is included.

### Tests for User Story 3

- [X] T022 [P] [US3] Add privacy regression assertions in `tests/utils/feedback-url.test.ts` proving unapproved current-page, account, collection, auth, and quote-like values cannot appear in the generated URL.
- [X] T023 [P] [US3] Add background privacy assertions in `tests/background/feedback-link.test.ts` proving `sender.tab.url`, message data, and stored capture-like fields are ignored when opening feedback.

### Implementation for User Story 3

- [X] T024 [US3] Adjust `src/utils/feedback-url.ts` to keep the feedback context whitelist explicit and prevent future callers from passing arbitrary context through.
- [X] T025 [US3] Adjust `src/background/service-worker.ts` so the feedback handler does not read sender tab data, capture storage, auth state, or settings while constructing the destination.
- [X] T026 [US3] Run focused privacy tests for `tests/utils/feedback-url.test.ts` and `tests/background/feedback-link.test.ts`.

**Checkpoint**: User Story 3 is independently verifiable through URL/context tests and the shared background open path.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the whole feature, release metadata, and generated build.

- [X] T027 [P] Run `bun run type-check` using `package.json` and fix any TypeScript issues in touched files.
- [X] T028 [P] Run `bun run lint` using `package.json` and fix any lint issues in touched files.
- [X] T029 Run the focused quickstart test set covering `tests/utils/feedback-url.test.ts`, `tests/background/feedback-link.test.ts`, `tests/options/options-page.test.ts`, and `tests/content/account-menu.test.ts`.
- [X] T030 Run `bun run test -- --runInBand` using `package.json` and address any regression failures in touched files.
- [X] T031 Run `bun run version:check` using `package.json` and confirm `package.json`, `manifest.json`, `manifest.dev.json`, and `manifest.prod.json` remain in sync.
- [X] T032 Run `bun run build` using `package.json` and verify `dist/manifest.json`, `dist/background/service-worker.js`, and `dist/content/index.js` exist with the intended extension version.
- [X] T033 Update `specs/007-extension-feedback-link/quickstart.md` only if implementation details or verification commands changed during execution.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on Foundational completion.
- **User Story 3 (Phase 5)**: Depends on Foundational completion and should be validated after both entry points exist.
- **Polish (Phase 6)**: Depends on all selected user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational; no dependency on US2.
- **US2 (P2)**: Can start after Foundational; no dependency on US1.
- **US3 (P3)**: Uses the same foundational helper and background handler, then validates both entry points and the context whitelist.

### Within Each User Story

- Write failing tests before implementation.
- Implement only the files named in the story tasks.
- Run the story's focused tests before moving to the next phase.
- Preserve existing auth, settings, capture, and menu behavior.

---

## Parallel Opportunities

- T002 and T003 can run in parallel during setup.
- T004 and T005 can run in parallel because they write different test files.
- T010, T011, and T012 can be written together in `tests/options/options-page.test.ts` before implementing US1.
- T016, T017, and T018 can be written together in `tests/content/account-menu.test.ts` before implementing US2.
- T022 and T023 can run in parallel because they write different test files.
- T027 and T028 can run in parallel after implementation if local tooling resources allow.

## Parallel Example: User Story 1

```bash
# Add all settings-page tests before implementation:
Task: "T010 [US1] Add authenticated-state settings feedback assertions in tests/options/options-page.test.ts"
Task: "T011 [US1] Add signed-out/session-expired settings feedback assertions in tests/options/options-page.test.ts"
Task: "T012 [US1] Add settings navigation-failure assertions in tests/options/options-page.test.ts"
```

## Parallel Example: User Story 2

```bash
# Add all Gear-menu tests before implementation:
Task: "T016 [US2] Add Gear-menu feedback assertions in tests/content/account-menu.test.ts"
Task: "T017 [US2] Add Gear-menu regression assertions in tests/content/account-menu.test.ts"
Task: "T018 [US2] Add Gear-menu failure-state assertions in tests/content/account-menu.test.ts"
```

## Parallel Example: User Story 3

```bash
# Validate safe context from helper and background layers together:
Task: "T022 [US3] Add privacy regression assertions in tests/utils/feedback-url.test.ts"
Task: "T023 [US3] Add background privacy assertions in tests/background/feedback-link.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 for the settings-page feedback action.
3. Stop and validate settings feedback independently with `tests/options/options-page.test.ts`.

### Incremental Delivery

1. Shared destination and background open path.
2. Settings-page entry point.
3. Tray Gear-menu entry point.
4. Safe-context privacy regression pass.
5. Full verification and build.

### Commit Strategy

Commit logical groups after validation:

1. Shared URL/background open path.
2. Settings feedback UI.
3. Gear-menu feedback UI.
4. Privacy hardening and final validation.
