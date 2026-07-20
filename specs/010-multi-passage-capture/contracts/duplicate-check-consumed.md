# Contracts: Spec 010 (Multi-Passage Capture)

The extension exposes no external API. The relevant contracts are (1) the backend response it
**consumes** and (2) the **internal module interfaces** this feature changes. Per AGENTS.md, the
consumed shape is verified against the backend (ADR-0007, shipped).

---

## 1. Consumed — `POST /v1/quotes/check_duplicate/` response (ADR-0007 delta)

Only the delta this feature depends on is shown; all other fields (`recommendation`, `matches`,
`search_metadata`, …) are **unchanged** and consumed as today.

```jsonc
{
  // …unchanged fields…
  "existing_sightings_for_url": [        // was ≤1 entry; now every distinct quote at the URL (cap 50)
    {
      "sighting_id": 991,
      "quote_id": "482931",
      "text": "the verbatim captured passage text",   // NEW — normalized-match + snippet source
      "short_code": "aB3dK",                            // NEW — nullable
      "web_url": "https://quotewise.io/q/aB3dK/",        // NEW — nullable, absolute; scheme-validate
      "sighting_url": "https://x.com/user/status/123",
      "platform_code": "TX",
      "likes_count": 12,
      "originator": { "id": 17, "full_name": "…" },
      "created_at": "2026-06-30T12:00:00Z"
    }
  ],
  "existing_sightings_total": 3          // NEW — true distinct-quote count (≥ list length)
}
```

**Client read rules (Art. V):** unknown fields ignored; `text` missing ⇒ exclude entry from match
set; `web_url`/`short_code` missing ⇒ render snippet without link; `existing_sightings_total` missing
⇒ use `existing_sightings_for_url.length`; malformed ⇒ neutral "post already has captures" state.
`web_url` MUST pass the existing `safeHref` (http/https only) before it is rendered or navigated.

> Note: server `web_url` is `/q/{short_code}/`. **Consume `web_url` directly**; do not reconstruct
> the existing `/quotes/{short_code}` form used elsewhere in `duplicate-badge.ts`.

### 1b. Passive request — identifier-only (Art. II fix, FR-014)

The **automatic (page-load) preflight** request MUST omit quote text and all tweet/user data
**beyond** `{handle, source_url}`; it also carries the fixed non-identifying `platform`
client constant (`"twitter"`, permitted per Art. II.1, amendment v1.1.0). `existing_sightings_for_url` and `existing_sightings_total`
are **URL-derived**, so they come back correctly without sending text. The text-bearing fuzzy
`matches[]` populate only on the **explicit** path (`CHECK_DUPLICATE` from the overlay, and the
`explicit-duplicate-check` preflight site), where sending text is an explicit user action. Removing
`text: postData.text` from the automatic-preflight payload is the whole of the privacy change.

## 2. Internal — text-scoped classifier (`src/utils/duplicate-status.ts`)

Signature change: the classifier must see the current selection text to make a text-scoped decision.

```ts
// BEFORE: classifyDuplicateSighting(result): DuplicateSightingState   // URL-scoped: any sighting → exact
// AFTER:
classifyDuplicateSighting(result, currentText?: string): DuplicateSightingState
classifyMatchResolution(result, currentText?: string): MatchResolution
```

Behavior:
- `exact_sighting` / `exact` **only** when `normalizeQuoteText(currentText)` equals some
  `normalizeQuoteText(existing_sightings_for_url[i].text)`.
- URL has ≥1 passage but no normalized match ⇒ a **non-blocking** state (allow submit) that the
  overlay renders as "adding another passage."
- `currentText` omitted (or no `existing_sightings_for_url`) ⇒ preserve today's behavior for callers
  that don't pass it (back-compat within the extension).

New pure helper:

```ts
// src/utils/quote-text.ts
export function normalizeQuoteText(s: string): string  // s.normalize('NFKC') → collapse \s+ → trim
```

