# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src` with feature folders: `background/`, `content/` (entry + adapter orchestrator), `platforms/` (platform adapters like Twitter), `popup/`, `api/`, `auth/`, `duplicate/`, `search/`, `utils/`, and `config/`.
- Tests mirror the source in `tests/` with `*.test.ts` files and shared mocks in `tests/setup.ts`. Built assets land in `dist/`.
- Chrome metadata and static assets reside in `manifest.json` and `public/`; `webpack.config.js` drives bundling and aliases.

## Build, Test, and Development Commands
- `npm run dev` — webpack watch build to `dist/`; reload the unpacked extension in `chrome://extensions`.
- `bun run build` or `npm run build` — production bundle (minified, cleaned `dist/`); `dist/manifest.json` is generated from `manifest.prod.json`.
- `npm run lint` — ESLint for TypeScript sources; run before committing.
- `npm run type-check` — `tsc --noEmit` for static typing.
- `npm test` — Jest + ts-jest in `jsdom`; use `npm test -- --coverage` to generate `coverage/`.
- `npm run clean` — remove `dist/`.
- `bun run bump-version <version|major|minor|patch>` — update `package.json`, `package-lock.json`, `manifest.json`, `manifest.dev.json`, and `manifest.prod.json` together. Do not edit version fields by hand.
- `bun run version:check` — verify all project version declarations are in sync.

## Release Build Verification
- Before a release or manual Chrome reload, run:
  1. `bun run version:check`
  2. `npm run type-check`
  3. `npm run lint`
  4. `npm test -- --runInBand`
  5. `bun run build`
- After building, confirm `dist/manifest.json`, `dist/background/service-worker.js`, and `dist/content/index.js` exist, and that `dist/manifest.json` has the intended version.
- In `chrome://extensions`, load or reload the unpacked extension from this repo's `dist/` directory. If the repo moved on disk, remove the old unpacked extension and load the new `dist/` path instead of only clicking reload.

## Coding Style & Naming Conventions
- TypeScript-first; keep modules small. Prefer 2-space indentation; match surrounding files.
- Use path aliases from webpack (`@api`, `@background`, `@content`, `@popup`, `@config`, `@types`, `@platforms`) instead of deep relative imports where appropriate.
- Naming: PascalCase for components/classes/enums, camelCase for variables/functions, SCREAMING_SNAKE_CASE for constants/message types.
- Favor pure helpers in `utils/` and keep side effects in background/content/popup entry points.

## Testing Guidelines
- Place specs beside the corresponding feature folder under `tests/` (e.g., `tests/background/...`, `tests/platforms/...`); file names should end with `.test.ts`.
- Tests run in `jsdom` with Chrome APIs mocked in `tests/setup.ts`; extend those mocks rather than redefining them.
- Cover new logic paths; favor deterministic tests over brittle DOM snapshots.

## Commit & Pull Request Guidelines
- Commit messages follow the existing short, imperative style (`Add …`, `Enhance …`, `Implement …`); keep scope focused per commit.
- PRs should include: a concise summary, linked backlog item (see `docs/delivery/backlog.md`), clear before/after notes for UI changes (screenshots for popup tweaks), and which verification commands were run.
- Call out manifest permission or API surface changes in PRs.

## Security & Configuration Tips
- Environments are defined in `src/config/environment.ts`; avoid hardcoding secrets or domains outside that map.
- Validate Chrome permissions remain minimal; update `manifest.json` deliberately and document rationale in PRs.
- Rely on existing session cookies for auth tests; do not log or persist user credentials in code or tests.
- Platform data flags protected tweets (`is_protected`); backend support pending—note rationale in PRs when touching submission flows.
- The in-page overlay bar is injected by `src/content/index.ts` and shown on demand via toolbar click (`SHOW_OVERLAY`); popup is disabled in the manifest to favor the page bar.
