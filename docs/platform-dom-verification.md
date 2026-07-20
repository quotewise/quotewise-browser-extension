# Platform DOM Verification for Extension Capture

The canonical backend contract and promotion checklist live in the backend repo's platform-dom-verification doc (private). This extension document records where audit artifacts belong and how they map to adapter promotion.

## Artifact Layout

Store live-browser probe results under:

```text
specs/008-multi-platform-capture/audits/
├── twitter/
├── threads/
├── bluesky/
└── substack-notes/
```

The reusable page-context probes and fixture manifest live in the same packet:

- `specs/008-multi-platform-capture/audits/fixtures.json`
- `specs/008-multi-platform-capture/audits/probes/capture-contract-probe.js`
- `specs/008-multi-platform-capture/audits/probes/selection-probe.js`
- `specs/008-multi-platform-capture/audits/probes/other-features-probe.js`
- `specs/008-multi-platform-capture/audits/probes/threads-contract-discovery-probe.js`

Each fixture should include:

- raw Probe A JSON
- raw Probe B JSON when selection validation applies
- a short verdict using the backend template
- the live URL class, not private account credentials or session data

## Required Matrix

Run the backend checklist for each platform:

- original post/note
- reply/comment context
- repost/quote/reshare context
- media post
- long or collapsed text
- deleted, unavailable, private, login-gated, or paywalled negative case
- non-English text
- low/zero likes and high/abbreviated likes

## Promotion Rule

Threads, Bluesky, and Substack Notes remain runtime-disabled until permalink extraction, handle resolution, duplicate/preflight, and submit succeed against live pages plus deterministic adapter fixtures. Likes stay optional and must only be captured when visibly reliable.
