import test from "node:test";
import assert from "node:assert/strict";

import { demoLibrary } from "../domain/demo.ts";
import { buildGraph, byDecade, byRating, byWatchYear, orderedHubs } from "../graph/build.ts";
import { createLayout, positionsOf, settle, type LayoutEdge, type LayoutNode } from "./layout.ts";
import type { Simulation } from "d3-force";

/*
  The layout is pure — no DOM, no React — so it can be measured here rather than
  in a browser. That matters more than convenience: whether a film ends up beside
  the right hub is invisible to a screenshot, and a browser probe cannot see it
  either without the simulation having actually run to rest.
*/

const WIDTH = 1280;
const HEIGHT = 860;

/**
 * The energy `GraphView` re-heats a re-sort with.
 *
 * Kept in step with the component on purpose. A re-sort has a fixed budget of
 * roughly 300 ticks before d3 declares itself finished, and the question these
 * tests exist to answer is whether that is enough for a film to cross the map to
 * a hub at the other end — so testing a more generous run than the product gives
 * itself would answer a question nobody asked.
 */
const RESORT_ALPHA = 0.9;

/** Runs a simulation to rest exactly as the animated path does, minus the clock. */
function animate(simulation: Simulation<LayoutNode, LayoutEdge>, alpha: number): number {
  simulation.stop().alpha(alpha);
  let ticks = 0;
  while (simulation.alpha() > simulation.alphaMin()) {
    simulation.tick(1);
    ticks++;
  }
  return ticks;
}

interface Placement {
  /** Films whose nearest hub is one they actually belong to. */
  readonly correct: number;
  readonly total: number;
  /** Distance from each film to its own hub, for reading cluster tightness. */
  readonly spread: { readonly min: number; readonly max: number };
}

/**
 * How well a settled layout reflects the graph.
 *
 * "Beside its own hub" is the whole promise of the map: a film's position is
 * supposed to be a claim about what it belongs to. If the nearest hub to a film
 * is not one of its own, the picture is lying about that film — and no amount of
 * correct edge data fixes it, because the reader sees position long before they
 * trace a line.
 */
function placement(nodes: readonly LayoutNode[], memberships: ReadonlyMap<string, Set<string>>): Placement {
  const at = new Map(nodes.map((node) => [node.id, node]));
  const hubs = nodes.filter((node) => node.kind === "hub");

  let correct = 0;
  let total = 0;
  let min = Infinity;
  let max = 0;

  for (const node of nodes) {
    if (node.kind !== "film") continue;
    const own = memberships.get(node.id);
    if (!own || own.size === 0) continue;
    total++;

    let nearest = { id: "", distance: Infinity };
    for (const hub of hubs) {
      const distance = Math.hypot(hub.x - node.x, hub.y - node.y);
      if (distance < nearest.distance) nearest = { id: hub.id, distance };
    }
    if (own.has(nearest.id)) correct++;

    // Measured against the closest hub the film does belong to, since a film on
    // the watch-year axis can legitimately belong to two.
    let ownDistance = Infinity;
    for (const id of own) {
      const hub = at.get(id);
      if (hub) ownDistance = Math.min(ownDistance, Math.hypot(hub.x - node.x, hub.y - node.y));
    }
    min = Math.min(min, ownDistance);
    max = Math.max(max, ownDistance);
  }

  return { correct, total, spread: { min, max } };
}

/** Which hubs each film belongs to, read back off the graph's membership edges. */
function membershipsOf(edges: readonly { kind: string; source: string; target: string }[]) {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.kind !== "membership") continue;
    const set = map.get(edge.source) ?? new Set<string>();
    set.add(edge.target);
    map.set(edge.source, set);
  }
  return map;
}

const AXES = [
  { name: "decade", strategy: byDecade },
  { name: "rating", strategy: byRating },
  { name: "watch year", strategy: byWatchYear },
];

