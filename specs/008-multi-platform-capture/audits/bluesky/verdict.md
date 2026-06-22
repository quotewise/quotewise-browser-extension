# Bluesky DOM Audit Verdict

## Status

- Audit phase: Phase 3
- Promotion decision: do not promote
- Live URL set: original, media/link-card, and multiline text fixtures captured on 2026-06-22
- Raw Probe A artifacts:
  - `raw/probe-a/original-mattsinger-3motounu5ys2w-public-rendered.json`
  - `raw/probe-a/media-link-vulture-3motti7lzfi2q-public-rendered.json`
- Other-features artifacts:
  - `raw/other-features/original-mattsinger-3motounu5ys2w-public-rendered.json`
  - `raw/other-features/media-link-vulture-3motti7lzfi2q-public-rendered.json`
- Contract-discovery artifacts:
  - `raw/contract-discovery/original-mattsinger-3motounu5ys2w-public-rendered.json`
  - `raw/contract-discovery/media-link-vulture-3motti7lzfi2q-public-rendered.json`
- Text-structure artifacts:
  - `raw/text-structure/original-mattsinger-3motounu5ys2w-public-rendered.json`
  - `raw/text-structure/media-link-vulture-3motti7lzfi2q-public-rendered.json`
  - `raw/text-structure/original-dearlstephens-3motjjgwmz22f-public-rendered.json`
- Raw Probe B artifacts: pending in `raw/probe-b/`

## Contract Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Permalink extraction returns `platform`, `platformCode`, `sourceUrl`, and `sourceId` | Candidate pass in Bluesky-specific discovery | Contract discovery returned `bluesky`, `BS`, browser permalink URL, source ID `3motounu5ys2w`, and handle `mattsinger.bsky.social`; generic Probe A used root canonical and hidden feed content |
| `bsky.app/profile/{handle}/post/{rkey}` is reliable | Candidate pass for original permalink | Browser URL identity matched the visible focal post for `mattsinger.bsky.social` / `3motounu5ys2w` |
| Focal post selection in threads excludes parent and embedded posts | Partial candidate | Original fixture exposed hidden feed posts, proving global `postText` selection is unsafe; media/link-card fixture captured the focal post text separately from link-card title/body text; live reply/thread fixture still pending |
| Handle trust from the URL is valid for preflight | Pending | No live preflight result committed yet |
| Likes/date visibility is reliable or omitted | Partial candidate | Likes parsed as `37` and `2` inside visible focal roots; date is visible only as human text / link aria-label, with no `time[datetime]`, so `postedAt` remains omitted |
| Duplicate/preflight and submit succeed on live pages | Pending | No live submit result committed yet |
| Deterministic fixture tests match the audited selector contract | Pending update | Existing local tests assume exact `postThreadItem`, `postAuthorDisplayName`, and focal `postText` hooks; this live fixture uses `postThreadItem-by-{handle}` and hidden feed `postText` hooks |
| Chrome Web Store host permission rationale matches enabled hosts | Pending | Host permission exists, but runtime flag remains disabled |
| Visible body newlines are preserved | Candidate pass | `dearlstephens.bsky.social` fixture preserved a blank line as two newline characters in the visible `postText` node's `textContent` and `innerText` |

## Notes

Bluesky remains disabled by runtime flag until this verdict passes. Treat handle and rkey extracted from the permalink as the primary identity signals unless live audit contradicts that contract.

## Candidate Bluesky Contract

Current evidence supports this contract for a public-rendered original Bluesky permalink:

| Field | Candidate Source | Current Confidence |
|-------|------------------|--------------------|
| `platform` / `platformCode` | Host match on `bsky.app` plus static code `BS` | High |
| `sourceUrl` | Browser URL, not canonical metadata | High for first original fixture |
| `sourceId` | `/profile/{handle}/post/{rkey}` URL rkey | High for first original fixture |
| Author handle | URL path handle | High for first original fixture |
| Display name | Visible profile link with href `/profile/{handle}` and non-avatar aria-label | Medium; one fixture |
| Text | Visible `postText` or body-like non-link/non-button text block inside visible `[data-testid="postThreadItem-by-{handle}"]`, excluding action/date/metric text; preserve raw newlines when present | Medium; multiline fixture validates `\n\n` preservation |
| Posted date | Human timestamp text and hidden permalink aria-label | Supporting only; omit `postedAt` until an ISO/stable timezone source is found |
| Likes | Visible `likeCount-expanded` or `likeBtn` inside the focal root | Medium; two fixtures |
| Attachments | Off-origin link-card anchors and visible media elements inside the focal root | Low; one media/link-card fixture, supporting evidence only |

