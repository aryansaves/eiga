# EIGA Development Workflow

## Before coding

- read CLAUDE.md
- check relevant `.claude/rules/`
- inspect current implementation
- identify the smallest coherent slice
- define how success will be verified

## During coding

- keep domain logic independent of UI
- prefer small components and pure functions
- preserve accessibility
- avoid speculative abstractions
- do not introduce dependencies without a concrete reason

## Before commit

- review the diff
- run lint
- run type checking
- run tests if present
- run a production build when appropriate
- run `/eiga-ship-check` for meaningful milestones

## Git discipline

Use focused commits. Prefer commit messages such as:

- `feat: add local letterboxd import`
- `feat: render director relationships`
- `fix: preserve graph focus during search`
- `refactor: isolate graph construction`
- `docs: define visual direction`

Never commit secrets, `.env` files, generated build output, or personal imported media exports.

## Deploying

Cloudflare **Workers**, built from the connected GitHub repository, serving
`out/` as static assets with no Worker script. `next.config.ts` sets
`output: "export"`, so the build produces finished files and there is nothing to
run on a request.

Dashboard settings:

| setting        | value                 |
| -------------- | --------------------- |
| build command  | `npm run build`       |
| deploy command | `npx wrangler deploy` |
| root directory | _(repository root)_   |

The output directory is **not** set in the dashboard — `wrangler.jsonc` states it
(`assets.directory: "./out"`), and one authority for it is the point. See that
file's header for why it has to exist at all: without a config, `wrangler deploy`
guesses that a Next.js repo is server-rendered, runs the OpenNext adapter, and
fails on a build artifact a static export never emits.

`out/` is gitignored on purpose: the builder produces it. Committing a build
would put a stale copy of the app in the repo and change nothing about what
Cloudflare serves.

Analytics and Workers Logs stay **off** — the latter explicitly, in
`wrangler.jsonc`, because the tooling's default is on. EIGA's promise is that
nothing leaves the browser, and a host-side beacon or request log would make that
false at the one moment it matters most: first visit, before anyone has chosen to
trust it.

`wrangler` is deliberately not a dependency; the deploy command fetches it. That
trades a pinned version for a smaller install, and is worth revisiting if
wrangler's behaviour ever surprises this project a second time.

### Why `.nvmrc` exists

The Cloudflare build image's default Node is older than this project's floor
(`engines.node` is `>=22.18`, which is where native TypeScript type stripping —
what `npm test` runs on — became available without a flag). Without the pin the
build fails on a version error that names no file, so the pin is the whole fix.
It has to be a bare version string; nvm reads nothing else, which is why this
explanation lives here rather than in the file.

### The one hand-set value

`ORIGIN` in `src/app/layout.tsx` must match the origin Cloudflare actually
serves. For a Worker that is `<name>.<account-subdomain>.workers.dev` — **not**
`<name>.pages.dev`, which is a Pages project's shape — or a custom domain once
one is attached. A static export has no request to learn its own host from, so
this is baked in at build time: if it is wrong, every shared link's preview card
asks the _reader's_ browser for an image on a host you do not own. That failure
is invisible locally, because whatever is baked in resolves fine on the machine
that baked it.
