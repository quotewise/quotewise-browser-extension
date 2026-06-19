# ADR-0003 — Extension feedback intake (Turnstile-gated)

- **Status:** Proposed
- **Date:** 2026-06-19
- **Priority:** P2 (recommended for launch)
- **Related beads:** `qw-0psq.21` (extension "Send feedback" link). Supersedes stale stubs `qw-4wy`, `qw-vzq`.

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

## Acceptance

- A public, Turnstile-gated feedback page exists at an agreed URL and records submissions with extension context.
- The extension's "Send feedback" link opens it with `v`, `src`, `platform` params.
