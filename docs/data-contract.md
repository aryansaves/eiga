# EIGA Data Contract

The normalized domain model is the boundary between messy external exports and the rest of the application.

## Principles

- raw import rows are never the long-term domain model
- all optional fields are explicit
- dates are normalized consistently
- ratings use a single internal representation
- source identifiers are preserved when useful
- malformed records should produce actionable import diagnostics

## Import diagnostics

Prefer structured diagnostics such as:

- row number
- field name
- severity
- human-readable message

Do not expose raw rows containing reviews or other personal data in diagnostic logs.
