# Chrome Web Store — Store Listing

Living doc for the CWS "Store listing" tab. Build up over time; keep in sync with the
actual Dashboard. Companion docs: [`chrome-web-store-permissions.md`](./chrome-web-store-permissions.md),
[`chrome-web-store-privacy-practices.md`](./chrome-web-store-privacy-practices.md).

Status: ✅ ready · ⚙️ needs an asset/decision · ⛔ blocked elsewhere

---

## Product details

**Item title** ✅ — `Quotewise Quote Capture`

**Summary** ✅ (132-char limit; this is 121) — from `manifest.prod.json` `description`:
> Save quotes from X, Threads, Bluesky & Substack Notes to your Quotewise library — attributed, sourced, duplicate-checked.

**Category** ✅ — **Workflow & Planning** (recommended), within the *Productivity* group.
The dropdown groups categories under three headers; *Productivity* is a header, **not** a
selectable option. A capture-into-a-curated-library tool is essentially a quote clipper — a
collect/organize workflow — so Workflow & Planning fits best; **Tools** is an equally
acceptable generalist alternate. Not *Social Networking* — it captures *from* social media,
it isn't a social tool. Full dropdown for reference:
- **Productivity:** Communication · Developer Tools · Education · Tools · Workflow & Planning
- **Lifestyle:** Art & Design · Entertainment · Games · Household · Just for Fun · News & Weather · Shopping · Social Networking · Travel · Well-being
- **Make Chrome Yours:** Accessibility · Functionality & UI · Privacy & Security

**Language** ✅ — **English**. One listing covers everyone; you do NOT need a separate
extension per supported platform or per language. The four supported *platforms*
(X/Threads/Bluesky/Substack) are unrelated to listing language. Later you can add
**localized listings** (translated store copy) and localize the extension UI via `_locales/`
i18n — both optional, neither requires a separate item.

**Description** ✅ (~2,450 chars; 16,000 limit). Plain text, paste as-is:

```
Quotewise Quote Capture — save quotes from social media to a shared, source-attributed quote library.

When you come across a quotable line on X, Threads, Bluesky, or Substack Notes, this extension makes it easy to capture it before you scroll past. With one click it reads the post, lets you confirm the details, and saves the quote to Quotewise with full attribution and a link back to the original source.


HOW IT WORKS

1. Browse normally. When you see a post worth saving, click the Quotewise extension icon. An overlay appears over the current post.

2. Review and confirm. The extension reads the quote text, the author name or handle, and the source URL from the page. You check the details and confirm the author before anything is saved.

3. Duplicate check. Before saving, Quotewise checks whether this quote already exists in the database. If it does, you'll see it — no accidental doubles.

4. Save with attribution. The quote is submitted with the author's name, the platform, the source link, and the public engagement counts visible on the post at capture time. If you use Quotewise collections, you can choose which existing collection(s) to file it into during capture.


SUPPORTED PLATFORMS

- X (formerly Twitter)
- Threads
- Bluesky
- Substack Notes


WHY ATTRIBUTION MATTERS HERE

Quotewise is built around the idea that a quote is only as useful as its source. Every captured quote includes:

- The author as shown on the original post
- A direct link back to the original post
- The platform and capture date
- Engagement data (likes, reposts) visible at time of capture, so context is preserved

If the author name on the post is ambiguous, the extension prompts you to confirm before saving. You are not guessing; you are recording what the source actually says.


GOOD TO KNOW

Quotes you capture go into the public Quotewise database, not a private personal collection. They may appear in public search results, on Quotewise quote pages, and via the Quotewise API, attributed to the original author. Submissions from new contributors are reviewed by Quotewise curators before they are published. This is the whole point: you are helping build a shared, carefully attributed library of contemporary voices, the kind of quotes that appear on social media before they ever appear in a book.

A free Quotewise account is required. Sign-in is handled through OAuth — no passwords are entered into the extension, and the extension does not read your browser cookies or access any page content outside the specific post you choose to capture.

To preload duplicate status on a supported X post before you click the toolbar, the extension sends only the public author handle and source post URL (which contains the tweet ID), plus the fixed platform value "twitter." It does not send quote text, display name, engagement counts, or other post content during this automatic check.

When you open the collection picker or collection settings, the extension fetches your existing Quotewise collection names so you can choose where to file a quote. That list is cached briefly in Chrome local storage for speed, and the slugs for your most recently used collection set are stored in synced extension settings so future captures can be pre-selected. These collection caches/settings are cleared when you log out, enable Private mode, or choose Clear my data.

For full details on how data is handled, see quotewise.io/privacy.


WHO IT IS FOR

- Readers and researchers who want to cite social media posts accurately
- Newsletter writers and content creators who collect quotable ideas while they browse
- Quote collectors who care about getting attribution right, not just saving text
- Anyone who has ever copied a tweet into a notes app and then lost track of where it came from


Quotewise Quote Capture is a focused tool. It captures, attributes, and saves. It does not post, summarize, monitor feeds, or use AI to process your browsing.
```

