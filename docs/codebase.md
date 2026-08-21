# Codebase

`docs/architecture.md` is the brief written before the code existed and still names types
that were never built. This file describes what is actually here: where each thing lives,
which seams are load-bearing, and which invariants are easy to break without a test
noticing.

Read [`CLAUDE.md`](../CLAUDE.md) first for the product and design constraints. This is the
mechanical companion to it.

## The layering

```text
raw import  →  normalized domain model  →  graph/derived data  →  visualization  →  UI state
src/import     src/domain                  src/graph             src/viz          src/components
```

One direction only. `src/domain` does not know a graph exists; `src/graph` does not know a
screen exists; `src/viz` computes coordinates without touching React. The whole pipeline
below `src/components` is pure and deterministic, which is why 136 tests can cover it with
no browser and no test framework.

The practical consequence: **if you find yourself importing from `src/components` into
anything else, the design is wrong.** State belongs at the top, and only at the top.

## Module map

### `src/app` — the shell

| file          | lines | owns                                                            |
| ------------- | ----- | --------------------------------------------------------------- |
| `layout.tsx`  | 18    | The document. Nothing but html/body and the stylesheet import.  |
| `page.tsx`    | 5     | Renders `<Atlas />`. That is the entire route.                  |
| `globals.css` | 496   | Design tokens in an `@theme` block, plus every graph-level style. |

`globals.css` is larger than it looks like it should be because the SVG is styled in CSS
rather than by attribute. That is deliberate — see invariant 3.

### `src/domain` — the normalized model

| file           | lines | owns                                                                     |
| -------------- | ----- | ------------------------------------------------------------------------ |
| `types.ts`     | 190   | `Library`, `Film`, `Watch`, `FilmId`, `emptyLibrary()`. The vocabulary.  |
| `demo.ts`      | 230   | The authored 37-film demo library. The only source of director credits.  |
| `stats.ts`     | 199   | `observe()` — the one sentence the inspector says about a library.       |
| `filters.ts`   | 152   | `filtersFor()`, `narrow()`. Highlight sets, resolved against a library.  |
| `calendar.ts`  | 90    | Day/month/year arithmetic for the timeline. No `Date` mutation anywhere. |
| `search.ts`    | 56    | Folded substring match over titles.                                      |

`types.ts` is the boundary that keeps a Letterboxd row from leaking into the app. A `Film`
is not a CSV row with better names — it is a normalized entity with an id, and the raw row
is discarded at the import edge.

### `src/graph` — derived structure

| file       | lines | owns                                                                          |
| ---------- | ----- | ----------------------------------------------------------------------------- |
| `axes.ts`  | 134   | The axis registry: label, availability predicate, and grouping strategy.      |
| `build.ts` | 469   | `buildGraph()` — bipartite hub maps. Also the `Graph` type itself, and `byDecade`. |
| `thread.ts`| 197   | `buildThread()` — the calendar timeline. Same `Graph` type, different shape.   |

