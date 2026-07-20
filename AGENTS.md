# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src` with feature folders: `api/`, `auth/` (OAuth 2.0 Authorization Code + PKCE), `background/` (service worker), `content/` (entry + adapter orchestrator + Shadow-DOM overlay UI), `platforms/` (adapter registry + one adapter per supported platform), `config/`, `settings/`, `types/`, and `utils/`.
- Tests mirror the source in `tests/` with `*.test.ts` files and shared mocks in `tests/setup.ts`. Built assets land in `dist/`.
- The shipped Chrome manifest is `manifest.prod.json` (webpack copies it to `dist/manifest.json`); static assets reside in `public/`; `webpack.config.js` drives bundling and aliases.
- Webpack code splitting stays disabled (`splitChunks: false`): MV3 service workers and content scripts must each bundle to a single file — Chrome cannot load extra chunk files, and enabling splitting crashes the service worker on startup.

## Build, Test, and Development Commands
- Always use **Bun** (`bun run …`, `bun install`) — never npm/npx/yarn; the lockfile is `bun.lock`.
- `bun run dev` — webpack watch build to `dist/`; reload the unpacked extension in `chrome://extensions`.
- `bun run build` — production bundle (minified, cleaned `dist/`); `dist/manifest.json` is generated from `manifest.prod.json`.
- `bun run lint` — ESLint for TypeScript sources; run before committing.
- `bun run type-check` — `tsc --noEmit` for static typing.
- `bun run test` — Jest + ts-jest in `jsdom`; use `bun run test -- --coverage` to generate `coverage/`.
- `bun run clean` — remove `dist/`.
- `bun run bump-version <version|major|minor|patch>` — update `package.json`, `manifest.dev.json`, and `manifest.prod.json` together. Do not edit version fields by hand.
- `bun run version:check` — verify all project version declarations are in sync.

## Release Build Verification
- Before a release or manual Chrome reload, run:
  1. `bun run version:check`
  2. `bun run type-check`
  3. `bun run lint`
  4. `bun run test -- --runInBand`
  5. `bun run build`
- After building, confirm `dist/manifest.json`, `dist/background/service-worker.js`, and `dist/content/index.js` exist, and that `dist/manifest.json` has the intended version.
- In `chrome://extensions`, load or reload the unpacked extension from this repo's `dist/` directory. If the repo moved on disk, remove the old unpacked extension and load the new `dist/` path instead of only clicking reload.

## Coding Style & Naming Conventions
- TypeScript-first; keep modules small. Prefer 2-space indentation; match surrounding files.
- Use path aliases from webpack (`@api`, `@background`, `@content`, `@config`, `@types`, `@platforms`) instead of deep relative imports where appropriate.
- Naming: PascalCase for components/classes/enums, camelCase for variables/functions, SCREAMING_SNAKE_CASE for constants/message types.
- Favor pure helpers in `utils/` and keep side effects in the background/content entry points.

## Testing Guidelines
- Place specs beside the corresponding feature folder under `tests/` (e.g., `tests/background/...`, `tests/platforms/...`); file names should end with `.test.ts`.
- Tests run in `jsdom` with Chrome APIs mocked in `tests/setup.ts`; extend those mocks rather than redefining them.
- Cover new logic paths; favor deterministic tests over brittle DOM snapshots.

## Commit & Pull Request Guidelines
- Commit messages follow the existing short, imperative style (`Add …`, `Enhance …`, `Implement …`); keep scope focused per commit.
- PRs should include: a concise summary, a linked GitHub issue where applicable, clear before/after notes for UI changes (screenshots for overlay-bar tweaks), and which verification commands were run.
- Call out manifest permission or API surface changes in PRs.

## Issue Tracking
- External contributors: use **GitHub issues** and pull requests (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- Maintainers track work in a separate internal (private) tracker that is not part of this repository.

## Quotewise API Contract Verification
- Before changing code that consumes Quotewise API request/response shapes, verify against the live API (`https://api.quotewise.io`) rather than memory or stale local files.
- Treat the backend as the source of truth for extension contracts. Do not guess API shapes, add optional compatibility formats, or normalize alternate envelopes unless the contract explicitly documents those alternates or the user asks for backwards compatibility.

## Security & Configuration Tips
- Environments are defined in `src/config/environment.ts`; avoid hardcoding secrets or domains outside that map.
- Validate Chrome permissions remain minimal; update `manifest.prod.json` deliberately and document rationale in PRs.
- Auth uses OAuth 2.0 Authorization Code + PKCE with `Authorization: Bearer <token>` (no session cookies/CSRF); never log or persist tokens or user credentials in code or tests.
- Platform data flags protected tweets (`is_protected`); backend support pending—note rationale in PRs when touching submission flows.
- The in-page overlay bar is injected by `src/content/index.ts` and shown on demand via toolbar click (`SHOW_OVERLAY`); popup is disabled in the manifest to favor the page bar.