---

## Graphic assets

**Store icon** ✅ (decided — revisit if it looks oversized) — use the existing
`public/icons/icon128.png` (128×128, alpha). Measured art box ~92×114 (padding 18px L/R,
7px T/B); it's vertically taller than the guideline's 96×96 + 16px-uniform, but the logo's
center mass sits within the 96×96 safe area, so it reads cleanly. Guideline:
[here](https://developer.chrome.com/docs/webstore/images#icons).
- If we later want guideline-perfect, regenerate a 96-in-128 padded version from the master
  `../quotewise/static/logos/quotewise_2024px_square.png` (or SVG `Icon Lite.svg`).

**Screenshots** ⚙️ (≥1 required, up to 5) — **1280×800 or 640×400**, full-bleed (square corners,
no padding), JPEG or 24-bit PNG, **no alpha**. Action: capture the overlay on a real post for
each platform (e.g. the capture overlay on an X post mid-confirm, a duplicate-check result, the
originator-confirm step). Best taken from a real session.

**Small promo tile** ⚙️ — **440×280**, JPEG/24-bit PNG no alpha. Required by current guidelines.

**Marquee promo tile** ⚙️ — **1400×560**, JPEG/24-bit PNG no alpha. Optional (enables marquee
featuring).

**Promo video (YouTube)** ⚙️ — optional. A 30–60s screen-capture of a real capture flow.

---

## Additional fields

**Homepage URL** ⚙️ — use `https://quotewise.io` now. Recommended: a dedicated extension landing
page (e.g. `https://quotewise.io/extension`) for conversion + reviewer context — create later,
not required.

**Support URL** ✅ — `https://quotewise.io/feedback/?src=cws-listing` — the in-app feedback intake
(`buildFeedbackUrl`, base `https://quotewise.io/feedback/`). The `src` param distinguishes
store-listing feedback from in-app (`src=chrome-ext`).

**Privacy policy URL** ✅ — `https://quotewise.io/privacy/` (live; updated by main-repo PR #185 to
disclose public publication + AWS sub-processors + curation).

---

## Asset checklist

| Field | Status |
|---|---|
| Title | ✅ |
| Summary | ✅ |
| Description | ✅ |
| Category | ✅ Workflow & Planning |
| Language | ✅ English |
| Store icon 128×128 | ✅ existing icon128.png (revisit if oversized) |
| Screenshots (≥1, 1280×800) | ⚙️ capture from real session |
| Small promo tile 440×280 | ⚙️ design |
| Marquee tile 1400×560 | ⚙️ design (optional) |
| Promo video | ⚙️ optional |
| Homepage URL | ⚙️ quotewise.io now; dedicated page later |
| Support URL | ✅ |
| Privacy policy URL | ✅ |

**External dashboard sync required:** the store-listing maintainer must copy the automatic-preflight
disclosure above into the live Chrome Web Store listing when this version is submitted.
