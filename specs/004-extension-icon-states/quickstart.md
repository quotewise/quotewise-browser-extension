# Quickstart: Extension Toolbar Icon States

**Feature**: `004-extension-icon-states` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

How to build the icon assets, run the tests, load the extension, and walk every state by hand. Uses
**Bun** (project rule), never npm.

## 0. Prerequisites

```bash
bun install                      # ensure deps present
bun add -d @resvg/resvg-js       # one-time: add the rasterizer devDependency (build-time only)
```

## 1. Generate the icon assets

```bash
# Vendor the master once (from the backend brand vector → assets/owl.svg), then:
bun run icons                    # scripts/generate-icons.mjs → public/icons/icon{n}.png + icon{n}-grey.png
git status public/icons          # the new -grey set + regenerated color set should appear
```

The script rasterizes `assets/owl.svg` at sizes {16, 32, 48, 128} for both the color and greyed
variants. Re-run it whenever `owl.svg` changes; the PNGs are committed (see
[contracts/icon-assets.md](./contracts/icon-assets.md)).

## 2. Run the tests (test-first — write these red before implementing)

```bash
bun run test -- tests/background/icon-state-resolver.test.ts   # precedence truth table + ties
bun run test -- tests/background/icon-applicator.test.ts       # chrome.action scoping + auth-transition clears
bun run test -- tests/utils/duplicate-status.test.ts           # recommendation → QuoteStatus mapping
bun run test -- tests/assets/icon-pipeline.test.ts             # PNG dims + greyed-set desaturation
bun run type-check && bun run lint
```

## 3. Build & load the unpacked extension

```bash
bun run build                    # production bundle → dist/ (copies public/icons → dist/icons)
# chrome://extensions → Developer mode → Load unpacked → select dist/
```

## 4. Walk the states (manual acceptance — maps to Success Criteria)

| Step | Action | Expect | SC |
|---|---|---|---|
| 1 | Reload/start while auth is still `UNKNOWN`/`CHECKING` | Color owl, no badge, neutral tooltip "Quotewise" (not "ready to capture") | FR-014 |
| 2 | Log out | **Greyed owl**, no badge, tooltip "Quotewise — log in to capture quotes" | SC-001 |
| 3 | Log in, open a **new** tweet | Color owl, `★` blue, "New quote — not in Quotewise yet" | SC-002 |
| 4 | Submit it, revisit | `✓` green, "Already in your collection" | SC-002 |
| 5 | Open a known **exact** duplicate tweet | `=` orange, "Exact match already in Quotewise" | SC-002/006 |
| 6 | Open a **paraphrase** (near-same) | `~` purple, "Similar version already in Quotewise" | SC-002/006 |
| 7 | Open a **misattributed** quote | `⚠` vermillion, "Heads up — attributed to someone else…" | SC-002 |
| 8 | While a check is in flight | static `●` sky (no animation) | FR-013 |
| 9 | Expire the session on a duplicate tweet | `!` vermillion (Error **wins** over the dup badge; stale quote badge gone) | SC-003 |
| 10 | Switch to a non-tweet tab | no quote badge leaks; ambient owl only | SC-007 |

## 5. Accessibility checks (manual gates)

- **Vision deficiencies**: Chrome DevTools → Rendering → "Emulate vision deficiencies" →
  deuteranopia / protanopia / achromatopsia. Every state must stay distinguishable by **glyph**, not
  color alone (SC-004, FR-051).
- **Glyph legibility at 1× and 2×** (HiDPI): confirm `=` vs `~` are not confusable and `⚠` does not
  render as a color emoji, with glyphs targeting ≥3:1 non-text contrast at real 16px (Decision D9,
  FR-051). If it does, substitute within the same shape family.
- **Accessible label**: hover each state; the tooltip (`setTitle`) must read meaningfully on its own
  (badge text is an image and is not announced — FR-050).

## 6. Definition of done (gates)

- [ ] Single resolver authority; the three legacy badge/icon sources are deleted (SC-005, FR-070).
- [ ] Resolver truth-table + mapping tests pass; written **before** implementation (VI.1).
- [ ] Greyed PNG set generated, committed, and asset test green (FR-060/062).
- [ ] `action.default_title` = "Quotewise" in all three manifests (FR-071, IX sync).
- [ ] `setBadgeTextColor` is never called (FR-003).
- [ ] Manual walk (§4) + a11y checks (§5) pass at 1× and 2×.