`axes.ts` is where a new view is registered, and where an unusable one is withheld. Each
axis carries `available(library)`, and [`axesFor`](../src/graph/axes.ts#L121) filters the
list before the UI ever sees it. `decade` is `available: () => true`
([axes.ts:92](../src/graph/axes.ts#L92)) — the floor that guarantees the returned array is
never empty, so no caller needs an empty case.

### `src/import` — the untrusted edge

| file            | lines | owns                                                                      |
| --------------- | ----- | ------------------------------------------------------------------------- |
| `letterboxd.ts` | 621   | CSV reading, validation, normalization, and the diagnostics they produce. |
| `zip.ts`        | 338   | ZIP reading via `DecompressionStream`, with a decompression budget.       |

Everything arriving here is hostile until validated: malformed dates, absent columns,
duplicated rows, ratings outside range, and a `.zip` that claims to decompress to more than
it should. `zip.ts` supports stored and deflated entries and **throws on any other
compression method** rather than guessing.

`profile.csv` is never read. `letterboxd.test.ts` asserts that its contents — email, legal
name, location, bio — cannot reach a serialized library.

### `src/viz` — coordinates and pixels

| file             | lines | owns                                                                       |
| ---------------- | ----- | -------------------------------------------------------------------------- |
| `layout.ts`      | 734   | Force layout, timeline placement, `fitToFrame`. Pure: graph in, points out. |
| `labels.ts`      | 240   | Collision-based label thinning. Decides *which* labels, not how they look. |
| `exportImage.ts` | 186   | SVG → canvas → PNG blob, composed in-browser.                              |

`layout.ts` is the largest file in the project and the most tested (713 test lines). It
runs headless, which is the only reason layout can be verified at all.

### `src/components` — the UI

| file                | lines | owns                                                                  |
| ------------------- | ----- | --------------------------------------------------------------------- |
| `Atlas.tsx`         | 403   | **All state.** Library, axis, focus, query, highlights, save status.  |
| `GraphView.tsx`     | 824   | The SVG, the force simulation, zoom/pan, and every direct DOM write.  |
| `Landing.tsx`       | 121   | The front door: wordmark, import, demo link.                          |
| `Inspector.tsx`     | 151   | The museum label for the focused node.                                |
| `ImportControl.tsx` | 136   | The import button and the post-import report.                         |
| `AxisControl.tsx`   | 87    | Axis buttons. Renders whatever `axesFor` returned.                     |
| `FilterControl.tsx` | 65    | Highlight chips.                                                       |
| `SearchControl.tsx` | 59    | The query field and its match count.                                  |

All are `"use client"`. `Atlas.tsx` holds every `useState` in the application; every other
component takes props and calls callbacks. This is not a stylistic preference — see
invariant 1.

## The two seams that matter

### `Graph.shape` — one type, several topologies

[`build.ts:115`](../src/graph/build.ts#L115) declares `shape: "hubs" | "thread"`. Both
`buildGraph` and `buildThread` return the same `Graph`, with the same node ids, so
everything downstream — layout, labels, inspector, export, focus, search — is
shape-agnostic. `Atlas` branches on it exactly once:

```ts
const graph = useMemo(
  () => (active.kind === "thread" ? buildThread(library) : buildGraph(library, active.strategy)),
  [library, active],
);
```

Because film node ids are stable across shapes, switching axes animates a film from its
place on the calendar to its decade cluster instead of destroying and recreating it. **A new
topology costs one builder, one `shape` value, and one layout branch** — nothing else needs
to know. If a change requires touching the inspector or the exporter, the seam is being
bypassed.

### The React/D3 boundary

React owns *what* is on screen. D3 owns *where* it is. They never both write the same
attribute.

React renders the nodes and edges as JSX. D3 then writes, imperatively:

| written by JS                        | where                                                                 |
| ------------------------------------ | --------------------------------------------------------------------- |
| `--zoom` on the `<svg>`              | [GraphView.tsx:322](../src/components/GraphView.tsx#L322)             |
| `transform` on the viewport `<g>`    | [GraphView.tsx:352](../src/components/GraphView.tsx#L352)             |
| `transform` on nodes and rows        | [GraphView.tsx:418](../src/components/GraphView.tsx#L418), [:452](../src/components/GraphView.tsx#L452) |
| `data-named` on labelled nodes       | `applyNames()`                                                        |

**None of these may appear in JSX.** See invariant 1 for what breaks.

## Invariants

These are the things that have broken, or would break silently. Each is cheap to violate
and expensive to notice.

### 1. React must never write `transform`, `data-named`, or `--zoom`

The zoom behaviour is bound once, on mount, and its handler closes over the *first* render's
scope. `applyNames()` therefore reads only refs — never props or state — because otherwise
it would hold the first render's data forever while the map kept changing beneath it.

Adding any of these attributes to JSX makes React reassert its own value on the next render,
fighting the imperative write. The failure mode is not a crash: it is nodes that snap back to
a stale position on unrelated state changes, which reads as a physics bug and is not one.

### 2. `lit` is keyed by film id, not node id

[`narrow()`](../src/domain/filters.ts#L131) returns `ReadonlySet<FilmId> | null`. Film *node*
ids are `` `film:${filmId}` ``. These are different strings, and a `Set.has` against the
wrong one returns `false` for every film without erroring.

This shipped broken once: every node dimmed to 12% with nothing lit, which looks like a
highlight that matched zero films rather than a key mismatch. Both the prop type and the
comment at [GraphView.tsx:152](../src/components/GraphView.tsx#L152) exist to prevent a
repeat.

`null` means *no narrowing active* and is not the same as an empty set, which means *nothing
matched*. Collapsing the two makes an empty search result dim the whole map.

### 3. Labels counter-scale through one CSS variable

Zoom writes `--zoom` on the SVG; CSS divides by it:

```css
font-size: calc(10px / var(--zoom));
stroke-width: calc(1px / var(--zoom));
```

So text keeps its pixel size while the map scales, with no per-node JS. Recomputing *which*
labels show is the expensive part, so it is throttled by a log-ratio step rather than by
every zoom frame ([GraphView.tsx:358](../src/components/GraphView.tsx#L358)):

```ts
if (Math.abs(Math.log(k / namedAtRef.current)) > ZOOM_STEP) applyNames();   // ZOOM_STEP = 0.06
```

A log ratio rather than a difference, so the step means the same thing at every scale.
`namedAtRef` records the scale labels were last computed at — not the current scale — and the
distance between the two is what is being measured.

`LABEL_FLOOR = 0.5` ([labels.ts:80](../src/viz/labels.ts#L80)) is the scale below which
labels stop entirely. A timeline taller than the frame can open below that floor and appear
unlabelled — a known gap, not a bug in thinning.

### 4. `fitToFrame` caps zoom at 1 and guards the empty case

[layout.ts:698](../src/viz/layout.ts#L698) returns the identity transform for zero nodes;
[layout.ts:723](../src/viz/layout.ts#L723) is `Math.min(1, …)`.

The cap is load-bearing, and the reason is stated in the function's own docstring: a library
of five films should be "presented small and precise rather than blown up into five enormous
dots". Without it, a sparse or single-node view scales until its handful of dots fill the
screen — technically a correct fit and completely useless. The case is pinned by a test named
*"framing one search match centres it without magnifying it"*, which is the situation that
motivates it: travelling to a search result must centre the match, not zoom into it.

Year rows are measured alongside nodes, not instead of them. A row spans a whole calendar
year while its films rarely reach either end, so framing the dots alone pushes January and
December off screen and cuts the graticule at both edges — which reads as a rendering fault
rather than as a map.

`FRAME_INSET` ([layout.ts:667](../src/viz/layout.ts#L667)) is asymmetric
(`top: 96, right: 76, bottom: 132, left: 76`) because the chrome bands overlay the map and
the bottom one is taller.

### 5. Topology: films never connect to films

From `CLAUDE.md`, and enforced by construction: films join attribute hubs, hubs never join
films to each other. Ten films by one director are ten edges to one node, not forty-five
edges between films.

Two corollaries:

- **Edges must stay linear in film count.** The diary thread chains watches at `n − 1`
  edges, which is why it is allowed to connect films directly at all.
- **Axes are mutually exclusive, never layered.** Rating is a legal axis; rating as a
  *second simultaneous* membership on top of decade is what reintroduces cliques.

Ordinal axes (decade, rating, watch year) chain their hubs low-to-high with `spine` edges so
the map is one connected component. Nominal axes (director) have no order and may be
islands.

### 6. Import style splits at the test boundary

| directory                                       | imports                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `src/domain`, `src/graph`, `src/import`, `src/viz` | relative, with explicit `.ts` extensions |
| `src/components`, `src/app`                     | the `@/` alias                            |

Not a style choice. `npm test` runs Node's own runner directly against the TypeScript
sources, and nothing resolves `@/` there. Using the alias in a tested directory breaks the
test run, not the build — so `npm run build` stays green and only `npm test` fails, which
misdirects the search.

### 7. `NOTHING` is module-level for identity, not for tidiness

[`Atlas.tsx:56`](../src/components/Atlas.tsx#L56) holds one frozen empty library. Every memo
below keys on `library` by identity, so constructing a fresh `emptyLibrary()` per render
would rebuild the graph, the statistics and the filter list on every keystroke the landing
sees.

The three library states are derived, not stored:

```ts
const usable  = imported !== null && imported.library.films.length > 0;
const library = usable && imported ? imported.library : demoAsked ? demo : NOTHING;
const landing = !usable && !demoAsked;
```

`landing` is deliberately *not* `library === NOTHING` — it comes from the same two facts
that chose the library, so the branch cannot drift from the choice.

### 8. Diagnostics carry coordinates, never content

An import problem reports file, row and field. It never reports the value. A title, rating
or review must not reach a log, a message, or an error string — including in development,
because that is where the habit forms.

## Design tokens

Defined in the `@theme` block at [globals.css:23](../src/app/globals.css#L23):

| token                   | value     | use                                             |
| ----------------------- | --------- | ----------------------------------------------- |
| `--color-void`          | `#101114` | page ground                                     |
| `--color-ink`           | `#15171a` | hub fills — darker than the nodes they sit among |
| `--color-surface`       | `#191b1f` | quiet panels                                    |
| `--color-raised`        | `#212429` | node fills                                      |
| `--color-rule`          | `#26292e` | hairline borders                                |
| `--color-rule-soft`     | `#1a1d21` | the graticule                                   |
| `--color-paper`         | `#e9e7e2` | primary type                                    |
| `--color-paper-mid`     | `#a2a6a8` | secondary type                                  |
| `--color-paper-dim`     | `#6b6f73` | annotations                                     |
| `--color-signal`        | `#c8f24e` | **one node on screen** — anchor, focus ring, active axis |
| `--color-signal-muted`  | `#a9cc42` | 5★ film fills (can be dozens)                   |
| `--color-signal-deep`   | `#5f7a22` | edges lit by a focus                             |

The accent never touches body text, large fills, or the grid. `.eiga-grid` draws
`--color-rule-soft` at `64px 64px`, centred.

Focus is global and unscoped — `:focus-visible { outline: 1px solid var(--color-signal) }`
at [globals.css:152](../src/app/globals.css#L152) — with `.eiga-button` widening the offset
to `3px`. Do not add per-component focus styles; the global rule already covers new markup.

## Recipes

### Add an axis

1. Add an entry to `AXES` in [`axes.ts`](../src/graph/axes.ts) with `id`, `label`,
   `available(library)`, and a grouping `strategy`.
2. If it is ordinal, chain its hubs with `spine` edges so the map stays one component.
3. Add a test asserting `available` is false for a library that cannot support it.

Nothing in `AxisControl`, `Atlas`, or the layout needs to change — the control renders
whatever `axesFor` returns.

### Add a highlight

Add it to `filtersFor` in [`filters.ts`](../src/domain/filters.ts) and teach `narrow` to
resolve it. Return **film ids** (invariant 2). `FilterControl` needs no change.

### Add a topology

1. Write a builder returning `Graph` with a new `shape` value.
2. Add the value to the union at [build.ts:115](../src/graph/build.ts#L115).
3. Branch in `Atlas`'s `graph` memo and in `layout.ts`.

If step 3 turns into steps 4 through 9, the `Graph` type is not carrying enough and should
be extended rather than worked around.

## Deliberately absent

No state manager, no data-fetching library, no test framework, no component library, no ZIP
library, no icon set, no animation library, no persistence layer, no server.

Each of those has been considered and rejected on the same grounds: the concrete problem it
solves is not one this project has. Before adding a dependency or an architectural layer,
`CLAUDE.md` asks for three things in writing — the concrete problem, why the current stack
is insufficient, and the maintenance/performance/privacy cost. That bar is what keeps
`node_modules` from becoming the product's largest liability.
