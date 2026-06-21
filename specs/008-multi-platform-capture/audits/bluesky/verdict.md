# Bluesky DOM Audit Verdict

## Status

- Audit phase: Phase 3
- Promotion decision: do not promote
- Live URL set: pending
- Raw Probe A artifacts: pending in `raw/probe-a/`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Pending | No live Probe A JSON committed yet |
| `bsky.app/profile/{handle}/post/{rkey}` is reliable | Pending | Local fixture covers the URL form; live evidence pending |
| Focal post selection in threads excludes parent and embedded posts | Pending | Local fixture covers focal rkey selection; live evidence pending |
| Handle trust from the URL is valid for preflight | Pending | No live preflight result committed yet |
| Likes/date visibility is reliable or omitted | Pending | No live Probe A JSON committed yet |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Deterministic fixture tests match the audited selector contract | Pending live audit | Local tests are present, but live selector contract is not promoted |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Host permission exists, but runtime flag remains disabled |

## Notes

Bluesky remains disabled by runtime flag until this verdict passes. Treat handle and rkey extracted from the permalink as the primary identity signals unless live audit contradicts that contract.

