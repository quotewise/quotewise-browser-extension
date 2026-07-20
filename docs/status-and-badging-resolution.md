# Status & badging resolution

How a duplicate-check response becomes a toolbar icon, a tray badge, and a Submit
button state. Four independent decision chains, all fed by the same
`DuplicateCheckResult`.

**Source of truth** — this doc mirrors code, it does not govern it:

| chain | code |
|---|---|
| shared selectors | `src/utils/duplicate-status.ts` |
| toolbar icon | `src/background/icon-state-resolver.ts` + `src/config/icon-states.ts` |
| tray badge | `src/content/ui/components/duplicate-badge.ts` |
| Submit gate | `src/content/ui/overlay-bar.ts` (`submitQuote`) |

Related: [ADR-0001](./server-launch-adrs/ADR-0001-duplicate-check-match-provenance.md)
(match provenance), [ADR-0009](./server-launch-adrs/ADR-0009-duplicate-check-vector-sweep-and-primary-match.md)
(vector sweep, mixed match list, server-selected primary).

---

## 0. The match list — read this first

Since ADR-0009 the backend runs a pgvector sweep, so `matches` is **one
distance-sorted list mixing same-originator and cross-originator hits**. It used
to be homogeneous. Every selector below exists because of that change, and
getting the scope wrong is the single most common bug in this area.

```mermaid
flowchart TD
    R[("DuplicateCheckResult.matches<br/>mixed, distance-sorted")]

    R --> P["primaryMatch()<br/>find(m =&gt; m.primary) ?? matches[0]"]
    R --> S["sameOriginatorMatches()<br/>drop different_originator === true<br/>or match_class === 'conflict'"]
    R --> B["blockingExactConflict()<br/>any match_type ===<br/>'exact_different_originator'"]
    R --> C["secondaryConflicts()<br/>cross-originator, minus primary"]

    P --> P1["headline state:<br/>classifyMatchResolution,<br/>similar-diff, conflict badge"]
    S --> S1["'is THIS capture already recorded?'<br/>classifyDuplicateSighting,<br/>getMatchForDuplicateSightingState,<br/>mapRecommendationToQuoteStatus"]
    B --> B1["hard block on Submit"]
    C --> C1["similar-quotes panel"]

    classDef danger fill:#fde2e2,stroke:#c0392b,color:#7b241c
    class B,B1 danger
```

**The rules, stated plainly:**

- **Never index `matches[0]`.** The server sorts the primary first for
  back-compat, but position is not the contract. Use `primaryMatch()`.
- **Never ask an unscoped `.some()` about this capture.** "Is it already
  collected / already sighted here?" must run over `sameOriginatorMatches()`.
  Another originator's quote answers a different question.
- **Never do similarity math.** Thresholds and precedence are server-owned. The
  only strength signal the client reads is `match_type ===
  'exact_different_originator'`, which the backend claims solely on proven byte
  equality — a fact, not a threshold.
- `match_class: 'conflict'` means *matched a different originator*, per ADR-0001.
  It is not a strength signal, and it is deliberately **not** orthogonalized.
- **`relations` decides; the other relation fields only decorate.**

  | field | trust | use for |
  |---|---|---|
  | `relations` | **authoritative** — read from the graph, no drift. Scope is edges *between returned matches*; `[]` means "not linked to anything else here", never "unlinked" | grouping, gating a link action |
  | `canonical_quote_id` present | reliable (real FK) — absence proves nothing | grouping (additive only) |
  | `has_relations: true` | reliable | decoration |
  | `has_relations: false` | **not** proof of "no relations" (948 rows lie) | nothing |
  | `quote_role: 'variant'` | **not** proof of an edge (1,780 rows lie) | nothing |

  Never conclude "unlinked, therefore safe to link" from the bottom three.

---

## 1. Toolbar icon — `resolveIconPresentation()`

Strictly ordered; first match wins. Auth and private mode outrank everything,
including an in-flight check.