Passage count helper (for the badge) — **runtime-validated** (C4 / Art. V):

```ts
// src/utils/duplicate-status.ts
export function passageCountForUrl(result): number | 'unknown'
```

**Canonical count truth table** — the single source of truth, consumed by BOTH the badge (T019/T021)
and the panel (T018). Rows are evaluated top-to-bottom; first match wins (I1):

| `result` state | `existing_sightings_total` | `existing_sightings_for_url` | ⇒ result |
|---|---|---|---|
| `null` **or** `search_metadata.error === true` | — | — | `'unknown'` |
| ok | non-negative integer | — | **that integer** (total wins, even if list malformed) |
| ok | present but not a non-negative integer | — | `'unknown'` |
| ok | absent | array, `length < 50` | `length` (not capped ⇒ exact) |
| ok | absent | array, `length === 50` | `'unknown'` (may be capped) |
| ok | absent | present but not an array | `'unknown'` |
| ok | absent | absent | `0` (clean success ⇒ genuinely no captures ⇒ "new") |

`'unknown'` ⇒ neutral "this post already has captures", **no number** (never `0`/"new"); `0` ⇒ "new".
Never NaN/negative/throw. The **snippet text shown in the panel is the original verbatim `text`**
(truncated by character count) — normalization is used ONLY for identity matching, never for display.

Matched-entry resolver — for the exact-match "View quote" link (G2):

```ts
// src/utils/duplicate-status.ts
export function matchedSightingForText(result, currentText):
  { text: string; web_url?: string | null; short_code?: string | null } | undefined
// the existing_sightings_for_url[] entry whose normalizeQuoteText(text) === normalizeQuoteText(currentText);
// the "already captured this passage" link uses THIS entry's web_url, not matches[0].
```

## 3. Internal — toolbar badge (`chrome.action`, via icon-applicator)

When `passageCountForUrl(result) >= 2`, per-tab:

```ts
chrome.action.setBadgeText({ tabId, text })            // text: "1".."9" then "9+"; "" clears
chrome.action.setBadgeTextColor({ tabId, color })      // contrast; reuse collected/exists palette
chrome.action.setBadgeBackgroundColor({ tabId, color })
chrome.action.setTitle({ tabId, title })               // REQUIRED — badge text is NOT read by
                                                        // screen readers; title IS. e.g.
                                                        // "Quotewise — 3 passages captured from this post"
```

- `count == 1` → keep the current single-capture glyph/title (no numeric badge).
- `count == 0` → "new" state (unchanged).
- Badge is per-tab (`tabId`) and auto-clears when the tab closes.

## 4. Internal — duplicate-badge directives (`src/content/ui/components/duplicate-badge.ts`)

- `already-captured-here` → "Already captured this passage" + View-quote directive (submit disabled),
  as today's `renderExactSighting`, but gated on the text match rather than URL presence. The View
  link points at the **matched** entry's `web_url` (`matchedSightingForText`), **not** `matches[0]` (G2).
- **Passages panel** — rendered **whenever the URL has captures**, independent of the block/allow
  classification (shows in `already-captured-here` **and** `new-at-known-url`): a "N passages captured
  from this post" heading from `existing_sightings_total` (or a neutral "this post already has
  captures", **no number**, when the count is `'unknown'`), then **up to 5** `existing_sightings_for_url[]`
  entries as a `text` snippet **character-truncated** (slice to 100 chars + `…` when longer —
  deterministic, unit-testable; **not** CSS line-clamp) linked to `web_url`
  (scheme-validated; missing/invalid ⇒ snippet only; missing `text` ⇒ skip), and a **"+N more"**
  indicator when more passages exist than shown. Links keyboard-operable, **visible focus** + ARIA.
- `new-at-known-url` → submit **enabled** with label "Capture another passage" / "Add this passage" +
  a notice that the post already has a captured quote.
