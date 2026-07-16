# Contributing

Thanks for your interest in Quotewise Quote Capture. This is a Manifest V3
browser extension (Chrome + Firefox) written in TypeScript and bundled with
webpack.

## Getting started

This project uses **[Bun](https://bun.sh)** (≥ 1.3.4).

```bash
bun install
bun run dev          # webpack watch build → dist/; reload in chrome://extensions
```

Load the unpacked extension from `dist/` (Chrome) or build `dist-firefox/` with
`bun run build:firefox` (see the [README](./README.md) for both).

## Build, test, and development commands

- `bun run build` — production bundle (minified) → `dist/`; `dist/manifest.json`
  is generated from `manifest.prod.json`.
- `bun run build:firefox` — Firefox WebExtension from the same source → `dist-firefox/`.
- `bun run type-check` — `tsc --noEmit` static typing.
- `bun run lint` — ESLint for TypeScript sources; run before committing.
- `bun run test` — Jest + ts-jest in jsdom; `bun run test -- --coverage` for coverage.
- `bun run bump-version <version|major|minor|patch>` — update `package.json`,
  `manifest.json`, `manifest.dev.json`, and `manifest.prod.json` together. Do not
  edit version fields by hand.

### Before opening a PR

1. `bun run type-check`
2. `bun run lint`
3. `bun run test`
4. `bun run build` — then confirm `dist/manifest.json`,
   `dist/background/service-worker.js`, and `dist/content/index.js` exist.

## Testing

Tests live in `tests/`, mirroring `src/`, as `*.test.ts` files. They run in jsdom
with Chrome APIs mocked in `tests/setup.ts` — extend those mocks rather than
redefining them. Favor deterministic tests over brittle DOM snapshots.

Coverage is uneven and worth knowing: the background, auth, and X (Twitter)
extraction paths are well covered, while the three newer platform adapters
(Threads, Bluesky, Substack Notes) share one thin `multi-platform-adapters.test.ts`.
**A new or changed platform adapter should ship with a per-platform DOM-fixture
test** rather than leaning on the shared file.

## Browser compatibility: no polyfill

The extension calls the `chrome.*` APIs **directly** and deliberately does **not**
use `webextension-polyfill`. Firefox MV3 support load-bears on this: the same
source runs in both browsers because we rely on the callback-style `chrome.*`
surface that Firefox also implements, plus a small build-time manifest patch (see
`scripts/build-firefox.mjs`). Please don't introduce a polyfill or switch to the
`browser.*` promise API without accounting for the Firefox build — it will break
compatibility silently.

## Coding style

- TypeScript-first; keep modules small. 2-space indentation; match surrounding files.
- Use the webpack path aliases (`@api`, `@background`, `@content`, `@config`,
  `@types`, `@platforms`) instead of deep relative imports.
- Naming: PascalCase for classes/enums, camelCase for functions/variables,
  SCREAMING_SNAKE_CASE for constants/message types.
- Keep side effects in the background/content entry points; prefer pure helpers in `utils/`.

## Pull requests

- File an issue first for anything non-trivial so we can agree on the approach.
- Keep commits focused; use short, imperative messages (`Add …`, `Fix …`).
- Call out any manifest **permission** or API-surface change explicitly, with rationale.
- For overlay/UI changes, include before/after notes or screenshots, and list the
  verification commands you ran.

## License

By contributing, you agree that your contributions are licensed under the
project's [MPL-2.0](./LICENSE) license.
