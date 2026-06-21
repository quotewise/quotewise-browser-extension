# Threads DOM Audit Verdict

## Status

- Audit phase: Phase 2
- Promotion decision: do not promote
- Live URL set: pending
- Raw Probe A artifacts: pending in `raw/probe-a/`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Pending | No live Probe A JSON committed yet |
| `/post/` and `/t/` IDs are both reliable | Pending | Local fixtures cover both forms; live evidence pending |
| `threads.net` redirects are covered by runtime and manifest scope | Pending | Local fixture covers matching; live redirect behavior pending |
| Focal post selection excludes quoted/reposted/embedded/reply-context content | Pending | No live Probe A JSON committed yet |
| Author handle resolves through preflight to a slug-bearing originator | Pending | No live preflight result committed yet |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Deterministic fixture tests match the audited selector contract | Pending live audit | Local tests are present, but live selector contract is not promoted |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Host permissions exist, but runtime flag remains disabled |

## Notes

Threads remains disabled by runtime flag until this verdict passes. Omit likes if the live DOM does not expose a reliable visible like count.

