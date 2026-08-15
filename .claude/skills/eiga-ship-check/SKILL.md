---
name: eiga-ship-check
description: Run a final EIGA quality check before committing or opening a pull request. Use for build, lint, accessibility, privacy, scope, and visual-risk checks.
---

# EIGA Ship Check

Run the project's available checks, preferably:

- lint
- type checking
- tests
- production build

Then inspect the diff for:

## Security/privacy
- secrets accidentally added
- personal import data logged or transmitted
- unsafe HTML rendering
- unnecessary third-party requests

## Product
- scope creep
- dead UI
- placeholder features
- copy that sounds like generic AI SaaS

## Design
- violations of EIGA visual rules
- clutter
- excessive cards/rounded surfaces
- graph readability problems

## Maintainability
- unnecessary dependencies
- duplicated domain logic
- giant components
- weak TypeScript types

Report blockers first. Do not change code unless explicitly asked.
