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
- **Relation fields decorate, they never decide.** `quote_role`, `has_relations`
  and `canonical_quote_id` exist so a variant group isn't rendered as several
  independent duplicates. Only the positive direction is trustworthy:

  | field | trust |
  |---|---|
  | `canonical_quote_id` present | reliable (real FK) — absence proves nothing |
  | `has_relations: true` | reliable |
  | `has_relations: false` | **not** proof of "no relations" (948 rows lie) |
  | `quote_role: 'variant'` | **not** proof of an edge (1,780 rows lie) |

  Never conclude "unlinked, therefore safe to link" from these. Gate any write on
  the server's response to the link action itself. Authoritative pairwise edges
  are tracked in `qw-gqae3`.

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
    HASDUP -->|yes| PC["passageCountForUrl(dup)"]
    PC --> PCU{"=== 'unknown'?"}
    PCU -->|yes| HC["HasCaptures<br/>= green"]
    PCU -->|no| PC2{">= 2?"}
    PC2 -->|yes| COUNT["Count<br/>n or 9+ green"]

    PC2 -->|no| QS2{"quoteStatus not None/New?"}
    HASDUP -->|no| QS2
    QS2 -->|yes| MAP["InCollection ✓ · Conflict ⚠<br/>Exact = · Similar ~"]
    QS2 -->|no| MO{originator missing?}
    MO -->|yes| MISS["MissingOriginator<br/>@ amber"]
    MO -->|no| ISNEW{"quoteStatus === 'New'?"}
    ISNEW -->|yes| NEW["New<br/>★ blue"]
    ISNEW -->|no| READY["Ready<br/>colour, no badge"]

    classDef auth fill:#fdebd0,stroke:#b9770e,color:#7e5109
    classDef good fill:#d5f5e3,stroke:#1e8449,color:#145a32
    class ESE,EIP,LO,PAUSED,AP auth
    class HC,COUNT,MAP,NEW good
```

**Passage count outranks quote status.** A post with 2+ captured passages shows
the count, not `★`/`~`/`=` — "what's on this post" beats "what is this quote".

> **Sharp edge (verified, not fixed).** `passageCountForUrl()` returns `'unknown'`
> when `search_metadata.error` is true, and `'unknown'` maps to `HasCaptures`. So
> a *failed* duplicate check on a post page resolves to a green `=` "this post has
> captured passages" — asserting captures exist on the strength of a check that
> didn't complete. The tray gets this right (`couldnt_verify` → ⚠ + Retry); the
> icon does not. Reproduce with
> `resolveIconPresentation(AUTHENTICATED, {search_metadata:{error:true}}, {isPostPage:true, isSupportedPlatform:true, isCheckInFlight:false})`.

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
    EX -->|yes| EXR["✓ Already captured this passage<br/>Submit: View Quote"]

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
| `exact_sighting` | ✓ Already captured this passage | View Quote |
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
    C -->|no| GR["groupByCanonical()<br/>key = canonical_quote_id || quote_id<br/>leader = canonical, else closest"]
    GR --> D{"any match_type ===<br/>'exact_different_originator'?"}
    D -->|yes| E["⛔ expanded, warning tone<br/>'This exact quote is already<br/>attributed to X'<br/>blocking match's group leads"]
    D -->|no| F["ℹ️ collapsed &lt;details&gt;, info tone<br/>'Might be a duplicate of N quotes<br/>by other originators'<br/>N counts GROUPS, not matches"]
    E & F --> G["max 5 rows + '+N more'<br/>row = snippet link — originator<br/>· +N known variants<br/>NO similarity percentages"]

    classDef danger fill:#fde2e2,stroke:#c0392b,color:#7b241c
    class E danger
```

Grouping is display-only. `has_relations` and `quote_role` are never consulted —
only `canonical_quote_id`, and only in the positive direction.

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
| `~` | Similar | `#E69F00` |
| `=` | Exact / HasCaptures | `#009E73` |
| `2`…`9+` | Count (passages on this post) | `#009E73` |
| `✓` | InCollection | `#009E73` |
| `⚠` | Conflict | `#D55E00` |
| `@` | MissingOriginator | `#E69F00` |
| `!` | Session expired / insufficient privileges | `#D55E00` |
| `⏸︎` | Paused (private mode) | `#64748B` |

Icon scope: `global` states apply to every tab; `tab` states are per-tab
(`Loading`, `Count`, and every quote-status state).