```mermaid
flowchart TD
    Start([resolveIconPresentation]) --> QS["quoteStatus =<br/>mapRecommendationToQuoteStatus(dup)"]

    QS --> A1{"auth === SESSION_EXPIRED?"}
    A1 -->|yes| ESE["ErrorSessionExpired<br/>! orange"]
    A1 -->|no| A2{"auth === INSUFFICIENT_PRIVILEGES?"}
    A2 -->|yes| EIP["ErrorInsufficientPrivileges<br/>! orange"]
    A2 -->|no| A3{"auth === UNAUTHENTICATED?"}
    A3 -->|yes| LO["LoggedOut<br/>grey, no badge"]
    A3 -->|no| PM{privateMode?}
    PM -->|yes| PAUSED["Paused<br/>⏸︎ grey"]

    PM -->|no| LOAD{"supported AND post page<br/>AND check in flight<br/>AND quoteStatus === 'None'<br/>AND originator not missing?"}
    LOAD -->|yes| LOADING["Loading<br/>● blue · tab-scoped"]

    LOAD -->|no| A4{"auth UNKNOWN / CHECKING /<br/>AUTHENTICATING?"}
    A4 -->|yes| AP["AuthPending<br/>colour, no badge"]
    A4 -->|no| SUP{supported platform?}
    SUP -->|no| UP["UnsupportedPage<br/>grey"]
    SUP -->|yes| PP{post page?}
    PP -->|no| SI["SupportedIdle<br/>colour, no badge"]

    PP -->|yes| HASDUP{"dup result present?"}
    HASDUP -->|yes| CF{"quoteStatus === 'Conflict'?"}
    CF -->|yes| CFR["Conflict<br/>⚠ orange"]
    CF -->|no| BEC{"blockingExactConflict?"}
    BEC -->|yes| BECR["ExactAlsoElsewhere<br/>= amber"]
    BEC -->|no| PC["passageCountForUrl(dup)"]
    PC --> PCU{"=== 'unknown'?"}
    PCU -->|yes| HC["HasCaptures<br/>= green"]
    PCU -->|no| PC2{">= 2?"}
    PC2 -->|yes| COUNT["Count<br/>n or 9+ green"]

    PC2 -->|no| QS2{"quoteStatus not None/New?"}
    HASDUP -->|no| QS2
    QS2 -->|yes| MAP["InCollection ✓<br/>Exact = · Similar ~"]
    QS2 -->|no| SEC{"secondaryConflicts non-empty<br/>OR classifyMatchResolution<br/>=== 'similar'?"}
    SEC -->|yes| SECR["SimilarElsewhere ~ amber<br/>(Similar ~ if the originator<br/>is known)"]
    SEC -->|no| MO{"originator missing?"}
    MO -->|yes| MISS["MissingOriginator<br/>@ amber"]
    MO -->|no| ISNEW{"quoteStatus === 'New'?"}
    ISNEW -->|yes| NEW["New<br/>★ blue"]
    ISNEW -->|no| READY["Ready<br/>colour, no badge"]

    classDef auth fill:#fdebd0,stroke:#b9770e,color:#7e5109
    classDef good fill:#d5f5e3,stroke:#1e8449,color:#145a32
    classDef danger fill:#fde2e2,stroke:#c0392b,color:#7b241c
    class ESE,EIP,LO,PAUSED,AP auth
    class HC,COUNT,MAP,NEW good
    class CFR,BECR danger
```

**Attribution outranks everything on the page**, passage counts and collection
membership included. Whether the capture can proceed at all beats context about
what else lives on this post.

Glyph says what kind of match; colour says whose it is:

| | same originator | cross-originator |
|---|---|---|
| exact text | `=` **green** — `Exact` | `=` **amber** — `ExactAlsoElsewhere`, blocks Submit |
| similar text | `~` amber — `Similar` | `~` amber — `SimilarElsewhere`, advisory |

Two deliberate choices there:

- **`Conflict` (⚠) is kept for the case where the other originator's quote *is*
  the match.** `ExactAlsoElsewhere` is the narrower situation — you legitimately
  have the quote *and* so does someone else — so it keeps the same-text glyph and
  changes only the colour. Splitting them means the strongest signal is not
  weakened and each glyph keeps one meaning.
