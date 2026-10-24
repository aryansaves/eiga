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

The frontend remains a Next.js static export into `out/`. The separate
[eiga-persistent repository](https://github.com/aryansaves/eiga-persistent) owns
Pages Functions, Google OAuth, D1 migrations, and the combined deployment workflow.
It builds a pinned frontend commit and deploys the exported files and Functions
on the same origin, keeping API calls and session cookies same-origin.

Feature pushes on `codex/**` run frontend checks and dispatch backend `deploy.yml`.
The frontend needs `EIGA_DEPLOY_DISPATCH_TOKEN` with Actions Write access to the
backend repository. `STAGING_BACKEND_REF` selects the backend feature branch;
its default is `codex/auth-persistence`. Backend pushes can deploy the same pair.

Staging is `https://eiga-staging.pages.dev`; production is `https://eiga.pages.dev`.
They share `eiga-db` but use fixed separate tables and migration ledgers. Table
prefixes do not prevent one deployment accessing the other environment's tables.

The release order is: test the feature pair on staging, merge frontend, pin its
merged commit in the backend release manifest, test that pair, then merge backend.
Frontend main does not deploy production. The backend manifest keeps production
disabled until release. Turn off the existing production Pages automatic Git build
when adopting this workflow, so frontend merges cannot bypass release orchestration.

For full local development, build this repo and copy `out/` into the backend's
ignored `public/`, configure its ignored `.dev.vars`, and run `npm run dev` there.
Use `http://localhost:8788` for the app and API together. `next dev` alone still
supports anonymous import/exploration but has no authentication API.

Do not put Google secrets in this repo or `NEXT_PUBLIC_` variables. Runtime
configuration and Wrangler belong to the backend. Neither repo tracks generated
build output. Pages Web Analytics stays off.

### Why `.nvmrc` exists

The Cloudflare build image's default Node is older than this project's floor
(`engines.node` is `>=22.18`, which is where native TypeScript type stripping —
what `npm test` runs on — became available without a flag). Without the pin the
build fails on a version error that names no file, so the pin is the whole fix.
It has to be a bare version string; nvm reads nothing else, which is why this
explanation lives here rather than in the file.

### The one hand-set value

`ORIGIN` in `src/app/site.ts` must match the production origin Cloudflare actually
serves: `<project-name>.pages.dev`, or a custom domain once one is attached. The
Pages project name _is_ the subdomain, so renaming the project in the dashboard
changes the URL and this line has to follow.

A static export has no request to learn its own host from, so this is baked in at
build time: if it is wrong, every shared link's preview card asks the _reader's_
browser for an image on a host you do not own. That failure is invisible locally,
because whatever is baked in resolves fine on the machine that baked it.
