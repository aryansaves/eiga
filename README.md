# EIGA

> Your cinema, mapped.

EIGA is a privacy-first visual exploration tool for your Letterboxd history.

Instead of showing you another list of films, EIGA turns your viewing history into an explorable cinematic map: movies, directors, actors, genres, eras, and the relationships between them.

## The idea

Letterboxd answers:

> What have I watched?

EIGA asks:

> How is everything I've watched connected?

## Current direction

EIGA is intentionally:
- web-first
- client-first
- privacy-first
- free to operate at V1
- non-AI at the core
- graph-led rather than dashboard-led

## Development

```bash
npm install
npm run dev
```

See `CLAUDE.md` and `docs/` for project conventions and product direction.

## Claude Code

This repository includes:

- `CLAUDE.md` — always-on project context
- `.claude/rules/` — scoped engineering/design rules
- `.claude/agents/` — specialist subagents
- `.claude/skills/` — reusable workflows and creative/product guidance

Useful skills include:

```text
/eiga-creative-direction
/eiga-graph-review
/eiga-ship-check
```

Claude Code also provides bundled skills such as `/debug`, `/code-review`, `/run`, and `/verify` depending on installed version.

## Status

EIGA is an early-stage project. Product and architecture decisions may change as the prototype is tested with real users.
