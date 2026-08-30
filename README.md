# Quotewise Quote Capture

[![CI](https://github.com/quotewise/quotewise-browser-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/quotewise/quotewise-browser-extension/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/quotewise/quotewise-browser-extension)](https://github.com/quotewise/quotewise-browser-extension/releases)
[![Firefox Add-on](https://img.shields.io/amo/v/quotewise-quote-capture?label=firefox%20add-on)](https://addons.mozilla.org/addon/quotewise-quote-capture/)
[![License](https://img.shields.io/github/license/quotewise/quotewise-browser-extension)](./LICENSE)
<!-- Enable at store launch:
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ITEM_ID)](https://chromewebstore.google.com/detail/ITEM_ID)
[![App Store](https://img.shields.io/itunes/v/APP_ID?label=app%20store)](https://apps.apple.com/app/idAPP_ID)
-->

A browser extension (Chrome and Firefox, Manifest V3) for capturing quotes from
social posts and saving them to your [Quotewise](https://quotewise.io) library —
with attribution, a link back to the source, and a duplicate check before
anything is saved.

When you come across a quotable line, open the post's permalink page and click
the extension icon. An overlay opens over the post; you confirm the author and
the text, and the quote is submitted with full attribution and the source URL.

## Supported platforms

- **X** (formerly Twitter)
- **Threads**
- **Bluesky**
- **Substack Notes**

The extension only activates on a single post you choose to capture — it does not
read your feed or any other page content.

## How it works

1. **Browse normally.** When you see a post worth quoting, click into the post
   itself (its permalink page), then click the Quotewise icon. An overlay
   appears over the post. For a quote within a longer article, select the text
   you want to quote before clicking the Quotewise icon.
2. **Review and confirm.** The extension reads the quote text, the author name or
   handle, and the source URL from the page. You confirm the author before
   anything is saved.
3. **Duplicate check.** Before saving, Quotewise checks whether the quote already
   exists so you don't create accidental doubles.
4. **Save with attribution.** The quote is submitted with the author, the
   platform, the source link, and the public engagement counts visible at capture
   time. If you use Quotewise collections, you can pick which one(s) to file it
   into during capture.

Captured quotes go into the public Quotewise database, attributed to the original
author, and new contributors' submissions are reviewed by curators before
publication. See [quotewise.io/privacy](https://quotewise.io/privacy/) for how
data is handled.

## What to capture

The test is simple: **would someone quote this a year from now, without the
thread?** A passage bears collecting when it stands alone (it carries its
meaning without the reply chain, the embedded media, or the news cycle it was
posted into), when it's worth repeating (you could open a talk with it, put it
on a slide, or place it in a compendium — insight, wit, motivation, or a laugh
all qualify), and when it observes its moment rather than fights in it (a
professional's read on emerging trends belongs here; a hot take doesn't).

Please don't capture dunks, pile-ons, or hot takes; commercial endorsements;
commentary on embedded media that's meaningless without the media; or anything
a casual observer would never repeat.

Anyone can be quoted — we filter on the quotability of the words, not the
notability of the speaker. See the full guidelines at
[quotewise.io/about/what-to-collect](https://quotewise.io/about/what-to-collect/).

## Install

- **Firefox**: install from
  [addons.mozilla.org](https://addons.mozilla.org/addon/quotewise-quote-capture/).
- **Chrome / Brave / Edge**: not yet published to the Chrome Web Store — build
  from source below in the meantime.

## Build from source

This project uses **[Bun](https://bun.sh)** (≥ 1.3.4).

```bash
bun install
bun run build        # production bundle → dist/
```

### Chrome / Brave / Edge

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repo's `dist/` directory.

### Firefox

Firefox consumes the same source as a plain WebExtension (no separate repo):

```bash
bun run build:firefox   # → dist-firefox/ + web-ext-artifacts/*.zip
```

Then load `dist-firefox/` via `about:debugging` → **This Firefox** → **Load
Temporary Add-on**, or install the built zip from `web-ext-artifacts/`.

## Authentication & privacy

- Sign-in uses **OAuth 2.0 (Authorization Code + PKCE)** with an
  `Authorization: Bearer <token>` header. No passwords are entered into the
  extension, and it does not read your browser cookies.
- Access/refresh tokens are stored in `chrome.storage.local`. They, and any
  cached lookup data, are cleared when you log out, enable Private mode, or choose
  **Clear my data**.
- The extension talks only to `api.quotewise.io` and requests minimal permissions.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the build/test/PR workflow,
[CODING_STANDARDS.md](./CODING_STANDARDS.md) for style conventions, and
[SECURITY.md](./SECURITY.md) to report a vulnerability.

```bash
bun run type-check   # tsc --noEmit
bun run lint         # ESLint
bun run test         # Jest + jsdom
```

## License

[MPL-2.0](./LICENSE) © Quotewise