- **`Similar` and `SimilarElsewhere` are visually identical** (`~` amber) and
  differ only in title. Neither blocks anything and both mean "open the tray"; a
  fifth colour would encode a distinction nobody acts on.

**Passage count outranks the remaining quote statuses.** A post with 2+ captured
passages shows the count, not `★`/`~`/`=` — once attribution is settled, "what's
on this post" beats "what is this quote".

> **The badge is URL-scoped until the tray opens — by design, do not "fix" it.**
> The automatic preflight sends `{ handle, platform, source_url }` and deliberately
> **no post text** (`service-worker.ts:2705`; `api-handler.ts:403` falls back to
> probing with the URL). Text travels only once the user opens the tray, which is
> the first sign of intent to interact with Quotewise — sending it on view would
> collect data from people who never asked for anything, and would not survive
> capture expanding beyond post pages.
>
> Consequence: at rest the badge can say "this post already has captures" and
> "this handle is not an originator", but never "this text is already in
> Quotewise". A badge that changes when the tray opens is expected here, not a
> bug. See ADR-0009's 2026-07-19 amendment.

> **`recommendation` and `match_class` can disagree — trust the matches.**
> With no originator the server cannot recommend a *version* (there is nobody to
> version it under), so it answers `new_quote` while the matches still carry
> `match_class: 'similar'`. `mapRecommendationToQuoteStatus` reads only
> `recommendation`; `classifyMatchResolution` reads `match_class`. An icon that
> consults just the first contradicts the tray on the very same response — an
> Asimov quote posted by an unknown handle badged `@` while the tray offered
> "Add as variant". The resolver falls back to `classifyMatchResolution` before
> `MissingOriginator` for exactly this reason.

**`passageCountForUrl()` is three-valued, and the distinction is load-bearing:**

| return | means | caller may claim |
|---|---|---|
| `number` | counted | exact count |
| `'unknown'` | captures exist, count unavailable (≥50, malformed total) | "this post has captures" |
| `null` | **no information** — absent result, or `search_metadata.error` | nothing, in either direction |

The last two shared the `'unknown'` sentinel until v1.7.0, so a check that never
completed rendered as positive evidence: a green `=` on the toolbar, and a "This
post already has captures" line sitting under the tray's own "Couldn't verify
duplicates" warning. `null` is deliberately not `0` — `0` is a claim ("no
captures") that a failed check hasn't earned either, and the nullable type makes
the compiler demand every caller handle it.

### Quote status mapping

`mapRecommendationToQuoteStatus()` — collection membership is checked *before*
the recommendation tiers, and only over same-originator matches.

| condition | status | badge |
|---|---|---|
| no result, or `search_metadata.error` | `None` | — |
| any **same-originator** match in a user collection | `InCollection` | ✓ green |
| `attribution_conflict` / `_resolved` | `Conflict` | ⚠ orange |
| `duplicate` / `duplicate_known_author` | `Exact` | `=` green |
| `new_version` / `new_version_known_author` | `Similar` | `~` amber |
| `new_quote` / `new_quote_known_author`, or unknown | `New` | ★ blue |

---

## 2. Tray badge — `DuplicateBadge.update()`

Driven by `classifyMatchResolution()`, which reads the **primary** match only.

```mermaid
flowchart TD
    U([update state]) --> N{state null?}
    N -->|yes| CLEAR([render nothing])
    N -->|no| CHK{checking?}
    CHK -->|yes| SPIN["spinner<br/>'Checking Quotewise…'"]

    CHK -->|no| RES["resolution =<br/>classifyMatchResolution(result, capturedText)"]

    RES --> CV{couldnt_verify?}
    CV -->|yes| CVR["⚠ Couldn't verify + Retry<br/>Submit: disabled"]

    CV -->|no| EX{exact?}
    EX -->|yes| EXR["✓ Already captured this passage/quote<br/>Submit: View Quote"]

    EX -->|no| CO{conflict?}
    CO -->|yes| COR["⚠ Already attributed to X<br/>+ Resolve link<br/>Submit: disabled"]

    CO -->|no| SIM{similar?}
    SIM -->|yes| BLK{blockingExactConflict?}
    BLK -->|yes| BLKR["word diff, NO decision buttons<br/>Submit: 'Resolve Attribution'"]
    BLK -->|no| SIMR["word diff + Add sighting /<br/>Add as variant<br/>Submit: 'Choose Action'"]

    SIM -->|no| URL{"existing_sightings_for_url<br/>non-empty?"}
    URL -->|yes| URLR["ℹ️ post already has a captured quote<br/>Submit: 'Capture another passage'"]
    URL -->|no| LEG["renderLegacyStatus()"]

    CVR & EXR & COR & BLKR & SIMR & URLR & LEG --> PANEL["+ passages panel<br/>if passageCountForUrl != 0"]

    classDef danger fill:#fde2e2,stroke:#c0392b,color:#7b241c
    class COR,BLKR danger
```

