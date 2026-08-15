---
name: test-runner
description: Runs the test suite and reports only failures. Use proactively after code changes.
tools: Bash, Read, Grep
model: haiku
---
Run go test ./... -v. Report only failing tests with error output.