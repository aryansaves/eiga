---
name: eiga-git-hygiene
description: Review EIGA's working tree and git diff for accidental secrets, generated files, user data, noisy changes, and poor commit hygiene.
---

# EIGA Git Hygiene

Check `git status` and the diff.

Reject or flag:
- `.env` and secrets
- imported Letterboxd exports
- generated build output
- large binaries that do not belong in Git
- accidental editor/OS files
- unrelated changes
- generated code without an explicit reason

Check that changes remain aligned with the requested task and that commits can be small and intelligible.
