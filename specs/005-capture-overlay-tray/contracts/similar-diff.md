# Contract: Word-Level Diff + Add-Earlier-Sighting (provenance)

## A. Word-level diff util — `src/utils/word-diff.ts` (FR-070)

```typescript
export interface WordDiffToken { value: string; type: 'equal' | 'added' | 'removed'; }
export function diffWords(onRecord: string, captured: string): WordDiffToken[];
```

- LCS over whitespace-tokenized words; deterministic; **no runtime dependency** (Article III.2, hand-rolled, TDD'd).
- `added` = word present in `captured` but not `onRecord`; `removed` = present in `onRecord` but not `captured`.
- Preserves word order and surrounding whitespace so the rendered diff reads as the original text with markers.

### Test contract (test-first)
- Identical strings → all `equal`.
- Pure insertion / pure deletion / substitution / reordering each produce the expected token sequence.
- Empty `captured` or empty `onRecord` handled without throwing.
- Unicode/emoji-bearing quote text tokenizes safely.

## B. Near-match rendering — `src/content/ui/components/similar-diff.ts` (FR-070..073, SC-008)

Replaces the read-only near-match presentation in/around `duplicate-badge.ts` for the `new_version` family.

- **Shown only** for near matches (`recommendation` in the `new_version*` family per `duplicate-status.ts`); exact /
  no-match never render the diff (FR-073).
- Renders `diffWords(matches[].text, capturedText)`; **added/removed marked by typography + marker** (e.g. underline
  + "＋", strikethrough + "−"), **never color alone** (FR-072, WCAG 1.4.1); honors `prefers-contrast`.
- **No similarity percentage** anywhere (FR-071).
- Provides a **"view existing quote"** link from `matches[].url` (or built from `short_code`) (FR-071).
- **Degradation (FR-073)**: if `matches[].text` is absent/empty, skip the diff and fall back to the existing
  read-only "similar version" badge — never render a broken diff.
- Keyboard-operable, ARIA-labelled (FR-100).

### Test contract (characterization)
- Near match renders a word diff with marked tokens and a view link; no percentage in the DOM.
- Exact/no-match render no diff.
- Missing on-record text → read-only fallback badge, no diff DOM.
- Diff decodable without color (markers present on added/removed tokens).

## C. Add earlier sighting — BLOCKED on API, ships hidden (FR-080..083, SC-009)

Composed into `SimilarMatchView.addSighting` (see data-model §5). Driven by a **capability check**:

| Condition | Action availability |
|-----------|---------------------|
| matched-record published date (`matches[].quote_date`) **absent** (today) | **hidden/disabled** (`available=false`) — FR-082 |
| published date present AND `TwitterData.date` **strictly earlier** | offered with hint "This tweet is older than our records" (FR-080) |
| published date present AND tweet not strictly earlier | read-only, no action (FR-081) |

- The matched record's **record-creation timestamp MUST NOT** be used as a provenance fallback (FR-082).
- Label is honest: **"Add as earlier sighting of this similar quote"** — it adds a **sighting** to the existing
  quote (current backend behavior); it MUST NOT claim it creates a distinct "variant" (FR-083). True variant
  creation awaits the django-api submit-intent param (spec Dependency (b), Out of Scope).
- On confirm (once unblocked): submission adds a sighting to the existing quote.

### Test contract (test-first)
- `available=false` (action hidden) whenever `quote_date` is absent — including when a record-creation timestamp is
  present (must NOT be used).
- `eligible=true` + hint only when `quote_date` present AND tweet strictly older; `eligible=false` otherwise.
- Label string is the sighting wording, never "variant".

## Dependency note

US8 (diff) is shippable **now** (on-record `text` already returned). US9 (add-sighting) is gated to hidden until
django-api adds `matches[].quote_date` (published date) to `check_duplicate`/`preflight` (spec Dependencies (a)).
