/* Throwaway: confirms the authored demo diary reads as intended. Delete after. */
import { demoLibrary } from "./src/domain/demo.ts";
import { buildThread, unthreaded } from "./src/graph/thread.ts";
import { filtersFor } from "./src/domain/filters.ts";
import { axesFor } from "./src/graph/axes.ts";
import { groupCount } from "./src/graph/build.ts";

const library = demoLibrary();
const graph = buildThread(library);
const steps = new Map<number, number>();
for (const node of graph.nodes) {
  if (node.order === null) continue;
  steps.set(node.order, (steps.get(node.order) ?? 0) + 1);
}

console.log({
  films: library.films.length,
  watches: library.watches.length,
  rewatches: library.watches.filter((w) => w.rewatch).length,
  likes: library.likes.size,
  steps: groupCount(graph),
  knots: [...steps.values()].filter((n) => n > 1).length,
  knotFilms: [...steps.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0),
  undated: unthreaded(graph).length,
  chainEdges: graph.edges.length,
  yearMarks: graph.yearStarts,
  axes: axesFor(library).map((a) => a.id),
  filters: filtersFor(library).map((f) => `${f.id}:${f.films.size}`),
});
