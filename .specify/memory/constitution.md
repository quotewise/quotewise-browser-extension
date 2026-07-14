<!--
Sync Impact Report - Constitution v1.0.0
Version change: (uninitialized template) → 1.0.0
Ratification: Initial ratification 2026-06-04

This is the first concrete constitution for the Quotewise Chrome Extension. It replaces the
unfilled Spec Kit template with ten articles tailored to a Manifest V3 TypeScript extension.
It is self-contained and does NOT inherit the sibling Django project's constitution.

Articles (all new):
- I    Capture Integrity (NON-NEGOTIABLE)
- II   Privacy & Data Minimization
- III  Security & Permissions
- IV   Observability
- V    Resilience
- VI   Quality & Testing
- VII  User Experience
- VIII Platform Scope
- IX   Release Discipline
- X    Governance

Templates reviewed for consistency:
- .specify/templates/plan-template.md — ✅ Constitution Check section references this file; the
  gate list below is concrete and checkable. No structural template edit required.
- .specify/templates/spec-template.md — ✅ no mandatory section added/removed; compatible.
- .specify/templates/tasks-template.md — ✅ principle-driven task types (capture-integrity,
  privacy, security, observability, testing) are expressible under existing phases.

Deferred follow-ups (TODO):
- TODO(cookies-permission): The `cookies` permission is declared in manifest.json /
  manifest.prod.json / manifest.dev.json but has zero usages in src/. Per Article III it MUST be
  removed. Tracked as the first action item under this constitution.

Amendment v1.1.0 (2026-07-13) — MINOR. Gap: Article V.2 asserted an unconditional per-feature MUST
for a server kill-switch / min-version signal that has never been implemented, so every feature spec
failed the gate (surfaced during spec 010 analysis). Change: V.2's kill-switch is reclassified as a
**standing requirement** — until first shipped, its absence is a sanctioned, debt-tracked deviation
under Article X (bead `qw-g4s31`), not a per-feature blocker; a feature MUST NOT falsely claim it
exists. It reverts to a hard gate once implemented. The VI.3 live-X drift check remains a hard
requirement and is being satisfied concretely (spec 010, bead `qw-5j5nj`).
Also, Article II.1 is clarified: the pre-action allowlist governs tweet/user-identifying **data**, and
a fixed non-identifying client `platform` constant ('twitter') is permitted (it carries no user info,
nothing beyond what `source_url` encodes). No user/tweet data is added to the egress bound. No other
article changed; no template structure changed.
-->

# Quotewise Chrome Extension Constitution

**Version**: 1.1.0
**Ratified**: 2026-06-04
**Last Amended**: 2026-07-13

---

## Preamble

The Quotewise Chrome Extension is the **capture edge** of Quotewise: the place where a real
quote, said by a real person on a real platform, first enters the system. Everything
downstream — verification, attribution, discovery — inherits whatever this extension captures.
If the words that enter here are wrong, no amount of backend rigor can make them right.

Therefore the extension's prime directive is **faithful capture**: take what was actually said,
exactly as said, with correct attribution, and hand it to Quotewise without distortion — or
refuse and say so. The extension runs inside someone else's page (x.com), holds a user's login
tokens, and cannot be hotfixed on demand. It must be trustworthy, private, resilient, and quiet.

This Constitution is **self-contained**: it governs the extension surface alone and does not
depend on any other Quotewise repository's governance. It establishes NON-NEGOTIABLE principles.
Language follows [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119): **MUST** (required),
**SHOULD** (recommended), **MAY** (optional).

---

## Article I: Capture Integrity (NON-NEGOTIABLE)

**"A wrong capture is worse than no capture."**

Capturing the wrong tweet text, the wrong author, or a silently-altered quote is an attribution
failure, not a UX hiccup. The extension MUST prefer an honest "I couldn't read this reliably"
over a confident guess.

### Section 1: Confidence-Gated Extraction

- DOM extraction MUST produce a confidence signal, not just a value. When the page is ambiguous
  (no `[data-testid="tweetText"]` match, multiple competing article candidates, conflicting
  tweet IDs), extraction MUST resolve to a low-confidence state.
- Below the confidence threshold, the extension MUST surface an explicit "couldn't read this
  reliably" state and MUST NOT pre-fill or submit a best-guess capture.
- The article-selection scoring in `src/platforms/twitter/adapter.ts` is the integrity boundary;
  changes to it MUST preserve the bias toward *refusing* over *guessing wrong*.

### Section 2: Verbatim or Nothing

- The quote text submitted MUST be the captured words, unaltered. The UI MUST NOT expose an
  editable text field for quote content.