for (const axis of AXES) {
  test(`a fresh ${axis.name} layout puts every film beside its own hub`, () => {
    const graph = buildGraph(demoLibrary(), axis.strategy);
    const layout = createLayout(graph, WIDTH, HEIGHT);
    settle(layout.simulation);

    const result = placement(layout.nodes, membershipsOf(graph.edges));
    assert.ok(result.total > 0, "the demo library should produce films to place");
    assert.equal(
      result.correct,
      result.total,
      `${result.total - result.correct} of ${result.total} films settled nearer a hub they do not belong to`,
    );
  });
}

/*
  Switching axes seeds every film at its old position so the change reads as the
  same films re-sorting rather than a new picture cutting in. That makes the
  re-sort strictly harder than a first build: a film may be seeded at the far end
  of the map from the hub it now belongs to, and it has one fixed budget of energy
  to get there through every cluster in between.

  So it is held to exactly the same standard as a fresh layout. A re-arrangement
  that leaves films parked beside the wrong hub is not a re-arrangement, and it
  would be a particularly quiet failure: the edges would still be correct, the map
  would still look composed, and only someone tracing a line would find out.
*/
test("a re-sort carries films to their new hubs within its animation budget", () => {
  const library = demoLibrary();

  const decade = buildGraph(library, byDecade);
  const before = createLayout(decade, WIDTH, HEIGHT);
  settle(before.simulation);

  const rating = buildGraph(library, byRating);
  const after = createLayout(rating, WIDTH, HEIGHT, positionsOf(before.nodes));
  assert.ok(after.seeded, "the re-sort should start from the previous positions");
  animate(after.simulation, RESORT_ALPHA);

  const result = placement(after.nodes, membershipsOf(rating.edges));
  assert.equal(
    result.correct,
    result.total,
    `${result.total - result.correct} of ${result.total} films stranded beside the wrong hub after a re-sort`,
  );
});

test("a re-sort ends up where a fresh layout would, not somewhere else", () => {
  const library = demoLibrary();
  const rating = buildGraph(library, byRating);

  const fresh = createLayout(rating, WIDTH, HEIGHT);
  settle(fresh.simulation);

  const decade = createLayout(buildGraph(library, byDecade), WIDTH, HEIGHT);
  settle(decade.simulation);
  const resorted = createLayout(rating, WIDTH, HEIGHT, positionsOf(decade.nodes));
  animate(resorted.simulation, RESORT_ALPHA);

  /*
    Not the same coordinates — the path taken through a force simulation does
    affect where inside a cluster a film lands, and demanding otherwise would be
    testing d3 rather than EIGA. What must match is the reading: the same films
    around the same hubs, at a comparable distance. Compared loosely so this
    fails on a structural regression rather than on tuning.
  */
  const a = placement(fresh.nodes, membershipsOf(rating.edges));
  const b = placement(resorted.nodes, membershipsOf(rating.edges));
  assert.equal(b.correct, a.correct);
  assert.ok(
    b.spread.max < a.spread.max * 2,
    `re-sorted clusters are far looser than fresh ones (${Math.round(b.spread.max)} vs ${Math.round(a.spread.max)})`,
  );
});

test("hubs are placed left to right in axis order", () => {
  const graph = buildGraph(demoLibrary(), byRating);
  const layout = createLayout(graph, WIDTH, HEIGHT);
  settle(layout.simulation);

  const at = new Map(layout.nodes.map((node) => [node.id, node]));
  const xs = orderedHubs(graph).map((hub) => at.get(hub.id)?.x ?? NaN);

  for (let i = 1; i < xs.length; i++) {
    assert.ok(
      xs[i] > xs[i - 1],
      `hub ${i} sits at x=${Math.round(xs[i])}, left of its predecessor at ${Math.round(xs[i - 1])}`,
    );
  }
});

test("the same library always settles into the same map", () => {
  const graph = buildGraph(demoLibrary(), byDecade);

  const once = createLayout(graph, WIDTH, HEIGHT);
  settle(once.simulation);
  const twice = createLayout(graph, WIDTH, HEIGHT);
  settle(twice.simulation);

  // No Math.random anywhere in the layout, so this is exact, not approximate.
  assert.deepEqual(positionsOf(once.nodes), positionsOf(twice.nodes));
});
