# Feature Specification: Similarity Duplicate — Add Sighting vs Add Variant

**Feature Branch**: `006-sighting-variant-choice`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "Similarity duplicate: add-sighting vs add-variant decision in the capture overlay (qw-hsly, chrome client integration)."

## Context

When a user captures a tweet, the extension asks the backend whether a matching quote already exists. The backend now distinguishes *how* a match was made (by the exact source URL vs. by text similarity) and, for similarity matches, classifies them as `exact`, `conflict` (different originator), or `similar` (same-originator near match). Today the overlay collapses every match into one behavior, which silently turns genuine near-match *variants* into mere *sightings* — losing distinct wording. This feature finishes the chrome-side integration of the now-deployed backend contract (see Dependencies) so the user, not the system, decides how to resolve a similar match.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resolve a similar (near-match) quote (Priority: P1)

A user captures a tweet whose text closely matches an existing quote **by the same person** already in Quotewise — a near match, not an exact/URL duplicate. Instead of the system silently deciding, the overlay shows the existing quote next to the captured text and lets the user choose: record this tweet as **another sighting** of the existing quote, or save it as a distinct **variant**.

**Why this priority**: This is the core feature. It removes the silent auto-collapse where near-matches were absorbed as sightings, erasing variant wording. It directly fulfills `qw-hsly`.

**Independent Test**: With the backend returning a `similarity` / `similar` match, open the overlay on such a tweet; verify the existing quote text is shown and two clearly-labeled actions appear; choosing each produces the correct outcome (sighting added vs. new variant created) and a matching confirmation.

**Acceptance Scenarios**:

1. **Given** a captured tweet that the duplicate check classifies as a same-originator near match (matched by similarity, class `similar`), **When** the capture flow completes, **Then** the overlay displays the existing quote's text (visually compared to the captured text) and two actions: "Add another sighting" and "Add as variant".
2. **Given** the similar-match decision is shown, **When** the user chooses "Add another sighting", **Then** the tweet's URL is linked to the existing quote as a new sighting, no new quote is created, and the overlay confirms "Sighting added".
3. **Given** the similar-match decision is shown, **When** the user chooses "Add as variant", **Then** a distinct new quote is created and linked to the existing quote for curatorial review, and the overlay confirms the quote was added as a variant.
4. **Given** the similar-match decision is shown, **When** the user dismisses the overlay without choosing, **Then** nothing is submitted.

---

### User Story 2 - Honest "couldn't verify" state when the duplicate check fails (Priority: P2)

When the duplicate check cannot be completed (backend error or unreachable), the overlay must say so plainly rather than presenting a confident "new quote" state that hides the failure.

**Why this priority**: Prevents users from unknowingly creating duplicates during an outage (`qw-0psq.4`); aligns with the constitution's "honest refusal over confident guess" (Article I).

**Independent Test**: Force the duplicate check to fail; verify the overlay shows a "couldn't verify duplicates" indication and does not show the normal no-badge new-quote state.

**Acceptance Scenarios**:

1. **Given** the duplicate check returns an error indication (or a non-success response), **When** the overlay renders duplicate status, **Then** it shows an explicit "couldn't verify duplicates" message and does **not** display the normal "new quote" (no-badge) state.
2. **Given** the "couldn't verify" state, **When** the user submits anyway, **Then** submission is still permitted (fail-open) but only after the user has been clearly informed the check did not run.

---

### User Story 3 - Different-originator match routes to attribution handling, not variant (Priority: P3)

When the closest match is attributed to a **different** originator (a possible misattribution), the overlay must not offer the sighting/variant choice; it routes to the existing attribution-conflict handling.

**Why this priority**: The sighting/variant decision only makes sense within a single originator; offering it across originators would encourage incorrect attribution merges, violating capture integrity (Article I).

**Independent Test**: With a `conflict`-class match, verify the two-button sighting/variant UI is NOT shown and the existing attribution-conflict treatment appears.

**Acceptance Scenarios**:

1. **Given** a match classified as a different-originator conflict, **When** the overlay renders, **Then** the sighting/variant two-button decision is not offered and the attribution-conflict state is shown instead.

---

### Edge Cases

