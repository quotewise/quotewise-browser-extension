# Server-side launch ADRs — Quotewise backend asks for the Chrome extension v1

**Created:** 2026-06-19
**Audience:** Quotewise backend (`quotewise` / `api.quotewise.io`) developer
**Source:** 2026-06-19 Chrome extension ship-readiness audit. Tracking epic: **`qw-0psq`** (Chrome extension v1 public-launch readiness).

These ADRs capture the **backend changes the extension needs** for a solid public launch. The extension itself has no hard technical blockers; the items below are the server-side half of cross-repo work. Each ADR is a proposal — the contracts are sketches for discussion, annotated with the exact extension code that will consume them.

## Index

| ADR | Title | Priority | Related beads | Launch-gating? |
|-----|-------|----------|---------------|----------------|
| [ADR-0001](ADR-0001-duplicate-check-match-provenance.md) | Duplicate-check: expose match provenance + matched-quote payload | P1 | `qw-hsly`, `qw-eg3c` | No — fast-follow feature |
| [ADR-0002](ADR-0002-sighting-vs-variant-submission.md) | Quote submission: explicit sighting-vs-variant linkage | P1 | `qw-hsly` | No — fast-follow feature |
| [ADR-0003](ADR-0003-extension-feedback-intake.md) | Extension feedback intake (Turnstile-gated) | P2 | `qw-0psq.21` (supersedes `qw-4wy`, `qw-vzq`) | No — recommended for launch |
| [ADR-0004](ADR-0004-oauth-production-redirect-readiness.md) | OAuth production redirect / client readiness | P1 | `qw-0psq.20` | **Yes** |
| [ADR-0005](ADR-0005-privacy-policy-data-disclosure.md) | Privacy policy + data-handling disclosure update | P1 | `qw-0psq.15` | **Yes** (Chrome Web Store gate) |
| [ADR-0006](ADR-0006-collections-membership.md) | Collections: add existing quote to a collection + membership in duplicate-check | P1 | `qw-si1t` | No — fast-follow feature |
| [ADR-0007](ADR-0007-quotes-by-sighting-url.md) | Duplicate-check: return all distinct quotes for a sighting URL (text + link) | P2 | `qw-1jzc` | No — fast-follow feature |

## Launch-critical vs. fast-follow

- **Must land before Chrome Web Store submission:** ADR-0004 (OAuth redirect for the real extension ID) and ADR-0005 (privacy-policy content). Without these the extension either cannot authenticate in production or will be rejected at review.
- **Strongly recommended at launch:** ADR-0003 (feedback intake) — cheap, and early bug reports are the highest-value signal post-launch.
- **First post-launch feature:** ADR-0001 + ADR-0002 (the "Add another sighting vs. Add new variant" flow, `qw-hsly`). Current behavior — treating a similarity match as an additional sighting — is acceptable for v1.
- **Also fast-follow:** ADR-0006 (collections membership — add an existing quote to a collection + per-collection membership in duplicate-check; extension spec 009, `qw-si1t`). Not launch-gating, but its data-disclosure surface (collection fetch/cache + synced last-used set) must be folded into ADR-0005's privacy-policy copy.
- **Also fast-follow:** ADR-0007 (return all distinct quotes for a sighting URL — text + link — in `check_duplicate`; extension spec 010 multi-passage capture, `qw-1jzc`). Additive read-path only; unblocks the "N passages captured from this post" panel + toolbar count. The write path already supports multiple distinct quotes per URL.

## Conventions referenced

- Auth: OAuth 2.0 Authorization Code + PKCE, `Authorization: Bearer <token>` (no session cookies / CSRF).
- API base: `https://api.quotewise.io`; web base: `https://quotewise.io`.
- Endpoints the extension currently calls: `POST /v1/quotes/`, `POST /v1/quotes/check_duplicate/`, `POST /v1/quotes/preflight/`, `GET /v1/originators/by-handle/`.
