# Chrome Web Store — Privacy Practices (Dashboard answers)

Paste-ready answers for the CWS Developer Dashboard → **Privacy practices** tab. Must stay
consistent with the live policy at https://quotewise.io/privacy/ and with
[`chrome-web-store-permissions.md`](./chrome-web-store-permissions.md).

Relates: ADR-0005, beads `qw-0psq.16` (this tab), `qw-0psq.17` (permission justifications).

> Backend Limited-Use audit complete (2026-06-22): all three certifications confirmed. The
> data flows that must be disclosed first are in "Limited Use basis & required disclosures".
> Do not submit this tab until the privacy policy reflects those flows (tracked separately).

## Single purpose (Dashboard "Single purpose" field)

> Capture a quote from a social-media post the user is viewing and contribute it to
> Quotewise — a public quote database — saved to the user's account with author attribution
> and a link to the source post.

Saving a quote happens only when the user explicitly triggers and confirms a capture. On a supported
X post, an automatic duplicate-status preload sends only `{handle, source_url, platform: "twitter"}`;
the tweet ID is contained in `source_url`. It sends no quote text, display name, engagement counts, or
other post content. Submitted quotes are added to Quotewise's public corpus (immediately for trusted
contributors, otherwise after staff review), not confined to a private per-user library.

## Data the extension collects / transmits

CWS data-type taxonomy. Declare **only** the two rows marked *Yes*; leave the rest *No*.

| Data type | Collected? | What / why |
|---|---|---|
| Authentication information | **Yes** | OAuth access/refresh tokens stored in `chrome.storage.local` to keep the user signed in; sent as a Bearer token to authenticate quote submissions. Cleared on sign-out. |
| Website content | **Yes** | Before toolbar action on a supported X post, the automatic duplicate-status preload sends only the public author `handle`, `source_url` (containing the `tweet_id`), and fixed `platform: "twitter"` value — **no quote text**. On confirmed capture, the quote text, author's display name/handle, source post URL, and public engagement counts are sent to save the quote with attribution. The extension also fetches the signed-in user's collection names/slugs only when the user opens the collection picker or collection settings, so captures can be filed into selected collections. |
| Personally identifiable info | No | The extension does not collect the user's name/email/address. The captured author handle is the **third-party post author** (public), declared under Website content, not the extension user's PII. |
| Personal communications | No | Only the single post the user selects is read; no inbox/DM/mail access. |
| User activity | No | **Do not declare.** CWS "user activity" means behavioral monitoring (clicks, scroll, keystroke, mouse). The extension performs none — capture is a single user-initiated action. |
| Location | No | — |
| Web history | No | The extension reads only the active supported post page on user action; it does not collect browsing history. |
| Health / Financial info | No | — |

## Required certifications (Dashboard checkboxes)

All three are attestable for this extension:

1. **I do not sell or transfer user data to third parties** (outside the approved use cases). ✅
2. **I do not use or transfer user data for purposes unrelated to the item's single purpose.** ✅ — captured data is used only to save the quote to Quotewise with attribution.
3. **I do not use or transfer user data to determine creditworthiness or for lending purposes.** ✅

## Privacy policy URL (Dashboard field)

```
https://quotewise.io/privacy/
```

Public, not behind login; verified live. Includes the dedicated "Quotewise Chrome Extension"
section, OAuth-not-cookies disclosure, retention, and the Chrome Web Store **Limited Use**
statement.

## Limited Use basis & required disclosures

Backend audit (2026-06-22, `file:line` evidence on file) confirms all three certifications:
no sale, no ad/targeting use, no creditworthiness use. OAuth tokens are stored hashed
(SHA-512; plaintext never persisted or logged) and the user's email is never used in the
capture paths. The flows below are **service-provider transfers to provide the single
purpose** — Limited Use permits them, but each must be DISCLOSED in the privacy policy and
reflected in the single-purpose narrative before this tab is submitted:

| Flow | What leaves the app | Status |
|---|---|---|
| **Public corpus** | Quote text, source URL, author handle, platform, likes | Submitted quotes join Quotewise's **public** dataset (public search/API/quote pages) — immediately for trusted/staff contributors, otherwise PENDING → public after staff review. **Not** a private library. ⚠️ Policy must say so. |
| **AWS Bedrock (Titan embeddings)** | Quote text | Async on-commit, computes the semantic-search vector. Disclose AWS as a sub-processor. |
| **AWS Comprehend (fallback)** | Quote text | Only when local language detection falls back. Same sub-processor (AWS). |
| **Human curation** | Quote text (+ originator/URL) | Below-threshold submissions are read by Quotewise staff/curators in a moderation queue. Submitter PII is not part of the review. |
| **PostHog analytics (EU)** | Event metadata + internal numeric user id | No content, URL, handle, token, or email; the submission POST emits no event. Disclose the processor for completeness. |
| **Collection filing** | Collection names/slugs; selected collection slug(s) | Collection list is fetched on explicit picker/settings open, cached in `chrome.storage.local` for a short rebuildable window, and selected/last-used collection slugs are stored in synced settings so future captures can be pre-selected. Cleared on logout, private mode, and "Clear my data." |

No selling, ad networks, or ad targeting exist in any capture path (confirmed by absence).

**External dashboard sync required:** the Chrome Web Store privacy-practices form is external to this
repository. Its store-listing maintainer must add the automatic-preflight bound above before submission.

**Blocking action:** the live policy at `quotewise.io/privacy/` currently says quotes are
saved "to your account / your Quotewise library," which under-discloses public publication,
human curation, and the AWS sub-processor flows. Update the extension section of the policy
(main repo, `templates/quotewise/privacy.html`) before submitting this tab.
