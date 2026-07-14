# Specification Quality Checklist: Capture Multiple Passages from the Same Post

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-02
**Revised**: 2026-07-13 (speckit-analyze remediation — 16 findings resolved)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- US1 ships client-only against the live backend; it **depends on ADR-0007's response `text` shape**
  (local text-scoping) but not on US2's presentation. US2 depends on ADR-0007's count/link fields.
- Some spec sections name existing concepts (source URL, sighting, collection picker, overlay),
  prior specs (003/006/009), and specific consumed-contract field names (`existing_sightings_for_url[].text`,
  `existing_sightings_total`, `web_url`, the removed `text: postData.text` egress). These are domain
  vocabulary and the ADR-0007 contract this client consumes — not implementation prescriptions; the
  FRs and Success Criteria remain technology-agnostic.
- **2026-07-13 remediation (analyze pass 1 + 2)**: privacy fix (FR-014, identifier-only passive
  preflight — no quote text, `platform` is a redundant non-identifying constant; corrects a
  pre-existing Article II violation); badge numeric only at ≥ 2, saturates `9+` with exact-count title
  (FR-009); panel up to 5 + "+N more", ~100-char truncated snippets, rendered independent of selection
  (FR-008); matched-link identity (FR-003); text required for a blocking decision — absent text ⇒
  non-blocking (FR-002); one `'unknown'` neutral count state reused by panel + badge (FR-011);
  captured-HTML fixtures for the guard **and** the panel (Art. VI); a11y checks for new UI (Art. VII);
  disclosure re-sync task (Art. II.3).
- **Standing gates (pass-2 governance decision)**: **VI.3 live-X drift check is built here** (plan
  Phase 6, tasks T028–T029; bead `qw-5j5nj`). **V.2 kill-switch is deferred** as a standing tracked
  requirement via **constitution amendment v1.1.0** (bead `qw-g4s31`) — not a per-feature gate until
  first shipped.
- **Analyze pass 3**: `platform` clarified as a permitted non-identifying client constant (folded into
  constitution amendment **v1.1.0**, Art. II.1 — no version bump, edited in place); count resolver
  tightened (list-length used only when a valid array with length < 50, else `'unknown'`, INC1);
  deterministic **character** snippet truncation (INC2); a test-first applicator task replacing the
  `never setBadgeTextColor` invariant (CON2); drift workflow pinned — cron/path/targets/permissions/
  dedup (AMB2); overlay-open/selection network behavior clarified as non-blocking (AMB1); disclosure
  docs named (UND1); file-count estimate corrected to ~9 (INC3).
- **Analyze pass 4**: one **canonical count truth table** in contracts §2 referenced everywhere (I1,
  incl. `search_metadata.error` ⇒ `'unknown'` and clean-empty ⇒ `0`); panel snippets show the
  **original verbatim** text, normalization is identity-only (I2); `currentText` = selected excerpt
  else extracted full-post text, non-blocking only on extraction failure (I3); privacy wording fixed to
  "no quote text and no tweet/user data **beyond** `{handle, source_url}`" (A1); unmeasurable latency
  claim deleted (A2); MVP checkpoint is **validation-only**, release-gated on Polish + VI.3 (C2); T004
  noted as the failing bug-reproduction, UI characterized after (C1); newest-selection-wins for stale
  fuzzy responses (U2); attribution-conflict + collection-picker targeted regressions (G1); drift
  checker selector-source / headless-render / failure-classification specified (U1).
- No `[NEEDS CLARIFICATION]` markers remain — all decisions resolved via the interview + four analyze passes.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
