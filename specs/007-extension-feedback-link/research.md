# Research: Extension Feedback Link

## Decision 1: Use the hosted feedback page, not an in-extension form

**Decision**: Both extension entry points open the deployed Quotewise feedback page at `https://quotewise.io/feedback/`.

**Rationale**: ADR-0003 confirms the server-side Turnstile-gated feedback form is delivered and that the remaining extension work is a link. This keeps spam protection, persistence, triage email, and privacy disclosure on the web app where they already exist.

**Alternatives considered**:

- In-extension form submission: rejected for launch because it would duplicate hosted form behavior, couple feedback to extension UI, and expand validation/error handling scope.
- Authenticated feedback endpoint: rejected because feedback must work when auth is broken or the user is signed out.

## Decision 2: Pass only whitelisted triage context

**Decision**: The feedback destination may include only `src=chrome-ext`, extension version when available, and `platform=twitter`.

**Rationale**: ADR-0003 names these values as useful for triage. They distinguish extension reports without sending tweet content, handles, source URLs, collection names, tokens, or user-identifying data.

**Alternatives considered**:

- Include current tweet URL or handle: rejected because it is user-identifying context and not needed to open the feedback page.
- Include selected quote text or capture state: rejected because it violates privacy/data-minimization and would make feedback a capture-adjacent data path.
- Include account username: rejected because follow-up identity is handled by the hosted form's optional email field.

## Decision 3: Add two entry points using existing surfaces

**Decision**: Add "Send feedback" to the extension settings page and directly to the tray Gear menu.

**Rationale**: The settings page is the canonical always-available extension management surface. The tray Gear menu is the fastest path when a user notices an issue during capture because it is already opened from the tray gear button. Both surfaces already exist and are covered by tests.

**Alternatives considered**:

- Toolbar badge or ambient page UI: rejected because the constitution requires the extension to stay quiet until invited.
- Capture overlay primary action: rejected because feedback should not compete with quote submission.
- Options page only: rejected because it creates unnecessary friction when the tray Gear menu is already available.

## Decision 4: No new permissions, storage, or backend changes

**Decision**: Implement the feature with existing browser capabilities and no new persisted extension state.

**Rationale**: Opening a user-activated web page requires no new permission in this repo, and the hosted feedback page already owns server persistence. Avoiding storage keeps logout/clear-data behavior unchanged.

**Alternatives considered**:

- Add a permission for feedback navigation: rejected because it is unnecessary.
- Store recent feedback state in the extension: rejected because the hosted form owns submission status and history.

## Decision 5: Centralize URL construction and route opening through the background worker

**Decision**: Use a shared feedback destination builder and a single background message to open the feedback page.

**Rationale**: Both the options page and tray menu need identical privacy filtering and destination behavior. Centralizing URL construction prevents drift, and background-mediated opening gives both surfaces the same success/failure contract.

**Alternatives considered**:

- Duplicate URL construction in each UI surface: rejected because it increases the risk that one surface later adds unsafe context.
- Direct window navigation from both UI surfaces: rejected because it would split failure handling and make the tray/menu behavior depend on page context.

## Decision 6: Test deterministic URL/context generation and UI action wiring

**Decision**: Cover the feedback action in existing options/account-menu tests and add helper tests if URL construction is factored out.

**Rationale**: The risky behavior is accidental sensitive context leakage or regression of existing controls. These are deterministic and fit the repo's existing jsdom/Jest test style.

**Alternatives considered**:

- Browser end-to-end test against the live feedback page: rejected for this plan because the extension only opens a destination; the hosted page is backend-owned and already covered separately.
