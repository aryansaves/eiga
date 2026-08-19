# EIGA

> Your cinema, mapped.

EIGA turns a Letterboxd export into an interactive map of your viewing history. It runs
entirely in your browser: no account, no server, no upload, and no persistence of any
kind. Closing the tab is the delete button.

## What it does

You arrive on an empty map. Drop in your Letterboxd export `.zip` — or the CSVs from
inside it — and EIGA draws your library as a graph you can explore along one axis at a
time:

| axis            | shape                                                                    |
| --------------- | ------------------------------------------------------------------------ |
| **Watch dates** | a calendar timeline — every film on the day you saw it, one row per year  |
| **Decade**      | films clustered by release decade, decades chained low-to-high           |
| **Rating**      | films clustered by the score you gave them                               |
| **Watch year**  | films clustered by the year you watched them                             |
| **Director**    | demo library only — see below                                            |

Search travels the view to a match. Highlights (Liked, Rewatched) light a subset and let
the rest recede. Any view can be saved as a PNG, composed in-browser and written straight
to your downloads.

### What a Letterboxd export actually contains

This constrains the entire product, so it is worth stating plainly. The watch-history CSVs
carry exactly:

```text
Date, Name, Year, Letterboxd URI, Rating, Rewatch, Review, Tags, Watched Date
```

There are **no directors, no actors and no genres**. Any axis needing them can only work
against enriched data (an optional future TMDB integration) or the authored demo library,
which is why Director appears on the demo and not on your import. `axesFor` withholds an
axis a library cannot support rather than offering a control that does nothing.

`profile.csv` — which holds email, legal name, location and bio — is never read at all.

## Quickstart

