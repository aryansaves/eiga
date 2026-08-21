# EIGA — Project Instructions

<!--
Maintainer note: keep this file concise. Put procedures in skills,
path-specific conventions in .claude/rules/, and discovered learnings in
Claude Code auto memory rather than growing this file indefinitely.
-->

## Product

EIGA is a privacy-first web experience that turns a person's Letterboxd export into an interactive visual map of their movie taste.

Working tagline:
> Your cinema, mapped.

Core promise:
> I want to see mine.

EIGA is not a Letterboxd clone, review platform, social network, generic movie database, recommendation chatbot, or AI film critic.

## V1 non-negotiables

- Letterboxd export is processed locally in the browser.
- No account, server database, analytics platform, or cloud storage is required.
- No Letterboxd scraping.
- No dependency on the Letterboxd API.
- No LLM/AI required for core functionality.
- No TMDB dependency until the core graph is compelling.
- Keep the dependency footprint small.
- The graph is the primary interface, not a chart inside a dashboard.
- The first complete slice is: import → normalize → graph → explore → inspect.

## Design north star

EIGA should feel like entering a quiet **cinematic observatory / personal atlas**: part film archive, part star chart, part museum catalog, part editorial website.

The fact that the name is Japanese is not a reason to add stereotypical Japanese decoration. Avoid torii, brush fonts, kanji flourishes, anime styling, neon cyberpunk, or other gimmicks unless a future product decision explicitly calls for them.

Visual character:
- neutral graphite base, cooled rather than warm-black
- off-white typography
- one restrained accent — citron (`--color-signal`), rationed across three strengths
- thin rules and faint cartographic/grid marks
- strong editorial typography
- generous negative space
- calm motion
- sparse controls
- subtle texture only when it adds atmosphere

Citron is louder than the tungsten/amber this brief originally called for, so it is
rationed rather than applied freely:

- `--color-signal` — the selected anchor, the focus ring, the active axis marker. At
  most one node on screen.
- `--color-signal-muted` — 5★ film fills, which can number in the dozens.
- `--color-signal-deep` — edges lit by a focus.

The accent never touches body text, large fills, or the grid. If it ever reads as a
developer tool rather than an atlas, darken `--color-signal-muted` further; do not
add a second colour.

Avoid:
- generic SaaS dashboards
- purple AI gradients
- excessive glassmorphism
- pill-shaped-everything
- rainbow graph categories
- giant glowing nodes
- heavy shadows
- dense admin sidebars
- excessive rounded cards
- emoji as primary UI decoration

## Graph principles

- Do not default to an unreadable spiderweb.
- Preserve hierarchy and legibility.
- Movies are primary visual objects; metadata entities are quieter.
- Selected/focused nodes become the anchor.
- Unrelated nodes should recede instead of abruptly disappearing.
- Reveal relationships progressively when useful.
- Labels should be selective and zoom-aware.
- Motion should communicate state changes, not decorate everything.
- The graph should feel authored, not like default D3 output.

### Topology

The constraint is **quadratic growth**, not film-to-film links as such. Ten films by one
director must never become forty-five edges between films — that is the unreadable
spiderweb, and it is what routing attribute membership through hubs prevents: ten edges
to one node instead.

So films may be joined to each other by a relation whose edge count is **linear in the
number of films**, and only by such a relation. Two exist:

- the **diary thread** chains films in watch order — n−1 edges
- the **discovery tree** hangs each film from the nearest earlier film in release year —
  also n−1 edges, the sparsest connected graph there is

Attribute membership is not linear and stays bipartite. See ADR-009.

Hubs come from exactly one **axis** at a time, and axes are mutually exclusive rather
than layered. Rating is a valid axis on those terms: `4½` is a hub like `1990s` is,
each film joins one band, and the graph stays bipartite. What remains forbidden is
rating as a *second simultaneous* membership on top of another axis, which is the
case that reintroduces cliques.

An ordinal axis (decade, rating, watch year) chains its hubs low-to-high with
`spine` edges, so the map is one connected component and the scale is structure the
eye can follow rather than a coincidence of where the anchors were placed. A nominal
axis (director) has no order to chain and is allowed to be several islands.

Note that a Letterboxd export carries **no director or actor data** — its columns are
`Date, Name, Year, Letterboxd URI, Rating, Rewatch, Review, Tags, Watched Date`. The
director axis works on the authored demo only, and `axesFor` withholds any axis a
library cannot speak to rather than offering a dead control.

## Engineering

Primary stack:
- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- D3.js
- Papa Parse

Keep domain logic separate from rendering:
raw import → normalized domain model → graph/derived data → visualization → UI state.

Prefer pure, deterministic functions for parsing, normalization, graph construction, filtering, and statistics.

Avoid `any`. Avoid premature abstractions. Do not introduce a library to save a few lines of code.

Before adding a substantial dependency or architectural layer, explain:
1. the concrete problem,
2. why the current stack is insufficient,
3. the maintenance/performance/privacy cost.

## Product quality bar

Every feature should pass three tests:

1. Is it immediately understandable?
2. Does it create a useful or delightful moment?
3. Does it preserve the visual identity of EIGA?

Prefer one excellent interaction over five ordinary ones.

## Privacy and security

Treat imported Letterboxd data as personal data.

- Do not log titles, ratings, reviews, or identifiers in production.
- Do not upload raw imports in V1.
- Validate imported files and handle malformed rows gracefully.
- Treat imported text as untrusted input.
- Sanitize/escape displayed content.
- Keep external API calls explicit and isolated.
- Never commit secrets.

## Working with Claude Code

Before a significant implementation:
1. inspect existing code and relevant docs/rules,
2. state the smallest coherent implementation,
3. make the change,
4. run the appropriate checks,
5. summarize what changed and any remaining risk.

Do not silently expand scope.
Do not replace working architecture without a measured reason.
Do not create placeholder TODO features merely to make a screen look complete.