Metadata is not a candidate primary source for this fixture: canonical and OG metadata can point to `https://bsky.app/`, generic Bluesky copy, or stale prior-post values after SPA navigation. A fresh direct permalink load for the multiline fixture did expose correct OG metadata, including the same two newline characters as the visible `postText`, but runtime extraction should still prefer the visible focal root.

Generic Probe A is useful as negative evidence for global selectors. On this page it selected hidden feed text and a hidden feed like count because `postText` hooks from the home feed remain in the document.

## Scenario Matrix

| Fixture Class | Status | Notes |
|---------------|--------|-------|
| original | Candidate contract found | `mattsinger.bsky.social` fixture validates visible focal root, text, display name, and likes; date remains supporting-only |
| reply/comment | Pending | Need direct URL to validate focal rkey selection in a thread |
| repost/quote/reshare | Pending | Need direct URL |
| media | Candidate contract found | `vulture.com` fixture validates focal body text plus off-origin link-card and visible card image evidence |
| multiline text | Candidate contract found | `dearlstephens.bsky.social` fixture validates blank-line preservation in the visible `postText` node |
| long/collapsed | Pending | Need direct URL |
| unavailable/private/login-gated | Pending | Need direct URL |
| non-English | Pending | Need direct URL |
| low/zero likes | Pending | Need direct URL |
| abbreviated/high likes | Pending | Need direct URL |

2026-06-22 public-rendered original fixture notes:

- `https://bsky.app/profile/mattsinger.bsky.social/post/3motounu5ys2w` rendered as a plain Bluesky skeet by Matt Singer.
- Browser URL identity was `mattsinger.bsky.social` / `3motounu5ys2w`.
- The visible focal-root candidate used `[data-testid="postThreadItem-by-mattsinger.bsky.social"]` and captured the expected body beginning `Happy Father’s Day...`, display name `Matt Singer`, and likes count `37`.
- The page exposed no `article`, `role="article"`, `time[datetime]`, exact `data-testid="postThreadItem"`, or `postAuthorDisplayName` hooks for the visible post.
- Date evidence existed as visible text `6:03 PM · Jun 21, 2026` and a hidden exact-permalink link aria-label `June 21, 2026 at 6:03 PM`; neither is promoted to `postedAt` yet.
- Generic Probe A selected canonical root `https://bsky.app/`, hidden feed text beginning `Trailer for the upcoming episodes...`, and hidden feed likes `45`, reinforcing that global `postText` and root-canonical selectors are unsafe for Bluesky.

2026-06-22 public-rendered media/link-card fixture notes:

- `https://bsky.app/profile/vulture.com/post/3motti7lzfi2q` rendered as a Bluesky post by Vulture with an external link card.
- Browser URL identity was `vulture.com` / `3motti7lzfi2q`.
- The visible focal-root candidate used `[data-testid="postThreadItem-by-vulture.com"]` and captured body text beginning `“Toronto” mostly takes place on a soundstage...`, display name `Vulture`, and likes count `2`.
- Date evidence existed as visible text `7:25 PM · Jun 21, 2026`; no ISO timestamp source was found, so `postedAt` remains omitted.
- Attachment evidence found one off-origin link-card href, `https://www.vulture.com/article/the-vampire-lestat-recap-episode-3-toronto-amc.html`, plus one visible image in the focal root.
- The link-card text includes title/body/domain content, so adapter text extraction must keep focal post text distinct from attachment card text.
- Text-structure probe showed the visible skeet body has no newline; the newline in `og:description` is metadata-only because Bluesky appends the external URL after the visible text.

2026-06-22 public-rendered multiline text fixture notes:

- `https://bsky.app/profile/dearlstephens.bsky.social/post/3motjjgwmz22f` rendered as a Bluesky post by D. Earl Stephens / `@dearlstephens.bsky.social`.
- Browser URL identity was `dearlstephens.bsky.social` / `3motjjgwmz22f`.
- The visible focal text container used `[data-testid="postText"]` and contained the body:

  ```text
  🖊️That’s a picture of my stepdad reading my book shortly before his death. He was a prodigious reader, and as his health was failing told me, “I’m not ready to die, Earl, there are so many books I haven’t read yet!

  Happy Father’s Day, good man. You were one for the books.
  ```

- The text container had no `<br>` elements and no child paragraph elements; both `textContent` and `innerText` preserved the blank line as two newline characters.
- A direct fresh permalink load exposed matching canonical/OG metadata and `og:description` also contained two newline characters.
- The active SPA tab initially retained stale canonical/OG metadata from the prior Vulture post while the visible post and URL were correct; this is negative evidence against relying on page metadata after in-app navigation.
