# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue
for a vulnerability.

Email **security@quotewise.io** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- the extension version and browser you observed it on.

We'll acknowledge your report as soon as we can and keep you updated on the fix.
Please give us a reasonable window to release a patch before any public
disclosure.

## Scope

This extension authenticates via OAuth 2.0 (Authorization Code + PKCE) and stores
access/refresh tokens in `chrome.storage.local`. Reports involving token
handling, the OAuth flow, permission scope, or leakage of captured data to
unintended origins are especially in scope. It communicates only with
`api.quotewise.io`.

## Supported versions

Only the latest released version is supported. Please confirm an issue reproduces
on the current version before reporting.
