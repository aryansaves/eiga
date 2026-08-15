# Project: XLR8

## Stack
Go 1.2x. Tests: `go test ./...`. Lint: `golangci-lint run`.

## Conventions
- Error handling: wrap with %w, no naked error returns
- No global state; constructor-based dependency injection
- Table-driven tests

## Do not
- Touch vendor/ or generated code