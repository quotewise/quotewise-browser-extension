# Platform DOM Verification for Extension Capture

The canonical backend contract and promotion checklist live in `../quotewise/.worktrees/api-enhancements/docs/platform-dom-verification.md`. This extension document records where audit artifacts belong and how they map to adapter promotion.

## Artifact Layout

Store live-browser probe results under:

```text
specs/008-multi-platform-capture/audits/
├── twitter/
├── threads/
├── bluesky/
└── substack-notes/
```

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

