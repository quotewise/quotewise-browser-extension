# Feature Specification: Extension Feedback Link

**Feature Branch**: `007-extension-feedback-link`

**Created**: 2026-06-21

**Status**: Draft

**Input**: User description: "Finish the feedback ADR (`docs/server-launch-adrs/ADR-0003-extension-feedback-intake.md`) by creating the extension-side specification for a minimal Send feedback link to the deployed Turnstile-gated Quotewise feedback page."

## Context

The public feedback intake page is already delivered on the Quotewise web app at `https://quotewise.io/feedback/` (see ADR-0003). The remaining extension-side work is intentionally small: give users a reliable, low-friction path from the Chrome extension to that page, including a direct entry in the tray Gear menu, with enough non-sensitive context for triage and no in-extension feedback form.

This feature covers only the extension entry points and context passed to the hosted feedback page. The hosted form, spam protection, persistence, notifications, and privacy-policy backend disclosures are already owned by the Quotewise web app.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send feedback from extension settings (Priority: P1)

A user who is configuring the extension or troubleshooting an issue can open the extension settings and choose a clear "Send feedback" action that takes them to the Quotewise feedback page.

**Why this priority**: Settings is the canonical Chrome extension management surface and is available even when capture is not currently open. This is the most discoverable fallback when users are signed out, blocked by auth, or investigating extension behavior.

**Independent Test**: Open the extension settings page in authenticated, signed-out, and session-expired states; verify a clearly labelled feedback action is visible, keyboard-operable, and opens the Quotewise feedback page without changing any existing settings.

**Acceptance Scenarios**:

1. **Given** any user opens the extension settings page, **When** they inspect available account/privacy actions, **Then** they see a "Send feedback" action.
2. **Given** the settings page is open, **When** the user activates "Send feedback", **Then** a separate browser page opens to the Quotewise feedback page.
3. **Given** the user is signed out or their session has expired, **When** they activate "Send feedback", **Then** the feedback page still opens and does not require extension authentication.
4. **Given** the user has settings such as Private mode or auto-add configured, **When** they open feedback, **Then** those settings remain unchanged.

---

### User Story 2 - Send feedback from the tray Gear menu (Priority: P2)

A user who is actively using the capture tray can open the Gear menu and jump directly to the feedback page without leaving the current page flow to find settings first.

**Why this priority**: Many launch issues will be discovered while the tray is open. A feedback action in the tray shortens the path from "I noticed a problem" to a useful report.

**Independent Test**: Open the capture tray Gear menu; verify the feedback action appears directly alongside account/settings actions, is reachable by keyboard, and opens the same feedback destination without closing or submitting a capture.

**Acceptance Scenarios**:

1. **Given** the capture tray is open, **When** the user opens the Gear menu, **Then** they see a "Send feedback" action near existing settings/account actions.
2. **Given** a capture is in progress or the tray has captured text visible, **When** the user activates "Send feedback", **Then** no quote is submitted, no captured text is sent as feedback context, and the user is taken to the feedback page.
3. **Given** the feedback action is activated from the tray, **When** the feedback page opens, **Then** the tray remains in a safe state with no destructive side effects.

---

### User Story 3 - Include safe triage context (Priority: P3)

When a user opens the hosted feedback page from the extension, Quotewise receives enough non-sensitive context to understand that the report came from the Chrome extension and which extension version/platform was involved.

**Why this priority**: Launch feedback is most useful when triage can distinguish extension reports from general website feedback, but this must not leak tweet content, handles, source URLs, tokens, or other user-identifying data.

**Independent Test**: Activate feedback from both settings and tray; inspect the opened feedback destination and confirm it includes only approved context values and never includes captured content or user identifiers.

**Acceptance Scenarios**:

1. **Given** the user opens feedback from the extension, **When** the feedback page loads, **Then** the destination identifies the source as the Chrome extension.
2. **Given** the extension version is available, **When** feedback opens, **Then** the destination includes that version as context.
3. **Given** the extension's supported platform context is known, **When** feedback opens, **Then** the destination includes the supported platform context.
4. **Given** the current page includes tweet text, a handle, or a source URL, **When** feedback opens, **Then** none of those values are included in the destination context.

