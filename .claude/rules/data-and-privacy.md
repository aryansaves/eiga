# EIGA Data & Privacy Rules

Apply these rules to import, parsing, domain model, API, storage, and analytics code.

- Treat imported Letterboxd exports as user-owned personal data.
- Keep V1 processing local to the browser.
- Do not transmit raw imports to third parties.
- Never put reviews or full imported rows into logs.
- Validate file shape, dates, ratings, identifiers, and text before use.
- Keep raw import structures separate from normalized domain types.
- Make parsers deterministic and independently testable.
- External metadata enrichment must be optional and cacheable.
- Do not add analytics until there is an explicit privacy-preserving design.
- Never hard-code secrets, API keys, or tokens.
