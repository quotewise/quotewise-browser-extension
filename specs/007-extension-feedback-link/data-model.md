# Data Model: Extension Feedback Link

## Feedback Action

**Purpose**: User-visible control that opens the hosted feedback page.

**Fields**:

- `label`: Display text, fixed as "Send feedback".
- `surface`: One of `settings` or `tray-gear-menu`.
- `enabledState`: Always available; not gated on auth or capture state.
- `failureMessage`: Non-blocking message shown only if the browser cannot open the destination.

**Validation Rules**:

- Must be keyboard-operable.
- Must not trigger quote submission, login/logout, settings updates, clear-data, or capture-state changes.
- Must remain visible in authenticated, signed-out, session-expired, and insufficient-permissions states.

**State Transitions**:

1. `idle` -> `opening` when activated.
2. `opening` -> `opened` when the browser accepts the navigation.
3. `opening` -> `failed` when navigation fails; initiating surface remains usable.

## Feedback Destination

**Purpose**: Hosted Quotewise page that collects the actual feedback.

**Fields**:

- `baseUrl`: `https://quotewise.io/feedback/`.
- `context`: Extension feedback context appended for triage.

**Validation Rules**:

- Must use the agreed hosted page path.
- Must open outside the extension UI.
- Must not require extension authentication.

## Extension Feedback Context

**Purpose**: Non-sensitive values attached to the feedback destination so reports can be triaged.

**Fields**:

- `src`: Fixed source marker `chrome-ext`.
- `v`: Extension version, omitted if unavailable.
- `platform`: Supported platform marker `twitter`, omitted only if unavailable.

**Validation Rules**:

- Allowed values are limited to the fields above.
- Must never include quote text, selected text, tweet URLs, social handles, user identifiers, collection names, OAuth tokens, cookies, or credentials.
- Missing values are omitted rather than replaced with sensitive fallbacks.

**Relationships**:

- A Feedback Action opens one Feedback Destination.
- A Feedback Destination carries zero or one Extension Feedback Context.