### `classifyMatchResolution()` precedence

```mermaid
flowchart LR
    A{"search_metadata.error"} -->|true| CV([couldnt_verify])
    A -->|false| B{"matchedSightingForText<br/>(URL passage text matches)"}
    B -->|hit| EX([exact])
    B -->|miss| C{"primary.match_class"}
    C -->|conflict| CF([conflict])
    C -->|similar| SI([similar])
    C -->|"null AND recommendation<br/>is new_version*"| SI
    C -->|otherwise| NO([none])
```

### `renderLegacyStatus()` fallback

Reached when resolution is `none` and the URL has no recorded passages. Uses
`classifyDuplicateSighting()` — **same-originator matches only**.

| sighting state / recommendation | badge | Submit |
|---|---|---|
| `exact_sighting` | ✓ Already captured this passage/quote | View Quote |
| `same_platform_sighting` | 🟢 Earlier Sighting saved | View Sighting |
| `other_platform_sighting` | 🔵 Add sighting | Add Sighting |
| `recommendation: duplicate` | ⚠ Duplicate | View Quote |
| `recommendation: new_version` | ℹ️ New version | View Quote |
| `in_quotewise` | ✓ In Quotewise | View Quote |
| `recommendation: new_quote` | *(none)* | enabled |

---

## 3. Similar-quotes panel — `SimilarPanel.update()`

Sits between the quote row and the collection rows. Certainty is carried by the
disclosure state, not by hedged wording.

```mermaid
flowchart TD
    A([update result]) --> B["conflicts = secondaryConflicts(result)"]
    B --> C{"empty?"}
    C -->|yes| H([hidden])
    C -->|no| GR["groupRelatedMatches()<br/>connected components over<br/>relations ∪ canonical_quote_id<br/>leader = canonical, else closest"]
    GR --> D{"any match_type ===<br/>'exact_different_originator'?"}
    D -->|yes| E["⛔ expanded, warning tone<br/>'This exact quote is already<br/>attributed to X'<br/>blocking match's group leads"]
    D -->|no| F["ℹ️ collapsed &lt;details&gt;, info tone<br/>'Might be a duplicate of N quotes<br/>by other originators'<br/>N counts GROUPS, not matches"]
    E & F --> G["max 5 rows + '+N more'<br/>row = snippet link — originator<br/>· +N known variants<br/>NO similarity percentages"]

    classDef danger fill:#fde2e2,stroke:#c0392b,color:#7b241c
    class E danger
```

Grouping uses `relations` (authoritative) unioned with `canonical_quote_id`
(additive hint). `has_relations` and `quote_role` are never consulted. Components
are transitive: A–B and B–C land in one group with no direct A–C edge.

## 3a. No originator resolved

A check may run with `originator_slug` omitted — supported since ADR-0009, ~10ms
warm. With nothing claimed there is nothing to conflict *with*, so the server
classifies on strength alone:

| field | value |
|---|---|
| `different_originator` | always `false` |
| `match_class` | `exact` or `similar` — **never** `conflict` |
| `match.originator` | the matched quote's *real* attribution — read it from here |
| `search_metadata.lexical_search_skipped_unscoped` | `true` |

Consequences, all of which fall out of the selectors rather than needing special
cases: `sameOriginatorMatches()` keeps everything, `blockingExactConflict()`
never fires, and the similar panel stays hidden — correctly, since "other
originators" is not a meaningful category without a target originator.

