# Substack Notes DOM Audit Verdict

## Status

- Audit phase: Phase 4
- Promotion decision: do not promote
- Live URL set: pending
- Raw Probe A artifacts: pending in `raw/probe-a/`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| `substack.com` note permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Pending | No live Probe A JSON committed yet |
| Focal note selection excludes embedded/reposted/reply-context content | Pending | No live Probe A JSON committed yet |
| Author handle resolves through preflight to a slug-bearing originator | Pending | No live preflight result committed yet |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Custom-domain behavior is evidence-only, not auto-capture | Pending | Local tests reject arbitrary custom domains; live evidence pending |
| Deterministic fixture tests match the audited selector contract | Pending live audit | Local tests are present, but live selector contract is not promoted |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Substack hosts exist, but runtime flag remains disabled |

## Notes

Substack Notes remains disabled by runtime flag until this verdict passes. Do not promote custom-domain auto-capture without explicit backend and manifest host mapping work.

