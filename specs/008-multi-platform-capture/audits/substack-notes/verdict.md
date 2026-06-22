# Substack Notes DOM Audit Verdict

## Status

- Audit phase: Phase 4
- Promotion decision: do not promote
- Live URL set: original fixture captured on 2026-06-22
- Raw Probe A artifacts:
  - `raw/probe-a/original-stoicwisdoms-c-280076000-public-rendered.json`
- Other-features artifacts:
  - `raw/other-features/original-stoicwisdoms-c-280076000-public-rendered.json`
- Contract-discovery artifacts:
  - `raw/contract-discovery/original-stoicwisdoms-c-280076000-public-rendered.json`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| `substack.com` note permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Candidate pass | Probe A and contract discovery returned `substack_notes`, `SS`, `https://substack.com/@stoicwisdoms/note/c-280076000`, and source ID `c-280076000` |
| Focal note selection excludes embedded/reposted/reply-context content | Candidate pass for original note | Metadata description matched the tested note body; visible candidate used a `role="article"` / `aria-label="Note"` root containing a matching note permalink link, excluding unrelated feed items below |
| Author handle resolves through preflight to a slug-bearing originator | Pending | No live preflight result committed yet |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Custom-domain behavior is evidence-only, not auto-capture | Pending | Local tests reject arbitrary custom domains; live evidence pending |
| Deterministic fixture tests match the audited selector contract | Pending update | Local tests still use synthetic `article` / `note-content` hooks; live page favors metadata primary plus visible Note root validation |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Substack hosts exist, but runtime flag remains disabled |

## Notes

Substack Notes remains disabled by runtime flag until this verdict passes. Do not promote custom-domain auto-capture without explicit backend and manifest host mapping work.

## Candidate Substack Notes Contract

Current evidence supports this contract for a public `substack.com` Note permalink:

| Field | Candidate Source | Current Confidence |
|-------|------------------|--------------------|
| `platform` / `platformCode` | Host match on `substack.com` plus static code `SS` | High |
| `sourceUrl` | Canonical link or `og:url`, both matching the note permalink | High for first fixture |
| `sourceId` | `/note/{id}` URL segment, e.g. `c-280076000` | High for first fixture |
| Author handle | `@handle` URL path and `og:title` handle | High for first fixture |
| Display name | `og:title` before the parenthesized handle | High for first fixture |
| Text | `og:description` / `description`, validated against visible Note body | High for first fixture |
| Posted date | `og:published_time` ISO timestamp | High for first fixture |
| Likes/replies | `twitter:labelN` / `twitter:dataN`, validated against visible action buttons | Medium; one fixture |
| Restacks | Visible `Restack` action button and detail stat row | Low; no metadata counterpart in first fixture |

The visible page also renders a `role="article"` / `aria-label="Note"` candidate containing a permalink link for the target source ID. That root is useful for validation and for restacks, but metadata is cleaner for primary text and date extraction on this fixture.

## Scenario Matrix

| Fixture Class | Status | Notes |
|---------------|--------|-------|
| original | Candidate contract found | `@stoicwisdoms` fixture validates canonical URL, metadata body/date/likes/replies, and visible Note-root body/action counts |
| reply/comment | Pending | Need direct URL |
| repost/quote/reshare | Pending | Need direct URL |
| media | Pending | Need direct URL |
| long/collapsed | Pending | Need direct URL |
| unavailable/private/login-gated | Pending | Need direct URL |
| non-English | Pending | Need direct URL |
| low/zero likes | Pending | Need direct URL |
| abbreviated/high likes | Pending | Need direct URL |
| custom domain evidence only | Pending | Need direct URL; do not promote without backend/manifest host mapping |

2026-06-22 public-rendered original fixture notes:

- `https://substack.com/@stoicwisdoms/note/c-280076000` rendered as a Substack Note by Stoic Wisdoms / `@stoicwisdoms`.
- Metadata primary extracted source ID `c-280076000`, posted time `2026-06-21T10:06:34.370Z`, likes `311`, and replies `12`.
- Visible text showed `Jun 21 at 3:06 AM`, matching the ISO metadata timestamp for Pacific time.
- Visible action buttons in the matching Note root showed likes `311`, replies/comments `12`, and restacks `40`.
- The page exposed no `time[datetime]` hook, so date extraction should prefer metadata over visible date text.
