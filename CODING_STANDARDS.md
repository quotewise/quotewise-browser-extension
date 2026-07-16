# Coding standards

There is no single official style guide for browser extensions, so this project
uses the widely adopted baseline and layers a few house conventions on top:

- **TypeScript in `strict` mode** ([`tsconfig.json`](./tsconfig.json)).
- **ESLint** with `eslint:recommended` + `@typescript-eslint/recommended`, and the
  `webextensions` environment ([`.eslintrc.js`](./.eslintrc.js)).

**The linter and type-checker are the source of truth.** Run them before every
push; this document only covers what they can't enforce.

```bash
bun run lint
bun run type-check
```

## Naming

- `PascalCase` for classes, enums, and types.
- `camelCase` for functions and variables.
- `SCREAMING_SNAKE_CASE` for constants and message-type values.
- Prefix a deliberately unused binding with `_` (the lint rule ignores those).

## Type safety

- Prefer `unknown` over `any` for truly unknown values, then narrow with a type
  guard. `no-explicit-any` is a warning, not a hard error, but treat each `any` as
  a debt to justify.
- Use `Record<string, unknown>` for generic object shapes.
- Some Chrome APIs force `any` — `sendResponse` is typed `any`, and a few generic
  utilities (e.g. `debounce`) need `any` in a type parameter for inference. Wrap
  those in a scoped `// eslint-disable-next-line` with a one-line reason.
- Cast errors with an intersection, not `any`: `error as Error & { name: string }`.

## Structure

- Keep side effects in the entry points (`src/background/service-worker.ts`,
  `src/content/index.ts`); prefer pure, testable helpers in `utils/`.
- Keep modules small and single-purpose.
- Two-space indentation; match the surrounding file.
- Import with the path aliases (`@api`, `@background`, `@content`, `@config`,
  `@types`, `@platforms`) instead of deep relative paths. All three of
  `webpack.config.js`, `tsconfig.json`, and `jest.config.js` must agree on the
  alias set.

## Extension conventions (Manifest V3, Chrome + Firefox)

- **Call `chrome.*` directly. Do not add `webextension-polyfill` or switch to the
  `browser.*` promise API.** Firefox MV3 support load-bears on the callback-style
  `chrome.*` surface plus the build-time manifest patch in
  `scripts/build-firefox.mjs`; a polyfill breaks the Firefox build silently. See
  [CONTRIBUTING.md](./CONTRIBUTING.md#browser-compatibility-no-polyfill).
- **Bundles are single-file** (`splitChunks: false`). MV3 service workers and
  content scripts can't `importScripts()`, so webpack must emit one file each.
  Don't re-enable code splitting.
- **Keep permissions minimal.** Any change to a manifest's `permissions`,
  `host_permissions`, or `content_scripts` matches goes in **both**
  `manifest.dev.json` and `manifest.prod.json`, and must be called out with a
  rationale in the PR. See [docs/adding-a-platform.md](./docs/adding-a-platform.md).
- **Never log or persist tokens or user credentials**, in code or tests.
- **Guard trust boundaries.** Validate inbound message payloads and external data
  before use; don't weaken the validation to silence a type error.

## Comments

Comment the *why*, not the *what*. Match the surrounding file's comment density.
Write comments that read coherently on their own, not as a narration of what a
commit changed.

## Testing

See [CONTRIBUTING.md](./CONTRIBUTING.md#testing) for the test layout and the
per-platform-adapter fixture expectation.