Requires Node **≥ 22.18**; 24 LTS or newer recommended. Developed on 26.4. The version
floor is not arbitrary — see [Testing](#testing).

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You will land on an empty map: either import an export, or
follow "Or see a demo library" for an authored 37-film library that exercises every axis.

## Scripts

| script                 | runs                            | notes                                                          |
| ---------------------- | ------------------------------- | -------------------------------------------------------------- |
| `npm run dev`          | `next dev`                      | Turbopack dev server with HMR                                  |
| `npm run build`        | `next build`                    | static export into `out/`; also type-checks                    |
| `npm run lint`         | `eslint`                        | flat config — **not** `next lint`, which does not exist here   |
| `npm run typecheck`    | `tsc --noEmit`                  | `strict` is on                                                 |
| `npm test`             | `node --test 'src/**/*.test.ts'` | 136 tests, no test framework                                   |
| `npm run format`       | `prettier --write .`            | see [the Prettier caveat](#the-prettier-caveat) before running  |
| `npm run format:check` | `prettier --check .`            | currently fails; see below                                     |

`npm start` (`next start`) is inherited from the Next.js template and does **not** work:
`output: "export"` produces static files, so there is no server to start. Serve `out/`
with any static file server instead.

The four gates that matter before a commit are `typecheck`, `lint`, `test`, and `build`.

## Toolchain

### Runtime dependencies

| package             | why it is here                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `next` `16.3.1`     | App Router and the static exporter. No server features are used — see [Deployment](#deployment).                      |
| `react` / `react-dom` `19.2.8` | UI. Every component is `"use client"`; React owns selection and filter state, never graph coordinates.      |
| `d3` `^7.9.0`       | force simulation, zoom/pan, and selection. See the [d3 caveat](#the-d3-caveat).                                       |
| `papaparse` `^5.6.0` | CSV parsing. Handles quoted fields, embedded newlines and the BOM that Letterboxd exports carry.                      |

There is deliberately no ZIP library: `src/import/zip.ts` reads the archive directly,
because the export uses stored/deflated entries that `DecompressionStream` already handles.

### Dev dependencies

| package                          | what it does                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript` `^5`                | The language. `tsc --noEmit` is the type gate; nothing transpiles TypeScript for the browser except Next itself.                                 |
| `@types/node`                    | Types for `node:test`, `node:assert`, `node:fs` used by the test files.                                                                          |
| `@types/react`, `@types/react-dom` | React 19 types.                                                                                                                                |
| `@types/d3`                      | d3 ships no types of its own. Without this, every d3 import is `any` and `avoid any` becomes unenforceable.                                      |
| `@types/papaparse`               | Same reason for Papa Parse.                                                                                                                     |
| `eslint` `^9`                    | Flat config in `eslint.config.mjs`. Invoked as bare `eslint` — the `next lint` wrapper is gone in Next 16.                                       |
| `eslint-config-next` `16.3.1`    | React-hooks and Next-specific rules. Pinned to the exact Next version on purpose; they move together.                                            |
| `tailwindcss` `^4`               | Tailwind v4 is **CSS-first**: there is no `tailwind.config.js`. Design tokens live in an `@theme` block in `src/app/globals.css`.                 |
| `@tailwindcss/postcss`           | The PostCSS plugin that compiles those directives, wired up in `postcss.config.mjs`. Tailwind v4 no longer works through the old `tailwindcss` plugin. |
| `prettier` `^3.9.6`              | Formatter. Not currently enforced — see below.                                                                                                   |
| `prettier-plugin-tailwindcss` `^0.8.1` | Sorts Tailwind class strings into canonical order. This is why `className` values read in a consistent sequence throughout.                |

Note what is **absent**: no Jest, Vitest, Mocha, ts-node, tsx, or Babel. Tests run on
Node's built-in runner against the TypeScript sources directly.

### Testing

`npm test` is `node --test 'src/**/*.test.ts'` — no transpile step, no test framework.
Node strips the type annotations natively and runs the files. Two consequences you cannot
work around:

1. **Node ≥ 22.18 is required.** Unflagged type stripping landed in 23.6 and was
   backported to 22.18. On anything older the tests fail with syntax errors on the first
   type annotation, which reads like a broken test rather than a stale runtime.
2. **`src/domain`, `src/graph`, `src/import` and `src/viz` must use relative imports with
   explicit `.ts` extensions.** There is no bundler resolving paths for the test runner, so
   the `@/` alias does not exist there. `src/components` and `src/app` are only ever loaded
   by Next and use `@/` normally.

### The Prettier caveat

`npm run format:check` **does not pass** — 41 files differ. The committed code is
hand-formatted, and no Prettier configuration reproduces it exactly. `.prettierrc` has been
corrected to describe the codebase's actual style (double quotes, 90 columns) rather than
contradicting it, which brought the count down from 55 to 41, but the gate is still red.

Do not run `npm run format` casually: it will reformat 41 files in one commit. Prettier does
not reflow comment *prose*, so the long explanatory comments survive intact, but code
wrapping and line breaks will move. Pick one deliberately:

- run `npm run format` once as its own isolated commit, then enforce it from then on;
- or drop Prettier and its plugin, and let ESLint and `.editorconfig` carry style.

### The d3 caveat

`package.json` declares the `d3` meta-package, but the code imports the submodules
directly:

```ts
import { forceSimulation } from "d3-force";
import { select } from "d3-selection";
import { zoom } from "d3-zoom";
```

Those resolve today only because npm installs a flat `node_modules` and `d3` depends on
them transitively. **Under pnpm, Yarn PnP, or a nested install strategy these imports
fail** — which matters the moment someone else clones the repo. It also installs 30 `d3-*`
packages to use about 10.

The fix is to declare the three submodules directly and drop the `d3` meta-package. It is
left undone here because changing dependencies is a decision to make deliberately, not a
drive-by.

## Repo map

```text
src/
  app/              Next App Router shell — layout, page, globals.css (design tokens)
  components/       React UI. All "use client". Atlas.tsx owns every piece of state.
  domain/           Normalized model, statistics, filters, search, calendar, demo library
  graph/            Pure graph construction: axes, hub maps (build.ts), timeline (thread.ts)
  import/           Letterboxd CSV/ZIP reading and validation
  viz/              Layout, label thinning, PNG export
docs/               Product, architecture, brand, data contract, decisions (ADRs)
.claude/            Project rules, specialist agents, and skills, deliberately checked in
CLAUDE.md           Always-on project context — read this first
```

The layering is strict and one-directional:

```text
raw import → normalized domain model → graph/derived data → visualization → UI state
```

Parsing, normalization, graph construction, filtering and statistics are pure
deterministic functions, which is what makes them testable without a browser.

For the module-by-module map and the invariants that are easy to break, see
[`docs/codebase.md`](docs/codebase.md).

## Privacy

These are enforced, not aspirational:

- Everything is processed in the browser. No import ever crosses the network.
- There is **no persistence at all** — no `localStorage`, `sessionStorage`, IndexedDB or
  cookies. Verify it yourself:
  ```bash
  grep -rn "localStorage\|sessionStorage\|indexedDB\|document.cookie" src/
  ```
- `profile.csv` is never parsed. `src/import/letterboxd.test.ts` asserts that its PII
  cannot reach a serialized library.
- Import diagnostics carry file, row and field — never row *content*. No title, rating or
  review can reach a log.
- No analytics, of any kind, including host-provided analytics.

See [`.claude/rules/data-and-privacy.md`](.claude/rules/data-and-privacy.md).

## Deployment

The app has no server features: no route handlers, no middleware, no `next/image`, no
`next/font`, no cookies. `next.config.ts` sets `output: "export"`, so `npm run build`
emits a fully static site into `out/` — deployable to any static host.

```bash
npm run build   # → out/
```

Recommended: Cloudflare Pages, with host analytics turned off. Netlify or GitHub Pages work
equally well. There is nothing to configure beyond the output directory.

Not yet done, and needed before sharing links publicly: a favicon, `metadataBase`, and
OpenGraph/Twitter tags. `public/` is currently empty, so a shared link previews as a blank
card.

## Docs

| file                                            | contents                                        |
| ----------------------------------------------- | ----------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                        | product promise, design north star, graph topology rules, engineering constraints |
| [`docs/product.md`](docs/product.md)            | what EIGA is and is not                         |
| [`docs/codebase.md`](docs/codebase.md)          | module map and load-bearing invariants          |
| [`docs/architecture.md`](docs/architecture.md)  | original architectural brief (pre-implementation) |
| [`docs/data-contract.md`](docs/data-contract.md) | expected import shape                          |
| [`docs/brand.md`](docs/brand.md)                | visual language                                 |
| [`docs/decisions.md`](docs/decisions.md)        | ADR log                                         |
| [`docs/development.md`](docs/development.md)    | working conventions                             |

## Status

Early-stage. The import → normalize → graph → explore → inspect slice works end to end
against real exports; 136 tests pass; the production build is clean.

Known gaps: the chrome is cramped below roughly 520px and has no designed phone layout;
long watch histories (twenty-plus years) produce a timeline taller than the initial frame;
shareable links are not built yet.
