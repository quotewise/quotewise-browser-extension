# Chrome Web Store — Screenshots & Promo Tiles plan

Research-backed plan for the listing's graphic assets. Sources: Chrome "Supplying images"
and "Creating a great listing page" (linked in the PR discussion). Companion to
[`chrome-web-store-listing.md`](./chrome-web-store-listing.md).

## Specs (hard requirements)

| Asset | Size | Format | Notes |
|---|---|---|---|
| Screenshots | **1280×800** (or 640×400) | JPEG / 24-bit PNG, **no alpha** | Full-bleed, square corners, no padding. ≥1 required, **5 preferred**. |
| Small promo tile | **440×280** | JPEG / 24-bit PNG, no alpha | **Required** to be eligible for editorial featuring / category placements. |
| Marquee tile | **1400×560** | JPEG / 24-bit PNG, no alpha | Optional; needed for marquee featuring. |

## Best practices (from the official guidance)

**Screenshots** — show the *actual* product UI and core experience (Chrome wants real,
unaltered screenshots, not mockups). Prefer 1280×800 for crispness. Use captions / light
annotations to explain each feature, but **don't overwhelm with text**. Clear, high-quality,
no blur/distortion. ≥1, ideally 5. The first screenshot does the most work (shown on cards) —
lead with the core value.

**Promo tiles** — these should communicate the **brand**, not just be a screenshot. Use
**saturated colors**; avoid lots of white/light-gray (the store background is light gray, so
contrast matters). **Fill the entire region**, well-defined edges. Must **work at half size**.
Keep text minimal (name + a ≤5–7-word tagline); avoid busy/cluttered.

## Capture setup (recommended — refines the "clean browser, famous quote" idea)

1. **Fresh Chrome profile, ONLY this extension loaded** (load-unpacked the built `dist/`), so
   the toolbar is clean — no other extension icons cluttering the shot.
2. **Real post from a reputable, contemporary originator** on a *supported* platform (X /
   Threads / Bluesky / Substack Notes). It must be a real post — the overlay only renders on
   real post pages, and authentic > mockup for both policy and credibility.
3. **Famous, non-controversial, genuinely quotable line.** Historical greats (Einstein, etc.)
   won't work — they aren't on social media; we need a living author who posts aphorisms.

**Originator shortlist** (living authors who post clean, quotable lines on supported platforms):
- **James Clear** (Atomic Habits) — universally respected, squeaky-clean aphorisms, active on X/Threads. *Top pick.*
- **Mark Manson** (@markmanson, Threads) — clean aphorisms; we already have a verified real quote ("Improving your life does not remove your problems. It simply exchanges them for better problems.").
- **Maria Popova / The Marginalian** (@brainpicker) — literary, reputable; Bluesky/Threads.
- **Adam Grant**, **Susan Cain**, **Brené Brown** — reputable, quotable, broadly liked.

Pick one, confirm they have a real, capturable post, and keep the same person across the set
for consistency.

## Screenshot storyboard (5, 1280×800, consistent branded canvas + short caption band)

1. **Hero — the capture.** Overlay open on the chosen author's real post; quote text + author
   detected; "Save to Quotewise" CTA visible. Caption: *"Capture any quote — attributed and sourced — in one click."*
2. **Attribution.** Originator-lookup showing the resolved author (✓ matched). Caption: *"Confirms the real author before saving."*
3. **Duplicate check.** Duplicate-badge result (e.g. "Already in Quotewise — View Quote", or a clean new-quote state). Caption: *"Checks for duplicates so the library stays clean."*
4. **The payoff.** The saved quote's page on quotewise.io with attribution + source link. Caption: *"Every quote links back to its source."*
5. **Reach.** Shows it works across X, Threads, Bluesky, Substack Notes. Caption: *"Works on X, Threads, Bluesky & Substack Notes."*

Treatment: inset the browser window on a saturated brand-teal canvas with a single caption
headline per frame (high-converting, consistent). Export 1280×800, no alpha.

## Promo tiles concept

- **Small (440×280, required):** brand-teal field, Quotewise owl mark, "Quotewise Quote
  Capture", tiny tagline ("Capture quotes. Keep the source."). Minimal text, fills the region,
  legible at half size.
- **Marquee (1400×560, optional):** same brand system, more breathing room — owl + name +
  tagline, optional faint product visual on the right.

## Who does what

- **Raw overlay screenshots** need the extension running in a real Chrome (load-unpacked
  `dist/` in a clean profile) on the chosen post — a short local setup.
- **Compositing** (branded canvas + captions), **dimension/format compliance** (1280×800,
  no-alpha export), and the **promo-tile mockups** can be produced from there.

## Status
⚙️ Pick originator + post → capture raw frames → composite + caption → export → small promo tile.
