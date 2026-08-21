# EIGA Decisions

## ADR-001 — Web first

Status: accepted

Reason: zero-install access, sharing, discoverability, and natural fit for visual demos.

## ADR-002 — Local Letterboxd import

Status: accepted

Reason: privacy and zero backend cost.

## ADR-003 — No Letterboxd scraping

Status: accepted

Reason: brittle, unnecessary, and not aligned with a user-controlled import workflow.

## ADR-004 — D3 first

Status: accepted

Reason: custom interaction and precise visual control.

## ADR-005 — No AI in core product

Status: accepted

Reason: deterministic, free to operate, privacy-friendly, and unnecessary for the core value.

## ADR-006 — No backend/database in V1

Status: accepted

Reason: prove the visualization before adding operational complexity.

## ADR-007 — Cinematic observatory visual language

Status: accepted

The Japanese name does not imply Japanese visual decoration.

## ADR-008 — EIGA is provisional

Status: provisional

映画 (えいが / eiga) is the standard Japanese word for film/movie. Before public launch, verify searchability, domains, repositories, package names, and trademark conflicts.

## ADR-009 — Films may join films, when the relation is linear

Status: accepted

`CLAUDE.md` said films connect to attribute hubs and "never to each other". That was
never quite the rule, and by the time the diary thread shipped it was plainly false:
`src/graph/thread.ts` joins films directly in watch order.

The real constraint is **quadratic growth**. Ten films by one director must not become
forty-five film-to-film edges — that is what turns a library into the unreadable
spiderweb the graph principles forbid. A chain over n films is n−1 edges, and so is a
tree. Both are the sparsest connected graph that exists, and neither can degenerate.

So the rule is restated: a film may be joined to another film only by a relation whose
edge count is **linear in the number of films**. Attribute membership is not such a
relation and stays routed through hubs. Axes remain mutually exclusive — the failure
mode being avoided is a film belonging to two groupings at once, which reintroduces
cliques regardless of topology.

### What this permits: the discovery tree (`discovery`)

Each film hangs from the film nearest it in release year that had already been seen.
Formally, over films with a readable watch date and a release year, in watch order:

- root = the earliest-watched film
- `parent(f)` = argmin over already-watched `p` of
  `|year(f) − year(p)| + 0.5 × |rating(f) − rating(p)|`
- ties → the most recently watched candidate
- the rating term contributes 0 if either film is unrated

One sentence to read: every time you reach into a new part of film history a limb
splits off, and everything you later watch from near that era grows along it.

Drawn on the same graticule grammar as the timeline, re-labelled: x is the day you
watched it, one row per **release decade**.

### The rule was measured, not guessed

Run against the demo library and against synthetic libraries. `O(n²)`, 4ms at 2000
films, so the cost is not a factor.

| library | depth | avg | max children | branch points |
| --- | --- | --- | --- | --- |
| demo, 33 dated films | 10 | 4.5 | 4 | 8 |
| synthetic 500, 2010–2024 (worst case for ties) | 15 | 7.6 | 6 | 85 |
| synthetic 500, 1930–2024 | 13 | 5.9 | 8 | 122 |
| synthetic 2000, 1930–2024 | 37 | 15.5 | 6 | 69 |
| *baseline: the diary chain* | *32* | *16.0* | *1* | *0* |

Three findings shaped the final rule:

1. **It cannot degenerate into a star.** `maxChildren` never exceeded 8 in any
   configuration tested.
2. **The rating term is load-bearing.** Release year alone collapses on a library
   bought from one era — every candidate scores zero, the tie-break takes the previous
   film every time, and the tree becomes the diary chain it was built to improve on.
   Measured at depth 299 on an all-one-year library, against 15 with the term.
3. **A watch-recency term was rejected on the measurement.** Biasing toward the most
   recent film is chain-forming by construction and made depth *worse* at every size
   tested (dense-modern 15 → 31, broad 13 → 21, 2000 films 37 → 62).

Also measured: 94% of branches stay within one decade band of their parent. That is
what makes lane allocation and `d3-hierarchy` unnecessary — the tree draws straight
onto the fixed graticule, and the feature adds **zero dependencies**.

### The design that was rejected

An attribute-nesting tree — `library → 1990s → 5★ → film`, films as degree-1 leaves.
It is a tree, and it is a hub map with an extra level: every leaf is a dead end, so
nothing about a film is legible except the two attributes on the path down to it, and
no two films are ever related. The chronological tree relates films to each other,
which is the thing a hub map structurally cannot do.

### Known limits

- The rule leans on release year, which is thin material — but it is the one field
  every Letterboxd export has, and the measurements show it holds up.
- A history spanning more than about twenty years hits `TREE_MAX_SPAN` and gets dense
  along x. Same trade `YEAR_WIDTH` documents from the other side.
- A library reaching across many decades of cinema draws a tall map, which
  `fitToFrame` may open below `LABEL_FLOOR` — so it opens without titles until the
  user zooms. The same limit the timeline has for long histories.
