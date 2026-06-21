# ADR-0003 — Extension feedback intake (Turnstile-gated)

- **Status:** Accepted — backend delivered (merged to `main` 2026-06-21, deploying). Extension-side link still pending.
- **Date:** 2026-06-19 (proposed) · 2026-06-21 (backend delivered)
- **Priority:** P2 (recommended for launch)
- **Related beads:** `qw-0psq.21` (extension "Send feedback" link — still open). Supersedes stale stubs `qw-4wy`, `qw-vzq`.
- **Delivered by:** quotewise PR #178 ("[codex] Add Turnstile feedback intake").

## Context

For a public v1 we want a low-friction channel for bug reports / feature requests from extension users. The highest-value signal in the first weeks of launch is real user feedback, and we want it gated against spam. The extension side is intentionally tiny — a **link** from the options page / account menu — so all the real work is a server-hosted, Cloudflare-Turnstile-protected intake.

## Decision (proposed)

**Recommended: a hosted, Turnstile-gated web form** (not an authenticated API endpoint).

- Add a page at `https://quotewise.io/extension-feedback` protected by Cloudflare Turnstile.
- The extension links to it (opens a new tab), passing non-PII context as query params so we can triage:
  - `?v=1.5.6&src=chrome-ext&platform=twitter` (extension version, surface, current platform).
- The page renders a short form: category (bug / feature / other), free text, optional email for follow-up. Turnstile token verified server-side before persisting.
- Persist to a simple `ExtensionFeedback` model (category, message, version, surface, optional email, created_at, request metadata) and/or forward to wherever triage happens.

**Why a hosted form over an API endpoint for v1:**
- No coupling to OAuth/Bearer (feedback should work even when logged out or when auth is the thing that's broken).
- Turnstile integrates cleanly with a server-rendered page; doing Turnstile from within the extension/content-script is more fragile (CSP, framing).
- Zero extension review surface — it is just an external link.

**Alternative (future):** `POST /v1/feedback/` accepting a Turnstile token + payload, for in-overlay submission without leaving the page. Documented here as a possible v2; not recommended for launch.

## What we need from the backend

1. A Turnstile-protected page at a stable URL (proposed `https://quotewise.io/extension-feedback`).
2. Accept and record the `v` / `src` / `platform` query params alongside the submission.
3. Server-side Turnstile verification + persistence (and/or notification to triage).
4. Confirm the final URL so the extension can hardcode it (`qw-0psq.21`).

## Consequences

- **Positive:** Spam-resistant feedback from day one; decoupled from auth; trivial extension change.
- **Cost:** One server page + model + Turnstile keys. Turnstile site/secret keys must be provisioned.

## Delivered (2026-06-21)

Shipped in quotewise **PR #178**, merged to `main` and deploying. Implemented as the proposed hosted, Turnstile-gated web form, with two naming deviations from this proposal:

- **Final URL is `/feedback/`** (Django route name `feedback`), not `/extension-feedback`. It is a general public feedback page; the extension is one entry point (distinguished by `src=chrome-ext`). **The extension should hardcode `https://quotewise.io/feedback/`** — this answers requirement 4 / `qw-0psq.21`.
- **Model is `Feedback`** (table `quotewise_feedback`), not `ExtensionFeedback` — one intake model serving web + extension.

Confirmed behavior:
- Cloudflare Turnstile verified server-side before persisting, plus a honeypot field and a 5/min per-IP rate limit (`CF-Connecting-IP`).
- Accepts and records the whitelisted `v` / `src` / `platform` query params alongside category (bug / feature / other), free-text message, and optional follow-up email.
- Persists the submission and fires best-effort triage email (`hello@quotewise.io`) + a PostHog event.
- `/privacy/` updated to disclose extension feedback data practices (see ADR-0005).

## Acceptance

- [x] A public, Turnstile-gated feedback page exists at an agreed URL (`https://quotewise.io/feedback/`) and records submissions with extension context.
- [ ] The extension's "Send feedback" link opens it with `v`, `src`, `platform` params. *(Extension-side change — point the link at `https://quotewise.io/feedback/`; tracked by `qw-0psq.21`.)*
