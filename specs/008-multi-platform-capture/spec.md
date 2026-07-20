# Feature Specification: Multi-Platform Quote Capture

## Status

In implementation. Backend contracts are implemented in the backend (private repo); this spec covers the Chrome extension work.

## User Story

As an extension user, I can capture a quote from a canonical post permalink on X, Threads, Bluesky, or Substack Notes, verify the author by platform handle, run duplicate/preflight checks, and submit only when the handle resolves to a Quotewise originator slug.

## Requirements

- Adapters emit platform-neutral captured post data: platform, platform code, source URL, source ID, text, author handle/name, posted date when available, likes when reliable, selection requirement, and platform data.
- X remains enabled by default and keeps existing behavior.
- Threads, Bluesky, and Substack Notes are present behind runtime platform flags and remain off until live audit promotion.
- Originator lookup and preflight send the captured platform string.
- Submit sends backend platform codes `TX`, `TH`, `BS`, or `SS`.
- Submit remains blocked until the extension has a slug-bearing originator.
- Likes are optional and must be omitted when unavailable or unreliable.
- Capture is for permalink pages only; feed capture and private platform APIs are out of scope.

## Acceptance Criteria

- Existing X capture, preflight, duplicate, variant/sighting, and submit flows continue to pass tests.
- New adapter fixture tests cover URL matching, source ID extraction, focal post selection, author handle normalization, canonical URL, date, optional likes, and selection-required behavior.
- Background stale-data checks and icon state use `{platform, sourceId}` rather than X status IDs alone.
- Manifest host permissions/content-script matches include all requested platform hosts.
- Live-probe artifacts are recorded before any non-X platform flag is promoted.