- The user MAY narrow a capture to a contiguous **excerpt** of the extracted text (selection),
  but MUST NOT be able to add, rephrase, or rewrite words.
- The overlay MUST display the **exact** text that will be submitted before submission, so the
  user always sees precisely what is being sent (see `src/content/ui/components/quote-preview.ts`).

### Section 3: No Silent Submission

- No quote MUST be transmitted without the user having seen the exact captured text in that
  session and taken an explicit submit action.

### Gates:
- [ ] Extraction returns a confidence signal; low-confidence yields a visible "unreadable" state, never a silent best-guess (I.1)
- [ ] No editable quote-text input exists anywhere in the UI; only excerpt selection is offered (I.2)
- [ ] The overlay shows the exact text to be submitted prior to any submit (I.2)
- [ ] Submission requires an explicit user action; no auto/silent submit path exists (I.3)

---

## Article II: Privacy & Data Minimization

**"The browser is sovereign; the network is a privilege the user grants."**

### Section 1: User-Controlled Preload

- The extension MAY preload duplicate/originator lookups on tweet-page load to make the overlay
  feel instant.
- A user setting MUST exist to disable all pre-action network calls; this setting MUST default
  ON (preload enabled) but MUST be honored globally when disabled.
- Pre-action network requests MUST be limited to public tweet identifiers — `{tweet_id, handle,
  source_url}`. Quote **text** and any **write** (submission) MUST occur only on an explicit user
  action, never during passive preload. *(Amendment v1.1.0, 2026-07-13: this allowlist governs
  tweet/user-identifying **data**. A fixed, non-identifying client build **constant** — the
  `platform` discriminator, always `"twitter"` for this X-only extension — is not user/tweet data and
  is permitted; it carries no information beyond what `source_url` already encodes.)*

### Section 2: Minimal Local Storage

- The extension MUST store only what it functionally needs in `chrome.storage`. TTLs MUST match
  the data's purpose (transient capture/lookup data short; nothing persisted longer than useful).
- On logout, the extension MUST wipe OAuth tokens AND all user-identifying cached data
  (`currentTweet`, `preloadedOriginator`, `preloadedDuplicateCheck`, search history, and any
  per-user caches).
- A manual "clear my data" affordance MUST exist and MUST clear the same set as logout.

### Section 3: Disclosure

- What is sent, when, and why MUST be disclosed in the store listing and privacy policy, kept in
  sync with the actual `{tweet_id, handle, source_url}` pre-action bound above.

### Gates:
- [ ] A setting disables all pre-action network calls and is respected globally (II.1)
- [ ] Pre-action egress of tweet/user data contains only tweet_id/handle/source_url (plus the fixed non-identifying `platform` client constant) — never quote text or writes (II.1)
- [ ] Logout clears tokens + all user-identifying cache; a manual clear-data action does the same (II.2)
- [ ] Storage TTLs are documented and tied to function, not arbitrary (II.2)

---

## Article III: Security & Permissions

**"Minimal surface, audited additions. The extension holds the keys to the house."**

The extension carries sensitive capabilities (`identity`, OAuth tokens, host access). A single
careless permission or dependency is a credential-theft vector.

### Section 1: Permission Minimalism

- A manifest permission MUST NOT be requested without a demonstrated use in `src/`. Unused
  permissions MUST be removed.
- Adding a new permission MUST include a one-line written justification in the PR and MUST use
  the narrowest scope that works.
- *Standing example:* the `cookies` permission is currently declared but unused (no `chrome.cookies`
  reference in `src/`); it MUST be removed.

### Section 2: Dependency Discipline

