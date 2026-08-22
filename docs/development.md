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

Cloudflare **Pages**, built from the connected GitHub repository. `next.config.ts`
sets `output: "export"`, so `npm run build` writes finished HTML, CSS and JS into
`out/` and Pages uploads that directory. There is no server, no route handler,
and no Function.

Dashboard settings:

| setting           | value               |
| ----------------- | ------------------- |
| build command     | `npm run build`     |
| output directory  | `out`               |
| root directory    | _(repository root)_ |
| production branch | `main`              |

There is no deploy command. That is the whole difference from the Workers path:
Pages takes the output directory from the dashboard and uploads it itself, where
a Worker would need `wrangler deploy` and a config file naming the same folder.

### Do not add a wrangler config file

This repo had one — `wrangler.jsonc`, added in `b991b3e` when the project was a
Worker, removed when it became Pages. It should not come back, for three
reasons:

1. **Pages does not read a Workers config.** It looks for
   `pages_build_output_dir`; a Workers-shaped file (`assets.directory`, or worse
   `main`) has no key Pages recognises. Wrangler does not fail on this — it warns
   that fields are missing and downgrades the file to local-development-only,
   which is the bad outcome, because the file then looks authoritative and is
   inert.
2. **Adding `pages_build_output_dir` makes it worse, not better.** Once a Pages
   project has a wrangler config with that key, the file becomes the source of
   truth and the matching dashboard fields become uneditable. Build settings
   would then live in two places, with the repo silently winning.
3. **There is nothing to configure.** No Functions, no bindings, no environment,
   no secrets — the whole app is static files and a browser.

`out/` is gitignored on purpose: the builder produces it. Committing a build
would put a stale copy of the app in the repo and change nothing about what
Cloudflare serves.

**Pages Web Analytics stays off.** It is not a dashboard-only report — enabling
it injects a beacon script into every response, which would make a request leave
the reader's browser before they have chosen to trust anything. EIGA's promise is
that nothing leaves the browser, and that promise has to hold at the edge too.

`wrangler` is deliberately not a dependency, and on this path nothing fetches it
either. The build runs `next build` and Pages does the rest.

### Why `.nvmrc` exists

The Cloudflare build image's default Node is older than this project's floor
(`engines.node` is `>=22.18`, which is where native TypeScript type stripping —
what `npm test` runs on — became available without a flag). Without the pin the
build fails on a version error that names no file, so the pin is the whole fix.
It has to be a bare version string; nvm reads nothing else, which is why this
explanation lives here rather than in the file.

### The one hand-set value

`ORIGIN` in `src/app/layout.tsx` must match the origin Cloudflare actually
serves: `<project-name>.pages.dev`, or a custom domain once one is attached. The
Pages project name _is_ the subdomain, so renaming the project in the dashboard
changes the URL and this line has to follow.

A static export has no request to learn its own host from, so this is baked in at
build time: if it is wrong, every shared link's preview card asks the _reader's_
browser for an image on a host you do not own. That failure is invisible locally,
because whatever is baked in resolves fine on the machine that baked it.
