# Quickstart: Capture Overlay Tray (005)

How to build, load, and verify each user story. Use **Bun** (project rule). The extension loads unpacked from
`dist/`. No new permission and no new runtime dependency are introduced.

## Build & load

```bash
bun run dev            # watch build → dist/  (development manifest, name contains "[DEV]" → DEBUG_MODE on)
bun run build          # production bundle (manifest.prod.json → dist/manifest.json)
bun run lint           # ESLint
bun run type-check     # tsc --noEmit
bun run test           # Jest (jsdom)
bun run test -- path/to/file.test.ts   # single file
```

Load: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. After `options_ui` is added, the
**Extension options** entry appears under the extension's *Details* page.

## Verify by user story

### US1 — Clean tray (FR-001..003, SC-001)
1. Prod build, authenticated, open a tweet, click the toolbar icon → overlay opens.
2. **Expect**: no engagement-metric chips (replies/retweets/likes/views/bookmarks), no author/date chip.
3. Dev build (`[DEV]`): trigger `GET_DIAGNOSTICS` (or read `debugLog` output) → full metrics present in diagnostics,
   still absent from the tray.

### US2 — Top-anchored controls (FR-010/011, SC-002)
1. Open the collapsed tray, then expand to the capture view.
2. **Expect**: refresh + close stay **top-right, top-aligned** in both states; no host-page layout shift; Tab reaches
   both with visible focus; close works via keyboard.

### US3 — Staged progress (FR-020..023, SC-003)
1. DevTools → Network → throttle (e.g. Slow 3G). Submit a quote.
2. **Expect**: after ~400 ms, "Checking…" → "Submitting…" → "Confirming…" advance, then success.
3. Fast connection: submit → **no** progress flash, just the result.
4. `prefers-reduced-motion` (DevTools rendering emulation): no spinner; text-only progress.
5. Force an error mid-flow → honest error + Retry; **never** a success state.

### US4 — Logout & clear data (FR-030..034, SC-004)
1. Authenticated → tray account menu → **Log out** (and repeat from options page).
2. **Expect**: toolbar → logged-out; load tweets → **zero** Quotewise background calls (Network panel);
   `chrome.storage.local` shows the user-identifying cache keys gone; `oauth_*` cleared; `token-refresh` alarm
   cancelled; device prefs (`privateMode`/`autoAddToCollection`/`firstRunNoticeShown`) intact;
   `settings.defaultCollectionId` null.
3. **Clear my data** (options): same cache wipe + `defaultCollectionId` null, **login unchanged**.
4. Confirm no token/secret string appears in any console log/diagnostic.

### US5 — Private mode + first-run notice (FR-040..044, SC-005/006)
1. Private mode OFF (default), authenticated, open a tweet → automatic checks run; spec-004 quote-status icon shows.
2. Turn **Private mode ON** (tray menu or options).
3. **Expect**: browse any number of tweets incl. opening the overlay → **zero** preflight/duplicate/originator
   Quotewise requests; toolbar shows **Paused** (grey owl + `‖`, title "Quotewise — paused (private mode)"); the
   overlay shows a **"Check now"** control; activating it runs the lookups (only then), Private mode stays ON, toolbar
   stays Paused. Auth-maintenance traffic such as token refresh/session checks is outside this check.
4. First-run notice: as a fresh synced profile, the first explicit overlay open while authenticated and Private mode
   is OFF shows a one-time dismissible notice **inside** the overlay (never on page load). Reopen → not shown again.
   Confirm the `firstRunNoticeShown` flag lives in `chrome.storage.sync` (survives SW restart + logout).

### US6 — Settings page & account menu (FR-050..053)
1. Open the options page (chrome://extensions → Details → Extension options).
2. **Expect**: account identity, working Log out, Private-mode toggle, Clear my data.
3. Tray account menu: quick Log out, Private toggle, **Open settings** (opens the options page).
4. Click the toolbar icon → still opens the **overlay** (no popup).
5. Change Private mode on the options page → tray menu + toolbar reflect it **without reload** (via `onChanged`).

### US7 — Default collection auto-add (FR-060..063, SC-007) — P2
1. Options → default-collection picker lists your collections, preselects the server default; enable **auto-add**.
2. Capture a quote → it lands in that collection.
3. Disable auto-add → capture → not auto-added.
4. Simulate a collection failure → the **quote still succeeds**; you're honestly told the collection step didn't
   complete (no silent loss).
5. No collections / list fails → picker shows honest empty/error; auto-add inert.

### US8 — Similar-match diff (FR-070..073, SC-008) — P2
1. Capture a tweet whose text is a **near match** to an existing quote.
2. **Expect**: a **word-level diff** (captured vs. on-record), added/removed marked by **markers/typography** (not
   color); **no** similarity percentage; a "view existing quote" link.
3. Verify under simulated deuteranopia/protanopia + reduced motion + high contrast (DevTools): still decodable.
4. Exact/no-match → no diff. Missing on-record text → read-only fallback badge (no broken diff).

### US9 — Add earlier sighting (FR-080..083, SC-009) — P3, blocked on API
1. Until django-api exposes `matches[].quote_date` (published date): the add-sighting action is **hidden/disabled**.
2. Confirm it stays hidden even when a record-creation timestamp is present (that MUST NOT be used).
3. (Once unblocked) tweet strictly older than the matched record's published date → action offered with hint "This
   tweet is older than our records"; otherwise read-only. Label says **sighting**, never "variant".

## Test entry points (TDD-first)

```bash
bun run test -- settings-store          # sync get/set/merge + onChanged (settings-storage contract)
bun run test -- private-mode            # SW gate on preflight entry points + first-run notice trigger
bun run test -- icon-state-resolver     # Paused precedence rows (spec-004 amendment)
bun run test -- logout                  # cache wipe vs. preference preservation + in-flight guard
bun run test -- progress                # debounced phase machine (progress-and-submit contract)
bun run test -- word-diff               # LCS word diff (similar-diff contract)
```

## Non-negotiables to re-check before "done"
- No new manifest permission; `cookies` stays absent (verify all three manifests).
- No new runtime dependency (`package.json` `dependencies` stays empty).
- `splitChunks: false` preserved; `options/index` bundles to a single file.
- `options_ui` added identically to `manifest.json` / `manifest.prod.json` / `manifest.dev.json`.