- New runtime dependencies MUST be justified in the PR (why it's needed, why not hand-roll) and
  evaluated for footprint and provenance, because a compromised dependency runs with the
  extension's token/host privileges.
- The dependency lockfile MUST be committed and pinned.

### Section 3: Secret Handling

- OAuth access and refresh tokens, and any cookie/credential material, MUST NEVER appear in
  logs, error messages, telemetry payloads, or thrown error text.
- Tokens MUST live in `chrome.storage` (not in code or memory-only). Access tokens SHOULD be
  short-lived with proactive, mutex-guarded refresh; refresh-token rotation MUST be handled
  without concurrent-refresh races (see `src/auth/`).

### Gates:
- [ ] Every declared manifest permission has a demonstrated code use; unused ones removed (III.1)
- [ ] New permissions/dependencies carry a one-line PR justification (III.1, III.2)
- [ ] Lockfile committed and pinned (III.2)
- [ ] No token/cookie/secret value can reach logs, errors, or telemetry (III.3)

---

## Article IV: Observability

**"Diagnose without surveillance."**

A silent failure in thousands of browsers is invisible to a solo developer; the answer is
content-free telemetry, not user tracking.

- Anonymous error/crash telemetry MAY be enabled by default to catch silent production failures.
- Telemetry payloads MUST be content-free: they MUST strip OAuth tokens, social handles, tweet
  text, and any user-identifying data before send. Telemetry MUST carry diagnostic shape (error
  type, code path, version) only.
- Telemetry MUST degrade gracefully: a telemetry failure MUST NOT affect capture or any core flow.

### Gates:
- [ ] Telemetry payloads provably exclude tokens, handles, and tweet text (IV)
- [ ] Telemetry transport failure does not break capture or core flows (IV)

---

## Article V: Resilience

**"The worker is ephemeral; storage is truth. The API will change under us; never crash on it."**

### Section 1: Service Worker Lifecycle

- The MV3 service worker MUST NOT hold authoritative state in memory. Any state whose loss on a
  service-worker restart would change correctness MUST live in `chrome.storage`.
- In-memory caches (e.g. `originatorCache`, in-flight maps) are permitted as disposable
  optimizations only and MUST be rebuildable after a restart.
- Message handlers MUST be idempotent and re-entrant so that termination mid-operation is always
  safe (preserve the `ensureServicesInitialized()` recovery pattern in
  `src/background/service-worker.ts`).

### Section 2: API Drift Tolerance

- The extension MUST assume `api.quotewise.io` can change while an old build is still installed.
  It MUST pin a versioned path (`/v1/`), ignore unknown response fields, treat missing fields as
  absent (not errors), and fall back to safe defaults on unexpected shapes rather than throwing.
- A server-driven kill-switch / minimum-supported-version signal MUST be honored: a build the
  server marks as too old or known-bad MUST stop capturing and prompt the user to update. This is
  the emergency brake that backs Article I when a shipped version is discovered to capture badly.
  *(Amendment v1.1.0, 2026-07-13: this mechanism has not yet shipped. Until it is first implemented
  it is a **standing requirement** tracked as sanctioned debt under Article X's Deviation Process
  (bead `qw-g4s31`), **not a per-feature blocking gate** — a feature MUST NOT falsely claim it
  exists, but its absence alone does not block a feature. It reverts to a hard gate once shipped.)*

### Section 3: Platform Constraints (informational)

- MV3 forbids multi-file service workers; `splitChunks` MUST remain `false` in `webpack.config.js`.
  Background and content scripts MUST each bundle to a single file.

### Gates:
- [ ] No correctness-bearing state exists only in memory; caches are rebuildable (V.1)
- [ ] Handlers are idempotent and survive mid-flight service-worker termination (V.1)
- [ ] API client pins /v1/, ignores unknown fields, and degrades (not throws) on unexpected shapes (V.2)
- [ ] A server kill-switch / min-version signal can disable capture in an installed build — OR, until first shipped, its absence is recorded as the standing tracked deviation `qw-g4s31` (V.2; amendment v1.1.0)
- [ ] `splitChunks: false` preserved; entry points bundle to single files (V.3)

---

## Article VI: Quality & Testing

**"Test the logic first; characterize the parts you don't control."**

### Section 1: TDD for Deterministic Logic

- Deterministic logic — state/badge resolution, validators, auth state machine, API client,
  caching, token refresh — MUST be developed test-first (failing test before implementation).

### Section 2: Characterization for DOM & UI

- DOM extraction and Shadow-DOM UI, which depend on a moving third-party page, MUST be tested via
  **characterization tests against captured HTML fixtures** rather than red-first against live X.
- Every reported bug MUST begin with a failing reproduction test before the fix (existing
  CLAUDE.md rule, now constitutional).

### Section 3: Living DOM Contract

- `specs/003-twitter-dom-parsing/spec.md` is the canonical DOM contract. Each extraction selector
  MUST have a fixture test.
- A recurring drift check against live X MUST run on a cadence; when selectors stop matching, it
  MUST open a tracked issue — it MUST NOT break the build (CI stays green; drift is triaged).

### Gates:
- [ ] Deterministic logic has a failing test written before implementation (VI.1)
- [ ] DOM/UI covered by fixture-based characterization tests; selectors have fixtures (VI.2, VI.3)
- [ ] Every bug fix is preceded by a failing repro test (VI.2)
- [ ] A scheduled drift check exists and files an issue (not a build break) on mismatch (VI.3)

---

## Article VII: User Experience

**"Invisible until invited. Honest in every word."**

### Section 1: Quiet Presence

- On a tweet page the extension MUST NOT inject UI on load. The toolbar action icon (its state
  defined by spec 004) is the only ambient signal; the on-page overlay MUST appear only on an
  explicit user action (icon click).
- Injected UI MUST NOT degrade the host page: no layout shift, no interference with x.com's own
  controls, and the overlay MUST be dismissable.

### Section 2: Accessibility (WCAG 2.1 AA)

- All injected UI MUST meet WCAG 2.1 AA: keyboard-operable controls, status conveyed by glyph or
  text and never color alone, visible focus states, ARIA labels on interactive elements, and
  honoring `prefers-reduced-motion` and `prefers-contrast`.

### Section 3: Honest Copy (no dark patterns)

- All extension copy MUST be honest and non-manipulative. No fake urgency, no confirm-shaming, no
  manufactured scarcity. Status strings MUST NOT overstate what was captured or imply a quote is
  "verified" beyond what the data supports.

### Gates:
- [ ] No injected UI on tweet-page load; overlay opens only on explicit action (VII.1)
- [ ] Overlay causes no host-page layout shift and is dismissable (VII.1)
- [ ] Injected UI is keyboard-operable, pairs color with glyph/text, exposes ARIA labels, honors reduced-motion/contrast (VII.2)
- [ ] No UI string uses fake urgency, confirm-shaming, or overstated capture/verification status (VII.3)

---

## Article VIII: Platform Scope

**"One platform, done right, beats five half-built."**

- Twitter/X is the only supported platform. The `PlatformAdapter` interface
  (`src/platforms/types.ts`) is the **sole** platform seam — it MUST be neither deepened into a
  speculative multi-platform framework nor removed — until a second adapter is genuinely in flight.
- Platform-specific assumptions MUST live behind the adapter, not leak into shared capture, UI,
  or state code.

### Gates:
- [ ] No multi-platform abstraction beyond the existing `PlatformAdapter` seam without a real second adapter in progress (VIII)
- [ ] X-specific logic stays behind the adapter, not in shared modules (VIII)

---

## Article IX: Release Discipline

**"Ship full, fix forward — with an emergency brake."**

- Releases MAY go to 100% rollout immediately; regressions are caught via anonymous telemetry
  (Article IV) and addressed with a fast follow-up.
- There MUST be a single source of truth for the version; `manifest.json`, `manifest.prod.json`,
  `manifest.dev.json`, and `package.json` MUST be kept in sync from it.
- Because the extension cannot be hotfixed on demand, the server kill-switch / min-version signal
  (Article V.2) is the emergency brake for any release found to violate Article I.

### Gates:
- [ ] Version is single-sourced and all manifests + package.json agree (IX)
- [ ] The kill-switch path is exercised/verified as the brake for integrity-critical regressions (IX, V.2)

---

## Article X: Governance

### The Constitutional Test

Before any implementation decision, ask:

1. Does this preserve faithful capture — right words, right author, or an honest refusal?
2. Does it respect the user's privacy and browser sovereignty?
3. Does it keep the permission and dependency surface minimal?
4. Does it survive a service-worker restart and an API change?
5. Was the deterministic logic written test-first; is the DOM characterized, not guessed?
6. Is the UI quiet, accessible, and honest?

**If any answer is "no," the implementation is unconstitutional.**

### Supremacy

This Constitution supersedes convenience. When it conflicts with a shortcut, the Constitution wins.

### Deviation Process

When deviation is required:
1. Document it in the feature's `plan.md` Complexity Tracking table.
2. Justify the violation and why a simpler, compliant approach is insufficient.
3. Track it as debt if temporary.

### Amendment Process

Amendments follow semantic versioning:
- **MAJOR**: Principle removals or fundamental redefinitions.
- **MINOR**: New principles added or existing ones materially expanded.
- **PATCH**: Clarifications, wording, non-semantic refinements.

All amendments MUST identify the gap that motivated the change and update the version line and
Sync Impact Report. Constitution changes propagate to Spec Kit templates via
`/speckit-constitution`.

### Spec-Kit Integration

- `/speckit-plan` MUST run the Constitution Check gates above before generating a plan.
- `/speckit-checklist` and `/speckit-implement` load this constitution for governance constraints.
- Non-compliant specs/plans are blocked until gates pass or a deviation is justified.

---

**Capture what was said. Exactly. Or say nothing at all.**

---

**Version**: 1.1.0 | **Ratified**: 2026-06-04 | **Last Amended**: 2026-07-13