### Edge Cases

- Feedback is activated while signed out, during a session-expired state, or while permissions are insufficient.
- Feedback is activated when no Twitter/X tab is active or no capture data is available.
- Feedback is activated while Private mode is enabled.
- The browser refuses to open a new page or the feedback page cannot be reached.
- Extension version or platform context is unavailable.
- The tray contains selected quote text when feedback is opened.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The settings page MUST expose a clearly labelled "Send feedback" action that is visible and usable regardless of authentication state.
- **FR-002**: The tray Gear menu MUST expose a clearly labelled "Send feedback" action directly alongside existing account/settings actions.
- **FR-003**: Activating "Send feedback" MUST open the agreed Quotewise feedback destination at `https://quotewise.io/feedback/` in a separate browser page.
- **FR-004**: The feedback action MUST work when the user is signed out, session-expired, or lacks write permissions; it MUST NOT require extension authentication.
- **FR-005**: The feedback destination MUST include only approved non-sensitive context: extension version, source marker for the Chrome extension, and supported platform context when available.
- **FR-006**: The feedback destination MUST NOT include quote text, selected text, tweet URLs, social handles, user identifiers, collection names, OAuth tokens, or other credentials.
- **FR-007**: If approved context is unavailable, the extension MUST omit that value rather than inventing or deriving sensitive substitutes.
- **FR-008**: Opening feedback MUST NOT submit a quote, alter captured text, clear captured state, change settings, start login/logout, or change Private mode.
- **FR-009**: If the browser cannot open the feedback destination, the initiating surface MUST remain usable and MUST present an honest, non-blocking failure message.
- **FR-010**: Feedback actions MUST be keyboard-operable, expose accessible labels, have visible focus behavior, and use honest copy that does not imply the user is required to submit feedback.
- **FR-011**: The feature MUST NOT introduce any new user-visible browser permission prompt.
- **FR-012**: The implementation MUST preserve all existing settings page and tray Gear/account menu actions.

### Key Entities

- **Feedback action**: A user-visible control in the extension that takes the user to the hosted feedback page.
- **Feedback destination**: The deployed Quotewise page that collects feedback and handles spam protection, persistence, and triage outside the extension.
- **Extension feedback context**: The non-sensitive launch-triage values passed with the feedback destination: extension version, source marker, and platform context.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tested auth states (authenticated, signed out, session expired, insufficient permissions) can open feedback from the settings page in two user actions or fewer.
- **SC-002**: 100% of tested tray Gear-menu sessions can open feedback without submitting, modifying, or clearing the current capture.
- **SC-003**: 100% of opened feedback destinations include the Chrome-extension source marker and include extension version whenever the version is available.
- **SC-004**: 0 audited feedback URLs contain quote text, selected text, tweet URLs, social handles, user identifiers, collection names, tokens, or credentials.
- **SC-005**: Existing settings and account-menu actions continue to pass their current acceptance tests after the feedback action is added.
- **SC-006**: Keyboard-only and assistive-technology users can discover and activate the feedback action from both surfaces.

## Assumptions

- The Quotewise web app's public feedback page is deployed at `https://quotewise.io/feedback/` and handles spam protection, persistence, notifications, and follow-up email collection.
- The extension remains Twitter/X-only for launch, so the supported platform context is `twitter` unless a future platform adapter changes the product scope.
- A new in-extension feedback form is out of scope for this feature; the extension opens the hosted page instead.
- Feedback context is for triage only and is not part of quote capture or submission.
- The settings page and tray Gear menu from spec 005 remain the two intended extension entry points.
- No backend or privacy-policy changes are expected for this extension-side feature because ADR-0003 and ADR-0005 already cover the hosted intake and disclosure.

## Dependencies

- `docs/server-launch-adrs/ADR-0003-extension-feedback-intake.md` — final feedback destination and context contract.
- `docs/server-launch-adrs/ADR-0005-privacy-policy-data-disclosure.md` — disclosed feedback data practices.
- `specs/005-capture-overlay-tray/spec.md` — existing settings page and tray Gear/account menu surfaces.
- Constitution Articles II (Privacy & Data Minimization), III (Security & Permissions), VII (User Experience).
