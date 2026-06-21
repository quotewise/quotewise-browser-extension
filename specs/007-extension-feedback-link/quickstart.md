# Quickstart: Extension Feedback Link

## Pre-implementation Checks

1. Confirm the active feature:

   ```bash
   cat .specify/feature.json
   ```

2. Read the governing documents:

   ```bash
   sed -n '1,220p' specs/007-extension-feedback-link/spec.md
   sed -n '1,220p' specs/007-extension-feedback-link/contracts/feedback-entrypoints.md
   sed -n '1,180p' docs/server-launch-adrs/ADR-0003-extension-feedback-intake.md
   ```

## Expected Implementation Shape

1. Add a shared feedback destination builder that emits `https://quotewise.io/feedback/` with only approved context.
2. Add a background message handler that opens that destination on explicit user activation.
3. Add the "Send feedback" action to the options/settings page.
4. Add the "Send feedback" action directly to the tray Gear menu.
5. Preserve all existing account, settings, and capture behavior.

## Verification Commands

Run focused tests first:

```bash
bun run test -- tests/utils/feedback-url.test.ts tests/background/feedback-link.test.ts tests/options/options-page.test.ts tests/content/account-menu.test.ts --runInBand
```

Then run static checks:

```bash
bun run type-check
bun run lint
```

Before release or PR merge, run the full suite:

```bash
bun run test -- --runInBand
bun run build
```

## Manual Acceptance

- Open extension settings and confirm "Send feedback" is visible when signed in and signed out.
- Open the tray Gear menu and confirm "Send feedback" is reachable by keyboard.
- Activate feedback from both surfaces and confirm the opened destination includes `src=chrome-ext`, version when available, and `platform=twitter`.
- Confirm the opened destination does not include quote text, selected text, tweet URL, handle, account identity, collection data, or tokens.
