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

### Consumed duplicate-check response (delta from ADR-0007 — verified against the backend)
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
    → block; "already captured this passage" + View link to **that matched entry's** `web_url` (G2).
  - `new-at-known-url` — URL has ≥1 passage but selection is normalized-distinct → allow; submit
    label "Capture another passage" + notice.
  - `new` — URL has no passages → normal single-capture flow (unchanged).
- **`passageCount`** (`number | 'unknown'`) — resolved by the **canonical count truth table**
  (contracts §2): `result` null / `search_metadata.error` ⇒ `'unknown'`; else `existing_sightings_total`
  if a non-negative integer; else (total absent) `existing_sightings_for_url.length` **only if a valid
  array with length < 50** else `'unknown'`; present-but-malformed ⇒ `'unknown'`; both absent (clean
  success) ⇒ `0` (I1/INC1) → toolbar badge shows the number **only when `>= 2`**
  (formatted `1`–`9`, then saturating `9+`, with the **exact** count always in the accessible title);
  count `1` keeps the single-capture glyph; `'unknown'` ⇒ neutral "has captures", **no number**;
  `0` ⇒ "new". The panel and badge consume this one value (I2/I5).

## Validation rules (from requirements)

- FR-002/FR-003: block is **text-scoped** (normalized-equal), never URL-scoped.
- FR-006: exact verbatim text shown before submit; no editable text field.
- FR-007: each passage submitted with the post's `source_url`; distinct passages ⇒ distinct quotes
  sharing the URL.
- FR-008/FR-009: panel + count are **global** (shared corpus), scheme-validated links; panel displays
  **≤ 5** snippets (each the **original verbatim `text`** — NOT normalized — **character-truncated**: slice to 100 chars + `…`, deterministic; I2) + "+N more", and renders **whenever the URL has captures,
  independent of the current selection's classification** (I3); badge numeric **only at `>= 2`**,
  saturating `9+` with the **exact** count in the accessible title (I5).
- FR-010: invalidate `preloadedDuplicateCheck` after a capture so count/panel refresh.
- FR-011: validate arrays + non-negative-integer total at runtime; degrade to **one `'unknown'`
  neutral state** (distinct from `0`/"new"), reused by panel + badge, rather than show a wrong count
  or throw (I2).
- FR-014: automatic (page-load) preflight is **identifier-only** — no quote-text egress; exact
  matching is local against the URL-derived list; text-bearing fuzzy lookup only on explicit action.
- G2: the "already captured this passage" View link resolves to the **matched** passage entry's
  `web_url`, not `matches[0]`.