- **Exact / URL duplicate** (already captured at this URL): unchanged single-action "Already captured" behavior; the sighting/variant decision is not shown.
- **Matched quote has no readable text**: fall back to offering the decision with a link to the existing quote (no inline comparison) rather than failing.
- **Rapid double-click / double activation** of a resolution action: exactly one submission occurs (ties to `qw-0psq.1`).
- **User narrowed the capture to a selection**: the selected, verbatim text is what is compared and submitted (Article I — no editing).
- **Backend rejects the linkage** (existing quote not visible to the user, or an incomplete decision pair): the overlay shows a clear, retryable error and creates no partial/incorrect record.
- **Older/unknown response lacking the new classification fields**: degrade to the prior recommendation-based behavior rather than breaking (Article V — API-drift tolerance).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the duplicate check classifies the captured tweet as a same-originator near match, the overlay MUST present the existing quote's text and offer exactly two resolution actions: *add another sighting* and *add as variant*.
- **FR-002**: The overlay MUST visually convey how the captured text differs from the existing quote (a word-level comparison) so the user can choose informedly; if the existing quote text is unavailable, it MUST still offer the choice with a link to the existing quote.
- **FR-003**: Choosing "Add another sighting" MUST link the current tweet's source URL to the existing quote and MUST NOT create a new quote; the overlay MUST confirm a sighting was added.
- **FR-004**: Choosing "Add as variant" MUST create a distinct new quote linked to the existing quote for review; the overlay MUST confirm the quote was added as a variant.
- **FR-005**: The overlay MUST submit the user's choice as a co-required pair (existing-quote reference + chosen intent) and MUST NOT send one without the other.
- **FR-006**: For exact/URL duplicates, the overlay MUST preserve the current single-action behavior and MUST NOT show the sighting/variant decision.
- **FR-007**: For different-originator (conflict) matches, the overlay MUST route to the existing attribution-conflict handling and MUST NOT offer the variant action.
- **FR-008**: When the duplicate check fails (error indication or non-success response), the overlay MUST show an explicit "couldn't verify duplicates" state and MUST NOT present it as a healthy new-quote state. Submission MAY proceed (fail-open), but only after the user is informed.
- **FR-009**: The system MUST stop treating a failed duplicate check as a successful new-quote result (removing the prior fabricated fallback).
- **FR-010**: The resolution actions MUST be keyboard-operable and announced to assistive technology; status MUST be conveyed by text/glyph, not color alone; copy MUST be honest and MUST NOT overstate what was captured or imply verification beyond what the data supports (Article VII).
- **FR-011**: A double activation of a resolution action MUST result in exactly one submission.
- **FR-012**: The overlay MUST NOT allow editing the quote text; the user MAY only choose how to resolve the match against the verbatim captured/selected text (Article I).
- **FR-013**: When the duplicate-check response omits the new classification fields, the overlay MUST degrade gracefully to prior recommendation-based behavior rather than erroring (Article V).

### Key Entities

- **Duplicate match**: the closest existing quote returned by the duplicate check — characterized by *how* it was matched (by URL vs. by text similarity), a collapsed match class (`exact` / `conflict` / `similar`), the existing quote's identifier and text, a similarity score, and whether this exact URL is already a sighting.
- **Resolution decision**: the user's explicit choice for a similar match — *sighting* (link to existing) or *variant* (create distinct) — paired with the existing-quote reference.
- **Capture**: the verbatim tweet text (or user-selected excerpt) and its source URL being submitted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a same-originator near match, the user is shown the existing quote and both resolution actions 100% of the time — never a silent auto-decision.
- **SC-002**: "Add another sighting" results in zero new quotes created and a linked sighting on the existing quote, confirmed to the user within ~1 second of the backend response.
- **SC-003**: "Add as variant" results in exactly one new quote linked to the existing quote for review.
- **SC-004**: During a duplicate-check failure, the user is never shown a "new quote" state that hides the failure; the "couldn't verify" state appears 100% of the time the check fails.
- **SC-005**: A double activation of a resolution action never produces more than one submission.
- **SC-006**: All new interactive controls are fully operable by keyboard and exposed to assistive technology (WCAG 2.1 AA).
- **SC-007**: Existing capture flows (exact-URL already-captured, plain new quote, attribution conflict) show no behavioral regression.

## Assumptions

- The backend contract for similarity provenance and sighting/variant submission is **deployed and frozen** as documented in `docs/server-launch-adrs/ADR-0001` and `ADR-0002` (as-built sections, 2026-06-20). This feature consumes it; no backend changes are in scope.
- The collapsed **match class** drives UI routing: `exact` → already-collected single action; `conflict` → attribution-conflict handling; `similar` → the two-button decision.
- The existing-quote identifier returned by the duplicate check is echoed back as the link reference on submission.
- "Couldn't verify" remains **fail-open** (submission allowed), consistent with spec 002, but paired with honest messaging per the constitution.
- The sighting action is offered for all `similar` matches regardless of relative dates; the prior date-based eligibility hint becomes informational, not a gate. *(To confirm in `/speckit-clarify`.)*
- The backend is the source of truth for similarity scoring; the client neither computes nor sends a similarity score.

## Dependencies

- `docs/server-launch-adrs/ADR-0001` (duplicate-check match provenance) and `ADR-0002` (sighting-vs-variant submission) — the deployed backend contract this feature binds to.
- Spec `002-sighting-status-ui` — existing read-only sighting badges this extends (must not regress).
- Spec `004-extension-icon-states` — `match_class` also drives toolbar icon states (`qw-eg3c`); keep consistent.
- Constitution Articles I (verbatim capture), V (API-drift tolerance), VI (TDD), VII (UX/accessibility/honest copy).
- Beads: `qw-hsly` (parent feature), `qw-0psq.4` (error contract). Related and may be folded in: `qw-0psq.1` (double-submit guard), `qw-0psq.6` (`javascript:` URI hardening — same components).
