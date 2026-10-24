# EIGA Architecture

## Principles

- client-first
- privacy-first
- minimal operating cost
- boring infrastructure
- strong domain boundaries
- measurable performance

## Data flow

```text
Letterboxd export
      ↓
Browser file input
      ↓
CSV/ZIP parsing
      ↓
Normalization
      ↓
Domain model
      ├────→ derived statistics
      ↓
Graph builder
      ↓
D3 rendering
      ↓
Selection / focus state
      ↓
Detail surfaces
```

## Domain model

Start with explicit types such as:

- Movie
- Person
- Genre
- WatchEvent
- Rating
- GraphNode
- GraphEdge

Do not pass raw CSV rows throughout the application.

## Boundaries

### Import

Read and validate the user file. Convert raw rows into safe normalized domain records.

### Domain

Represent movies, people, dates, ratings, and relationships independent of React and D3.

### Graph

Produce serializable graph data. D3 objects are renderer implementation details, not the source of truth.

### Visualization

D3 owns simulation, coordinates, zoom, pan, drawing, and visualization transitions.

### UI state

React owns selection, filters, search, mode, panels, and other application state.

## Storage

Anonymous use works without persistence. Optional Google sign-in saves a versioned
normalized library through same-origin Pages Functions. Maps/Sets become entry
arrays at the transport boundary; graph coordinates and metrics remain derived.

## External metadata

TMDB is optional future enrichment. Use stable identifiers, cache results, respect attribution/rate limits, and keep the core experience usable without the integration.

## Backend

The separate eiga-persistent repository owns Google OAuth, opaque sessions, map
storage, revocable public links, and Pages deployments. CI assembles it with this
static frontend at a pinned commit. One D1 database uses fixed staging/production
table names and independent migration ledgers. Share reads expose the latest saved
library including reviews, with no account identity fields.

## Performance

Optimize based on real measurements:

- avoid unnecessary React renders during D3 simulation
- use selective labels
- reduce visual complexity while zoomed out
- memoize expensive derived data when profiling shows value
- consider Canvas/WebGL only when measured graph size warrants it
