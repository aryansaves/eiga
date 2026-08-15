# Claude Code Setup

## Why the repo uses several layers

### `CLAUDE.md`

Always-on facts and project rules: architecture, product boundaries, design north star, and non-negotiables.

Keep this concise.

### `.claude/rules/`

Path/domain-specific rules that should be applied when working in matching areas.

### `.claude/skills/`

Reusable procedures, creative frameworks, and checks that should load on demand or be invoked with `/skill-name`.

### `.claude/agents/`

Specialist workers with their own context. Use these when a task is large enough that isolated context or specialized judgment is valuable.

### Auto memory

Let Claude Code maintain learned project-specific patterns where supported. Do not check generated local memory into Git.

## Good use of subagents

Use a subagent for:
- independent code review
- graph/performance investigation
- design critique
- large repository exploration

Do not spawn a subagent just to make a trivial edit.

## Good use of skills

Use a skill when a workflow is repeated or when a reference procedure is too detailed for `CLAUDE.md`.

Examples:
- creative direction
- graph review
- release/ship check
- git hygiene

## Built-in skills

Claude Code versions vary. Recent versions include bundled skills such as `/debug`, `/code-review`, `/run`, and `/verify`. Use `/skills` or the current documentation to inspect what is available in your installation rather than duplicating a built-in skill name.
