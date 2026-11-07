```text
 _____ ___ ____    _
| ____|_ _/ ___|  / \
|  _|  | | |  _  / _ \
| |___ | | |_| |/ ___ \
|_____|___\____/_/   \_\
```

**Your cinema, mapped.**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-111111?style=flat-square&logo=nextdotjs&logoColor=white)
![D3](https://img.shields.io/badge/D3-F9A03C?style=flat-square&logo=d3&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)

[Live app](https://eiga.pages.dev/) · [Staging](https://eiga-staging.pages.dev/) · [Backend](https://github.com/aryansaves/eiga-persistent)

EIGA turns a Letterboxd export into an interactive movie graph. Explore your viewing
journey, find patterns in your ratings, and share an atlas that updates with each new upload.

## Explore your films

- Import a Letterboxd ZIP or CSV files, or try the built-in demo without an account.
- Switch between journey, release decade, rating, and watch year; search and highlight films.
- Pan, zoom, inspect reviews and rewatches, switch themes, and export a PNG.
- Sign in with Google to save your atlas and create a reusable public link.

Director grouping is available in the demo; Letterboxd exports do not include director data.

## Run locally

Requires **Node.js 22.18+**.

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) for local imports and the demo.
Google sign-in and saved/share APIs require the [backend's local setup](https://github.com/aryansaves/eiga-persistent#run-locally).

## How it works

```text
Letterboxd export → browser parsing → normalized library → graph → React + D3
```

Next.js exports static files to `out/`. React manages UI state; D3 manages layout,
pan, and zoom. Pure TypeScript modules handle imports, graph construction, and statistics.

Raw exports stay in the browser. Signing in saves normalized films, viewing dates,
ratings, likes, and reviews. Sharing makes that saved atlas, including reviews,
available to anyone with the link. New uploads update the same link.

## Checks and releases

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build -- --webpack
```

Feature PRs run checks. Merge into `staging` to deploy the combined app for manual testing.
Production is released through the backend's pinned `release.json` after the tested
frontend reaches `main`; a frontend main push alone does not deploy production.

[Development guide](docs/development.md) · [Codebase map](docs/codebase.md) · [Security](SECURITY.md)
