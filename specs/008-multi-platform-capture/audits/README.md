# Multi-Platform DOM Audit Packet

This directory is the committed audit packet for feature 008. It holds the live-browser evidence required before any non-X platform flag can default on.

## Layout

```text
audits/
├── fixtures.json
├── probes/
│   ├── capture-contract-probe.js
│   ├── other-features-probe.js
│   └── selection-probe.js
├── twitter/
├── threads/
├── bluesky/
└── substack-notes/
```

Each platform directory contains:

- `raw/probe-a/`: full JSON output from `probes/capture-contract-probe.js`
- `raw/probe-b/`: full JSON output from `probes/selection-probe.js` when selection validation applies
- `raw/other-features/`: optional supporting JSON output from `probes/other-features-probe.js`
- `verdict.md`: the platform promotion summary

Do not commit credentials, private session data, cookies, storage dumps, or account-identifying details beyond public post URLs and handles already visible on the tested page. Keep non-X verdicts at `do not promote` until live duplicate/preflight and submit checks pass with a slug-bearing originator.

## Running A Fixture

1. Open the fixture URL in a logged-in browser.
2. Paste `probes/capture-contract-probe.js` in the page console and save the full JSON as `raw/probe-a/<fixture-id>.json`.
3. If the fixture checks text selection, highlight the requested text, paste `probes/selection-probe.js`, and save the full JSON as `raw/probe-b/<fixture-id>-<selection-class>.json`.
4. Paste `probes/other-features-probe.js` when deciding whether metadata, hydration, accessible labels, or stable identifiers should inform selector updates, and save the full JSON under `raw/other-features/`.
5. Update the platform `verdict.md` with pass/fail evidence and the promotion decision.
