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
| 3 | Log in, visit an unsupported site such as `example.com` | **Greyed owl**, no badge, tooltip "Quotewise — capture works on X/Twitter tweets" | SC-001/008 |
| 4 | Visit X/Twitter without a tweet in focus | Full-color owl, no badge, tooltip "Quotewise — open a tweet to capture" | SC-008 |
| 5 | Open a **new** tweet | Color owl, `★` blue, "New quote — not in Quotewise yet" | SC-002 |
| 6 | Submit it, revisit | `✓` green, "Already in your collection" | SC-002 |
| 7 | Open a known **exact** duplicate tweet | `=` green, "Exact match already in Quotewise" | SC-002/006 |
| 8 | Open a **paraphrase** (near-same) | `~` orange, "Similar version already in Quotewise" | SC-002/006 |
| 9 | Open a tweet from a handle with no Quotewise originator, without opening the overlay/tray | `@` orange, "Originator not in Quotewise — add them first" | FR-026/043 |
| 9a | Simulate slow combined preflight on a missing-originator tweet | Toolbar stays Loading during the bounded handle-only fallback, then changes directly to `@` without flashing full-color/no-badge Ready | FR-013a/043 |
| 9b | With the overlay/tray closed, simulate a hanging combined preflight where the delayed handle-only probe returns not-found | Toolbar updates from `●` to `@` before the 8-second timeout; opening the tray is not required to trigger the icon update | FR-013a/013c/043 |
| 9c | With the overlay/tray closed, simulate a hanging combined preflight where the delayed handle-only probe finds an originator | Toolbar remains `●` until combined preflight/duplicate status resolves; the found originator is cached for the tray | FR-013a/043 |
| 9d | Open the overlay/tray while automatic preflight is still running for an unknown-originator tweet | Tray renders the current tweet immediately, not "No tweet detected"; originator row may show lookup/loading until it resolves to `@`/not-found | FR-013c/046 |
| 10 | On a missing-originator tweet, open the overlay/tray while the toolbar still shows Loading | Toolbar changes from `●` to `@` as soon as the tray lookup reports not-found | FR-044 |
| 11 | Open the overlay/tray on a tweet whose originator lookup is still in flight | Toolbar shows static `●` until lookup resolves; if the tray uses fresh cached not-found data, toolbar updates to `@` immediately | FR-046 |
| 12 | From a known-originator parent tweet showing `★`, click into an unknown-originator reply in the thread | The parent `★` clears; the reply must not inherit the parent's badge while data catches up | FR-045 |
| 13 | Disable pre-action preload, then open a tweet without opening the overlay/tray | No duplicate/originator network preflight occurs before explicit engagement; tweet-specific badge may wait | FR-043 |
| 14 | Open a **misattributed** quote | `⚠` vermillion, "Heads up — attributed to someone else…" | SC-002 |
| 15 | While a check is in flight | static `●` sky (no animation) | FR-013 |
| 16 | Expire the session on a duplicate tweet | `!` vermillion (Error **wins** over the dup badge; stale quote badge gone) | SC-003 |
| 17 | Switch to a non-tweet tab | no quote badge leaks; ambient owl only | SC-007 |

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
- [ ] Automatic preflight honors the pre-action preload setting; the early handle-only probe sends only public `{handle, platform, source_url}` before explicit engagement (FR-043, Constitution II.1).
- [ ] Manual walk (§4) + a11y checks (§5) pass at 1× and 2×.
