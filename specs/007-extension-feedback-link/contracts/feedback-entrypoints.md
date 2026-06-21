# Contract: Feedback Entry Points

## Destination Contract

All extension feedback actions open:

```text
https://quotewise.io/feedback/?src=chrome-ext&v=<extension-version>&platform=twitter
```

Rules:

- `src` is required and must be `chrome-ext`.
- `v` is included only when the extension version is available.
- `platform` is `twitter` for the current launch scope.
- No other current-page or account data may be appended.

Forbidden values:

- Quote text or selected text
- Tweet/source URL
- Social handle
- User identifier or username
- Collection identifier or collection name
- OAuth token, cookie, credential, or auth state details

## Settings Page UI Contract

Surface: extension settings/options page.

Required behavior:

- Show a "Send feedback" action regardless of authentication state.
- Place it with other help/account/support-style controls without changing existing settings.
- Activation opens the destination in a separate browser page.
- On navigation failure, show a non-blocking status message and leave all existing controls usable.

Regression constraints:

- Existing auth action, Private mode, Clear my data, auto-add, and default collection controls keep their current behavior.
- The feedback action does not write settings.

## Tray Gear Menu UI Contract

Surface: capture tray Gear/account menu opened by the gear button.

Required behavior:

- Show a "Send feedback" menu item directly with existing account/settings actions.
- Activation opens the same destination as the settings page.
- Activation does not submit a quote, alter capture state, clear data, or trigger auth.
- The menu remains keyboard-operable and exposes accessible menu semantics.

Regression constraints:

- Existing Private mode, Open settings, Log in, and Log out actions keep their current behavior.
- The feedback action does not include captured text or current tweet metadata in the opened destination.

## Failure Contract

If opening the destination fails:

- The initiating surface displays an honest, non-blocking failure message.
- Existing controls remain enabled or recover to their prior state.
- No retry is automatic; the user may activate the feedback action again.
