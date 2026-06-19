# Contract: Icon Asset Pipeline

**Feature**: `004-extension-icon-states` | Implements FR-060, FR-061, FR-062 · Decisions D1, D3

Defines the build-time artifact contract: one vector master in, two PNG sets out, produced by a
CI-portable rasterizer. The output is the **interface the runtime `setIcon` depends on** — fixed
filenames, sizes, and color values.

## Input (master)

- **`assets/owl.svg`** — vendored from the brand `quotewise.svg` (the **5-path** version with
  explicit eye/nose/feet and an open chest). The 2-path `quotewise-light.svg` MUST NOT be used
  (drops interior detail — FR-061).
- Composition (per design §6, adjusted after toolbar review): owl recolored `beige`, centered at
  full source scale on a `#304f50` rounded square (corner radius ≈ 19%). The grey variant: owl
  `#6b7280` on `#e5e7eb` (FR-062).

## Generator

- **Tool**: `@resvg/resvg-js` (devDependency; prebuilt Rust binaries → CI-portable). ImageMagick and
  `qlmanage` MUST NOT be used (FR-062).
- **Script**: `scripts/generate-icons.mjs`, run via `bun run icons`.
- **Per size** `n ∈ {16, 32, 48, 128}`:
  ```js
  new Resvg(svg, { fitTo: { mode: 'width', value: n }, shapeRendering: 2 }).render().asPng()
  ```
  Render each size natively (not one large raster downscaled) for crisp 16px detail (D1).

## Output (committed, copied to `dist/` by copy-webpack-plugin)

```
public/icons/
├── icon16.png   icon32.png   icon48.png   icon128.png        # color owl
└── icon16-grey.png  icon32-grey.png  icon48-grey.png  icon128-grey.png   # NEW greyed owl
```

**Contract invariants**
- Filenames and sizes are exact; runtime `setIcon` paths (`icons/icon{n}.png`,
  `icons/icon{n}-grey.png`) MUST match this set 1:1.
- `icon{n}.png` and `icon{n}-grey.png` are both `n × n` px.
- The `-grey` set is measurably less saturated than the color set (greyed, not merely tinted).
- The color set **regenerates from `owl.svg`** — the previously hand-placed PNGs are replaced so the
  brand owl is the single source (FR-060). Binary diffs in `public/icons/` are intentional and
  reviewed in the PR.

## CI / reproducibility (D3)

- `bun run icons` is deterministic for a fixed `owl.svg` + resvg version.
- CI step: run `bun run icons` then `git diff --exit-code public/icons/` — fails if committed PNGs
  drift from the master (catches an un-regenerated asset).

## Manifest references (must stay in sync — Constitution IX)

`manifest.prod.json`, `manifest.dev.json`, and root `manifest.json` (root is consistency-only; prod/dev
are build-effective):
- `icons` and `action.default_icon` keep the **color** set (`icons/icon{16,32,48,128}.png`).
- `action.default_title`: change `"Capture Quote"` → `"Quotewise"` (FR-071).
- The `-grey` set is **not** declared in the manifest (it is applied only at runtime via `setIcon`).

## Test (`tests/assets/icon-pipeline.test.ts`)

- All 8 files exist under `public/icons/`.
- Each PNG header reports the expected `n × n` dimensions.
- For each `n`, mean saturation of `icon{n}-grey.png` < mean saturation of `icon{n}.png`.
