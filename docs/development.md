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

Cloudflare Pages, built from the connected GitHub repository. Nothing about the
deploy is EIGA-specific — `next.config.ts` sets `output: "export"`, so the build
is a plain static site with no server, no functions and no environment
variables.

Dashboard settings:

| setting          | value               |
| ---------------- | ------------------- |
| build command    | `npm run build`     |
| output directory | `out`               |
| root directory   | _(repository root)_ |

`out/` is gitignored on purpose: the builder produces it. Committing a build
would put a stale copy of the app in the repo and change nothing about what
Cloudflare serves.

Web Analytics stays **off**. EIGA's promise is that nothing leaves the browser,
and a host-injected analytics beacon would make that false at the one moment it
matters most — first visit, before anyone has chosen to trust it.

### Why `.nvmrc` exists

The Cloudflare build image's default Node is older than this project's floor
(`engines.node` is `>=22.18`, which is where native TypeScript type stripping —
what `npm test` runs on — became available without a flag). Without the pin the
build fails on a version error that names no file, so the pin is the whole fix.
It has to be a bare version string; nvm reads nothing else, which is why this
explanation lives here rather than in the file.

### The one hand-set value

`ORIGIN` in `src/app/layout.tsx` must match the origin Pages actually serves —
`<project>.pages.dev`, or a custom domain once one is attached. A static export
has no request to learn its own host from, so this is baked in at build time: if
it is wrong, every shared link's preview card asks the _reader's_ browser for an
image on a host you do not own. That failure is invisible locally, because
whatever is baked in resolves fine on the machine that baked it.
