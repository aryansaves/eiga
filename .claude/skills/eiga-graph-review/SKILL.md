---
name: eiga-graph-review
description: Review EIGA's graph visualization for readability, interaction quality, relationship hierarchy, and performance. Use before calling a graph implementation finished.
---

# EIGA Graph Review

Inspect the graph implementation and evaluate:

## Readability
- Can a user identify the current focal node?
- Are labels selective and zoom-aware?
- Do unrelated nodes recede?
- Is edge density controlled?

## Interaction
- Is hover useful?
- Does selection create a clear focus state?
- Can users navigate outward through relationships?
- Are transitions purposeful?
- Does reduced-motion behavior exist where appropriate?

## Data correctness
- Are graph edges derived from normalized domain data?
- Are duplicate or meaningless edges removed?
- Are weights or counts deterministic?

## Performance
- Is D3 simulation isolated from unnecessary React state updates?
- Are expensive computations memoized or precomputed where appropriate?
- Is there evidence of an actual scaling problem before introducing WebGL/canvas complexity?

## Product quality

The final graph should feel like a cinematic map, not a default network chart.
