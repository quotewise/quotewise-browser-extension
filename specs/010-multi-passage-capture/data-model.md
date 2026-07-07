# Data Model: Capture Multiple Passages from the Same Post (Spec 010)

Phase 1 output. This feature adds **no persistent storage schema** — it reads new fields off the
existing duplicate-check response and holds transient state in the overlay. "Entities" below are the
in-memory / on-the-wire shapes the client reads and the small state it tracks.

## Entities

### Passage
A contiguous, verbatim excerpt of a post's text selected by the user (or the full post text when
nothing is selected).
- **Identity**: the passage's **normalized text** — `normalizeQuoteText(text)` = NFKC → collapse
  internal whitespace → trim. No offsets, no DOM anchors.
- **Becomes**: one `Quote` on submit (distinct normalized text + originator ⇒ distinct quote).
- **Lifecycle**: `selected → (checked) → new | already-captured-here → submitted`.

### Passage set for a URL (read-only, from the backend)
The set of **all** distinct quotes recorded at a source URL (shared corpus — any user's captures).
Sourced from `existing_sightings_for_url[]` on the duplicate-check response (ADR-0007). One entry
per distinct quote (backend dedupes by the `(quote, sighting_url)` uniqueness). Basis for the
"already captured this passage" decision, the passages panel, and the badge count.

### Consumed duplicate-check response (delta from ADR-0007 — verified against `../quotewise`)
`src/types/api.ts` — `DuplicateCheckResult`:
- `existing_sightings_for_url?: Array<{`
  - `sighting_id: number` *(existing)*
  - `quote_id: string` *(existing)*
  - `text: string` — **NEW**; verbatim quote text (used for the normalized match + snippet)
  - `short_code: string | null` — **NEW**; short id for linking
  - `web_url: string | null` — **NEW**; absolute quote-page URL (scheme-validated before use)
  - `sighting_url, platform_code, likes_count, originator {id, full_name}, created_at` *(existing)*
  - `}>`
- `existing_sightings_total?: number` — **NEW** top-level; true distinct-quote count at the URL
  (may exceed the capped list length of 50). Fallback when absent: `existing_sightings_for_url.length`.

All new fields are **optional on read** (Art. V drift tolerance): missing `text` ⇒ entry excluded
from the match set; missing `web_url`/`short_code` ⇒ snippet without link; missing total ⇒ use list
length; unexpected shape ⇒ neutral "this post already has captures" state.

### Overlay capture state (transient, `overlay-bar.ts` `CaptureState`)
No new persisted fields. Behavioral state derived per current selection:
- `selectedText` *(existing)* — the current passage text.
- Derived (not necessarily stored): `passageStatus ∈ { new, new-at-known-url, already-captured-here }`
  computed by the text-scoped classifier from `selectedText` + `existing_sightings_for_url[]`.
- The already-resolved `originator` is **preserved** across successive passages in one session
  (same author); only selection/preview/submit/duplicate state resets between passages.

## Derived values

- **`passageStatus`** (drives copy + submit directive):
  - `already-captured-here` — normalized `selectedText` equals some `existing_sightings_for_url[].text`
    → block; "already captured this passage" + View link.
  - `new-at-known-url` — URL has ≥1 passage but selection is normalized-distinct → allow; submit
    label "Capture another passage" + notice.
  - `new` — URL has no passages → normal single-capture flow (unchanged).
- **`passageCount`** = `existing_sightings_total ?? existing_sightings_for_url.length` → toolbar
  badge shows it when `>= 2` (formatted `1`–`9`, then `9+`), and the action title always states it
  in words (accessibility).

## Validation rules (from requirements)

- FR-002/FR-003: block is **text-scoped** (normalized-equal), never URL-scoped.
- FR-006: exact verbatim text shown before submit; no editable text field.
- FR-007: each passage submitted with the post's `source_url`; distinct passages ⇒ distinct quotes
  sharing the URL.
- FR-008/FR-009: panel + count are **global** (shared corpus), scheme-validated links.
- FR-010: invalidate `preloadedDuplicateCheck` after a capture so count/panel refresh.
- FR-011: degrade to a neutral state rather than show a wrong count.
