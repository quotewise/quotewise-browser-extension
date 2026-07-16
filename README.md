# Quotewise Quote Capture

[![CI](https://github.com/quotewise/quotewise-chrome-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/quotewise/quotewise-chrome-extension/actions/workflows/ci.yml)

A browser extension (Chrome and Firefox, Manifest V3) for capturing quotes from
social posts and saving them to your [Quotewise](https://quotewise.io) library —
with attribution, a link back to the source, and a duplicate check before
anything is saved.

When you come across a quotable line, click the extension icon. An overlay opens
over the current post; you confirm the author and the text, and the quote is
submitted with full attribution and the source URL.

## Supported platforms

- **X** (formerly Twitter)
- **Threads**
- **Bluesky**
- **Substack Notes**

The extension only activates on a single post you choose to capture — it does not
read your feed or any other page content.

## How it works

1. **Browse normally.** When you see a post worth saving, click the Quotewise
   icon. An overlay appears over the current post.
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

## Build from source

The extension is not yet on the Chrome Web Store / AMO, so load it unpacked from a
local build. This project uses **[Bun](https://bun.sh)** (≥ 1.3.4).

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
