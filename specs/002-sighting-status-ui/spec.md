# Feature Specification: Sighting Status UI

**Created**: 2026-01-19
**Status**: Implemented
**Last Updated**: 2026-02-22 - Cross-reference badge race fix from Spec 001 v1.4.4

## Overview

Display sighting status information in the overlay bar to inform users whether a tweet URL is already captured, has an existing platform sighting, or would add a new sighting. This enables platform-aware duplicate handling in the Chrome extension.

## Background

The Quotewise API returns `sighting_status` in duplicate check responses to indicate the relationship between the current URL and existing quotes:

| Status | Meaning |
|--------|---------|
| `exact_url` | This exact URL is already a sighting in Quotewise |
| `has_platform_sighting` | Quote exists with a different Twitter sighting |
| `no_platform_sighting` | Quote exists but has no Twitter sighting yet |

Previously, this data was returned by the API but not displayed in the overlay bar UI.

## User Scenarios & Testing

### User Story 1 - Exact URL Already Captured (P1)

User navigates to a tweet that has already been captured at this exact URL.

**Why this priority**: Prevents wasted effort and duplicate data entry.

**Independent Test**: Navigate to a tweet URL that exists as a sighting in Quotewise; verify blocked submission with clear messaging.

**Acceptance Requirements**:

1. **When** duplicate check returns `sighting_status: 'exact_url'`, the overlay **MUST** display green "Already captured" badge
2. **When** `exact_url` status detected, submit button **MUST** be disabled with "Already Captured" text
3. **If** user attempts submission via code/script, the system **MUST** block the request

---

### User Story 2 - Platform Sighting Exists (P2)

User navigates to a tweet for a quote that has a different Twitter sighting.

**Why this priority**: User may legitimately want to add another sighting, but should be informed first.

**Independent Test**: Navigate to tweet for a quote with existing Twitter sighting (different URL); verify warning shown and submission allowed.

**Acceptance Requirements**:

1. **When** duplicate check returns `sighting_status: 'has_platform_sighting'`, the overlay **MUST** display orange "Platform sighting exists" badge
2. **While** platform sighting warning shown, submit button **MUST** use warning style with "Add Another Sighting" text
3. **When** user clicks submit, the system **MUST** proceed with submission (no blocking)

---

### User Story 3 - No Platform Sighting (P3)

User navigates to a tweet for a quote that exists but has no Twitter sighting.

**Why this priority**: Encourages users to add valuable platform sightings to existing quotes.

**Independent Test**: Navigate to tweet for quote with no Twitter sighting; verify info badge and normal submission.

**Acceptance Requirements**:

1. **When** duplicate check returns `sighting_status: 'no_platform_sighting'`, the overlay **MUST** display blue "Add sighting" badge
2. Submit button **MUST** remain in default success style
3. Badge title **MUST** explain that submission will create a new sighting

---

### Edge Cases

- **If** `sighting_status` is `unknown` or missing, **then** system **MUST** fall back to recommendation-based badges
- **If** `matches` array is empty, **then** system **MUST** fall back to recommendation-based badges
- **If** duplicate check fails, **then** system **MUST** allow submission (fail-open for UX)

## Requirements

### Functional Requirements

- **FR-001**: Sighting status badges **MUST** take priority over recommendation-based badges
- **FR-002**: **When** `exact_url` detected, submission **MUST** be blocked both in UI and in submit handler
- **FR-003**: **When** `has_platform_sighting` detected, submit button **MUST** use warning styling (orange)
- **FR-004**: Badge hover titles **MUST** explain the sighting status in user-friendly terms
- **FR-005**: **When** sighting status is present, `updateDuplicateInfo()` **MUST** check first match's `sighting_status` before `recommendation`

### Badge Mapping

| Sighting Status | Badge Text | Badge Style | Submit Button |
|-----------------|-----------|-------------|---------------|
| `exact_url` | "Already captured" | Green (success) | Disabled, "Already Captured" |
| `has_platform_sighting` | "Platform sighting exists" | Orange (warning) | Enabled, "Add Another Sighting" (warning style) |
| `no_platform_sighting` | "Add sighting" | Blue (info) | Enabled, "Submit Quote" (normal) |
| (none/unknown) | (fallback to recommendation) | (varies) | (varies) |

### Key Entities

- **DuplicateCheckResult**: API response containing `matches[]` with `sighting_status`
- **OverlayBar**: UI component displaying capture form and status badges

## Implementation

### Modified Files

| File | Changes |
|------|---------|
| `src/content/ui/overlay-bar.ts` | Updated `updateDuplicateInfo()` to check sighting status; added `updateSubmitButtonWarning()`; added submission guard in `submitQuote()` |

### Code Changes

1. **`updateDuplicateInfo()`** - Added sighting status priority logic before recommendation checks
2. **`updateSubmitButton()`** - Added class reset to ensure consistent styling
3. **`updateSubmitButtonWarning()`** - New method for warning-styled submit button
4. **`submitQuote()`** - Added guard to block `exact_url` submissions

## Success Criteria

- **SC-001**: Users see correct sighting status badge within 500ms of duplicate check completing
- **SC-002**: Users cannot submit quotes for exact URL matches (button disabled + backend guard)
- **SC-003**: Users can override platform sighting warning and submit successfully
- **SC-004**: Badge tooltips explain status clearly to non-technical users

## Assumptions

- Backend API returns `sighting_status` in first match of duplicate check response
- Sighting status is only present when `matches[]` is non-empty
- `exact_url` status is authoritative (URL definitely exists in Quotewise)

## Dependencies

- Spec 001: Centralized Auth State Management (auth required for duplicate checks)
- Backend API: Duplicate check endpoint returning `sighting_status` field

### Related: Extension Icon Badge vs Overlay Sighting Badge

These are two distinct badge systems that share the same duplicate check data:

| System | Location | Shows | Owned By |
|--------|----------|-------|----------|
| **Extension icon badge** | Chrome toolbar icon | ★/✓/+/○ | `service-worker.ts` → `updateCollectionBadgeForTweet()` |
| **Overlay sighting badge** | Inside overlay bar UI | "Already captured" / "Platform sighting exists" / "Add sighting" | `overlay-bar.ts` → `updateDuplicateInfo()` |

**v1.4.4 fix**: The extension icon badge had a race condition where `tabs.onUpdated` would overwrite the final collection badge (★/✓/+) with `○` (analyzing) when both handlers ran concurrently on cold service worker startup. Fixed by removing the `○` badge from `updateExtensionIconForTweetPage()` — the `TWEET_DATA_EXTRACTED` handler now exclusively owns the collection badge lifecycle. The overlay sighting badges were not affected (they live inside the overlay DOM, not the toolbar icon).

## Out of Scope

- Displaying multiple sighting statuses when multiple matches exist
- Link to view existing quote/sighting in Quotewise
- Confirmation dialog for platform sighting override (button styling change is sufficient)