Two things this path must respect:

- **Submit can never be enabled.** The badge reasons about the quote, not the
  attribution, so it will ask for an enabled Submit. `submitQuote` would return
  in silence at its `!originator` guard, so the directive is vetoed in
  `onSubmitStateChange` and the button reads "Add originator first".
  `view_quote` directives pass through — the quote exists, reading it is useful.
- **No link decisions either.** "Add another sighting" / "Add as variant" route
  straight to `submitQuote` and hit the same silent guard, so the badge is told
  via `update(..., { hasOriginator })` to withhold them. The word diff still
  renders — comparing the two texts is the useful part regardless.
- **Collections still work.** Adding an *existing* quote to a collection routes
  through `addExistingQuoteToSelectedCollections()`, which needs no originator.
  That path is deliberately not vetoed.

An empty result here is advisory, never proof the quote is new — the lexical pass
that catches punctuation-only variants does not run. Re-check once an originator
is chosen.

Post-submit (`showPostSubmit`, ADR-0009 §5) reuses the panel in advisory tone —
the quote was created regardless — and **suppresses the 1000ms auto-hide** so the
heads-up can actually be read.

---

## 4. Submit gate — `submitQuote()`

Ordered; first match wins and returns without submitting. This is enforcement,
not decoration — the badge sets button state, this re-checks at click time.

```mermaid
flowchart TD
    S([submitQuote]) --> G1{already submitting?}
    G1 -->|yes| X1([return, silent])
    G1 -->|no| G2{"currentData AND originator?"}
    G2 -->|no| X2([return, silent])
    G2 -->|yes| G3{originator has slug?}
    G3 -->|no| X3["error: couldn't resolve ID<br/>Submit: Retry"]
    G3 -->|yes| G4{resolution couldnt_verify?}
    G4 -->|yes| X4["Submit: Couldn't Verify"]
    G4 -->|no| G5{resolution conflict?}
    G5 -->|yes| X5["Submit: Resolve Attribution"]
    G5 -->|no| G6{blockingExactConflict?}
    G6 -->|yes| X6["Submit: Resolve Attribution<br/>(warning style)"]
    G6 -->|no| G7{exact_sighting?}
    G7 -->|yes| X7["Submit: Already Captured"]
    G7 -->|no| G8{same_platform_sighting?}
    G8 -->|yes| X8["Submit: Earlier Saved"]
    G8 -->|no| G9{"article needing a selection?"}
    G9 -->|yes| X9([Submit: disabled])
    G9 -->|no| GO(["POST /v1/quotes/"])

    classDef danger fill:#fde2e2,stroke:#c0392b,color:#7b241c
    classDef ok fill:#d5f5e3,stroke:#1e8449,color:#145a32
    class X1,X2 danger
    class GO ok
```

> **Trap.** Gates 1 and 2 return with **no user-visible feedback**, and gates 4–8
> report by relabelling the Submit button. When the user acted somewhere else —
> "Add as variant" inside the similar panel — that feedback lands where they
> aren't looking and the click reads as broken. Any new veto must either surface
> itself where the action was taken, or withhold the affordance up front (which
> is what gate 6 does: the decision buttons are not rendered at all).

---

## Quick reference — badge glyphs

| glyph | state | colour |
|---|---|---|
| *(none)* | Ready / SupportedIdle / AuthPending | — |
| `●` | Loading (check in flight) | `#56B4E9` |
| `★` | New | `#0072B2` |
| `~` | Similar / SimilarElsewhere | `#E69F00` |
| `=` | Exact / HasCaptures | `#009E73` |
| `=` | ExactAlsoElsewhere | `#E69F00` |
| `2`…`9+` | Count (passages on this post) | `#009E73` |
| `✓` | InCollection | `#009E73` |
| `⚠` | Conflict | `#D55E00` |
| `@` | MissingOriginator | `#E69F00` |
| `!` | Session expired / insufficient privileges | `#D55E00` |
| `⏸︎` | Paused (private mode) | `#64748B` |

Icon scope: `global` states apply to every tab; `tab` states are per-tab
(`Loading`, `Count`, and every quote-status state).
