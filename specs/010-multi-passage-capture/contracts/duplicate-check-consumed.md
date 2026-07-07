# Contracts: Spec 010 (Multi-Passage Capture)

The extension exposes no external API. The relevant contracts are (1) the backend response it
**consumes** and (2) the **internal module interfaces** this feature changes. Per AGENTS.md, the
consumed shape is verified against the sibling `../quotewise` backend (ADR-0007, shipped).

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

Passage count helper (for the badge):

```ts
// src/utils/duplicate-status.ts
export function passageCountForUrl(result): number     // existing_sightings_total ?? existing_sightings_for_url.length
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
  as today's `renderExactSighting`, but gated on the text match rather than URL presence.
- `new-at-known-url` → submit **enabled** with label "Capture another passage" / "Add this passage",
  plus the passages panel: for each `existing_sightings_for_url[]` entry, a snippet of `text` linked
  to `web_url` (scheme-validated), and a "N passages captured from this post" heading using
  `existing_sightings_total` ("+N more" when the list is capped). Links keyboard-operable + ARIA.
