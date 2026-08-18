import test from "node:test";
import assert from "node:assert/strict";

import { demoLibrary } from "../domain/demo.ts";
import {
  RATING_MIN,
  RATING_STEP,
  type Film,
  type FilmId,
  type Library,
  type WatchEvent,
} from "../domain/types.ts";
import { buildGraph, byDecade, byRating, byWatchYear, orderedHubs } from "../graph/build.ts";
import { buildThread, unthreaded } from "../graph/thread.ts";
import {
  clusterReach,
  createLayout,
  positionsOf,
  settle,
  spiralPoint,
  STEP,
  TURN_GAP,
  type LayoutEdge,
  type LayoutNode,
} from "./layout.ts";
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

/* --- Room for the clusters ------------------------------------------------ */

/**
 * `films` films spread evenly across `hubs` calendar years.
 *
 * Hub *count* is the variable that matters, and the watch-year axis is the one
 * where a real user supplies it: someone who has logged since 2011 has fifteen
 * years, and nothing about that library is unusual.
 */
function bucketed(films: number, hubs: number): Library {
  const list: Film[] = [];
  const watches: WatchEvent[] = [];
  const ratings = new Map<FilmId, number>();

  for (let i = 0; i < films; i += 1) {
    const id = `f${String(i).padStart(4, "0")}`;
    list.push({ id, title: `Film ${i}`, year: 1990, uri: null, directors: [] });
    // Every band, so dot radii vary across the full range as they do live.
    ratings.set(id, RATING_MIN + (i % 10) * RATING_STEP);
    watches.push({ filmId: id, watchedOn: `${2010 + (i % hubs)}-06-15`, rewatch: false });
  }

  return { films: list, watches, ratings, reviews: new Map(), likes: new Set() };
}

/*
  The assertion that would have caught it, and the reason it is written against hub
  count rather than film count.

  Spacing used to fit a fixed band to the viewport, so the step between hubs shrank
  as hubs were added: twenty watch years across a 900px band left 47px between them,
  clusters interpenetrated, and *102 of 500 films* settled nearer a hub they did not
  belong to. The map still looked composed and every edge was still correct, which is
  what made it quiet.

  Note what is deliberately *not* the assertion here: whether two dots overlap inside
  a cluster. They never did — charge and collide already scale a cluster with its
  degree — so that test would have passed on the broken layout and pinned nothing.
  It is kept below anyway, but as a guard on collide, not as the measure of this.
*/
for (const [films, hubs] of [
  [124, 15],
  [500, 20],
] as const) {
  test(`${films} films across ${hubs} hubs all stay beside their own hub`, () => {
    const graph = buildGraph(bucketed(films, hubs), byWatchYear);
    const layout = createLayout(graph, WIDTH, HEIGHT);
    settle(layout.simulation);

    const result = placement(layout.nodes, membershipsOf(graph.edges));
    assert.equal(result.total, films);
    assert.equal(
      result.correct,
      result.total,
      `${result.total - result.correct} of ${result.total} films settled nearer a hub they do not belong to`,
    );
  });
}

test("hubs are given room for the clusters they hold, not an even share", () => {
  /*
    Checked on the anchors rather than on where the hubs settle, because the anchors
    are the claim this makes: charge then pushes hubs further apart than their
    anchors, so a settled map would pass on spacing the layout never asked for.

    Every pair, not just neighbours. Adjacent hubs are staggered above and below the
    centre line and so get their separation partly for free; hubs *two* apart sit on
    the same side with nothing between them, and that is where the overlap always
    showed up — hub 4 against hub 6, never 4 against 5.
  */
  const graph = buildGraph(bucketed(500, 20), byWatchYear);
  const layout = createLayout(graph, WIDTH, HEIGHT);
  const at = new Map(layout.nodes.map((node) => [node.id, node]));

  const hubs = orderedHubs(graph)
    .map((hub) => at.get(hub.id))
    .filter((hub): hub is LayoutNode => hub !== undefined);
  assert.equal(hubs.length, 20);

  for (let a = 0; a < hubs.length; a += 1) {
    for (let b = a + 1; b < hubs.length; b += 1) {
      const apart = Math.hypot(
        hubs[b].anchorX - hubs[a].anchorX,
        hubs[b].anchorY - hubs[a].anchorY,
      );
      const need = clusterReach(hubs[a].degree) + clusterReach(hubs[b].degree);
      assert.ok(
        apart >= need,
        `hubs ${a} and ${b} are anchored ${apart.toFixed(0)}px apart but reach ${need.toFixed(0)}px between them`,
      );
    }
  }
});

test("no two dots overlap inside a cluster", () => {
  /*
    A guard on `forceCollide`, which is what actually keeps dots apart — dropping it
    or letting the membership link overpower it would make a large cluster a solid
    blob, and no other test here would notice. Measured on the largest single cluster
    a real library produces, at the tightest zoom the map is ever drawn at.
  */
  const graph = buildGraph(bucketed(124, 3), byWatchYear);
  const layout = createLayout(graph, WIDTH, HEIGHT);
  settle(layout.simulation);

  const owns = membershipsOf(graph.edges);
  const films = layout.nodes.filter((node) => node.kind === "film");

  let worst = { gap: Infinity, pair: "" };
  for (let i = 0; i < films.length; i += 1) {
    for (let j = i + 1; j < films.length; j += 1) {
      // Only within a cluster: two films from different years may legitimately
      // pass close where the clusters meet.
      const shared = [...(owns.get(films[i].id) ?? [])].some((hub) =>
        owns.get(films[j].id)?.has(hub),
      );
      if (!shared) continue;

      const gap =
        Math.hypot(films[i].x - films[j].x, films[i].y - films[j].y) -
        films[i].radius -
        films[j].radius;
      if (gap < worst.gap) worst = { gap, pair: `${films[i].id} and ${films[j].id}` };
    }
  }

  assert.ok(
    worst.gap > 0,
    `${worst.pair} overlap by ${(-worst.gap).toFixed(1)}px in the same cluster`,
  );
});

/* --- The diary thread ---------------------------------------------------- */

/**
 * A library shaped like the export this was built against: 124 films, 114 of them
 * dated across 102 distinct days, ten with no date at all.
 *
 * Dates are eight days apart so the 102 steps span three calendar years, which is
 * what gives the year marks something to be tested against. Sharing a day every
 * ninth film turns 114 dated films into 102 steps — the twelve knots that make the
 * spiral's crowded case the normal one here rather than a special test.
 */
function diaryLibrary(): Library {
  const films: Film[] = [];
  const watches: WatchEvent[] = [];
  const ratings = new Map<FilmId, number>();

  let day = 0;
  for (let i = 0; i < 124; i += 1) {
    const id = `f${String(i).padStart(3, "0")}`;
    films.push({ id, title: `Film ${i}`, year: 1970 + (i % 50), uri: null, directors: [] });
    // Every rating band, so film radii vary as they do in a real library.
    ratings.set(id, RATING_MIN + (i % 10) * RATING_STEP);

    if (i >= 114) continue;
    if (i > 0 && i % 9 !== 0) day += 1;
    watches.push({ filmId: id, watchedOn: dayString(day), rewatch: false });
  }

  return { films, watches, ratings, reviews: new Map(), likes: new Set() };
}

const DAY_MS = 86_400_000;

/** The nth diary date, eight days after the one before it. */
function dayString(n: number): string {
  return new Date(Date.UTC(2023, 0, 1) + n * 8 * DAY_MS).toISOString().slice(0, 10);
}

/** A settled thread, and the ideal curve it was supposed to follow. */
function thread() {
  const graph = buildThread(diaryLibrary());
  const layout = createLayout(graph, WIDTH, HEIGHT);
  settle(layout.simulation);

  const centre = { x: WIDTH / 2, y: HEIGHT / 2 };
  const ideal = (step: number) => {
    const point = spiralPoint(step);
    return { x: centre.x + point.x, y: centre.y + point.y, r: point.r };
  };
  return { graph, layout, centre, ideal };
}

/*
  The two geometric properties that make the spiral legible, tested on the pure
  function rather than on a settled map: if the curve itself is wrong, no amount of
  force tuning saves the reading, and a failure here should say so plainly instead
  of surfacing as a layout that looks slightly off.
*/
test("consecutive days sit an even distance apart along the thread", () => {
  /*
    The property that makes the spiral a scale. An Archimedean spiral stepped by
    *angle* instead would crowd the first year of a diary into the middle and fling
    the last one around the rim, and the map would be claiming that the user's
    watching accelerated.
  */
  for (let step = 0; step < 200; step += 1) {
    const a = spiralPoint(step);
    const b = spiralPoint(step + 1);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);

    /*
      Chord rather than arc, because the chord is what the drawn edge between two
      days actually is. It falls slightly short of `STEP` near the centre where the
      curve bends hardest, which is the only reason for a tolerance at all.
    */
    assert.ok(
      Math.abs(chord - STEP) < 0.5,
      `step ${step} is ${chord.toFixed(2)}px from the next, not ${STEP}`,
    );
  }
});

test("each turn of the thread clears the last by a full turn gap", () => {
  /*
    The property that keeps two passes of the thread from reading as one thick
    band. Measured by angle rather than by step, since the turn above a given step
    generally falls between two steps: `r` is linear in the angle, so interpolating
    a radius at a matched angle is exact rather than approximate.
  */
  const points = Array.from({ length: 240 }, (_, step) => spiralPoint(step));

  let compared = 0;
  for (const from of points) {
    const target = from.theta + 2 * Math.PI;
    const next = points.findIndex((point) => point.theta >= target);
    if (next <= 0) continue;

    const before = points[next - 1];
    const after = points[next];
    const t = (target - before.theta) / (after.theta - before.theta);
    const radius = before.r + t * (after.r - before.r);

    assert.ok(
      Math.abs(radius - from.r - TURN_GAP) < 0.01,
      `a turn out from r=${from.r.toFixed(1)} lands at ${radius.toFixed(1)}, not ${(from.r + TURN_GAP).toFixed(1)}`,
    );
    compared += 1;
  }
  assert.ok(compared > 50, `only ${compared} turns were actually compared`);
});

test("the settled thread stays faithful to the curve it was seeded on", () => {
  /*
    The forces are allowed to nudge a film off its ideal point — that wander is
    what keeps the map from reading as a plotted figure — but only so far. Half a
    turn gap is the limit that matters: past it a film is nearer the neighbouring
    pass of the thread than its own, and the reader assigns it to the wrong stretch
    of the diary. Not a fitted number; the bound below it is where it happens to
    land, recorded so a regression shows up as a jump rather than as a slow drift.
  */
  const { graph, layout, ideal } = thread();
  const at = new Map(layout.nodes.map((node) => [node.id, node]));

  let worst = 0;
  let total = 0;
  let counted = 0;
  for (const node of graph.nodes) {
    if (node.order === null) continue;
    const settled = at.get(node.id);
    assert.ok(settled, `${node.id} was not laid out`);
    const target = ideal(node.order);
    const off = Math.hypot(settled.x - target.x, settled.y - target.y);
    worst = Math.max(worst, off);
    total += off;
    counted += 1;
  }

  assert.equal(counted, 114);
  assert.ok(
    worst < TURN_GAP / 2,
    `a film settled ${worst.toFixed(1)}px from its day, past the ${TURN_GAP / 2}px point where it reads as the turn next door`,
  );
  // Loose enough not to be a tuning tripwire, tight enough to catch the spiral
  // being abandoned altogether.
  assert.ok(total / counted < 12, `films average ${(total / counted).toFixed(1)}px off the curve`);
});

test("the thread reads outward, oldest in the middle", () => {
  /*
    Tested a turn at a time rather than step by step. At the rim a single day
    advances the radius by about a pixel, well inside the wander, so consecutive
    films legitimately swap places — but a whole turn never does, and "later means
    further out" is the one claim the picture makes about time.
  */
  const { graph, layout, centre } = thread();
  const at = new Map(layout.nodes.map((node) => [node.id, node]));

  const turns = new Map<number, number[]>();
  for (const node of graph.nodes) {
    if (node.order === null) continue;
    const settled = at.get(node.id);
    if (!settled) continue;
    const turn = Math.floor(spiralPoint(node.order).theta / (2 * Math.PI));
    const radii = turns.get(turn) ?? [];
    radii.push(Math.hypot(settled.x - centre.x, settled.y - centre.y));
    turns.set(turn, radii);
  }

  const mean = [...turns.keys()]
    .sort((a, b) => a - b)
    .map((turn) => {
      const radii = turns.get(turn) ?? [];
      return radii.reduce((sum, r) => sum + r, 0) / radii.length;
    });

  assert.ok(mean.length >= 4, `expected several turns, got ${mean.length}`);
  for (let i = 1; i < mean.length; i += 1) {
    assert.ok(
      mean[i] > mean[i - 1],
      `turn ${i} settled at mean r=${mean[i].toFixed(1)}, inside turn ${i - 1} at ${mean[i - 1].toFixed(1)}`,
    );
  }
});

test("films with no date sit outside the thread, not among it", () => {
  /*
    They have to be somewhere, and every position inside the spiral means a date.
    Outside is the only placement that does not assert something false — and it has
    to be *entirely* outside, since a single undated film among the last turn would
    read as the most recent thing watched.
  */
  const { graph, layout, centre } = thread();
  const at = new Map(layout.nodes.map((node) => [node.id, node]));
  const radiusOf = (id: string) => {
    const node = at.get(id);
    return node ? Math.hypot(node.x - centre.x, node.y - centre.y) : NaN;
  };

  const undated = unthreaded(graph).map((node) => radiusOf(node.id));
  const dated = graph.nodes
    .filter((node) => node.order !== null)
    .map((node) => radiusOf(node.id));

  assert.equal(undated.length, 10);
  assert.ok(
    Math.min(...undated) > Math.max(...dated),
    `an undated film settled at r=${Math.min(...undated).toFixed(0)}, inside the last dated film at r=${Math.max(...dated).toFixed(0)}`,
  );
});

test("each calendar year is marked once, on the curve, in order", () => {
  const { graph, layout, ideal } = thread();

  assert.deepEqual(
    layout.marks.map((mark) => mark.year),
    [2023, 2024, 2025],
    "the diary spans three years, so it should carry three marks",
  );

  const steps = graph.yearStarts.map((start) => start.step);
  layout.marks.forEach((mark, index) => {
    /*
      Marks sit on the ideal curve rather than on a settled node: they are a
      graticule, and a graticule that drifted with the terrain would be measuring
      nothing. Which also means they can be compared exactly.
    */
    const target = ideal(steps[index]);
    assert.equal(mark.x, target.x);
    assert.equal(mark.y, target.y);
    if (index > 0) {
      const previous = ideal(steps[index - 1]);
      assert.ok(
        target.r > previous.r,
        `${mark.year} is marked inside ${layout.marks[index - 1].year}`,
      );
    }
  });
});

test("a hub map carries no year marks", () => {
  // Years are the thread's scale. A hub map has no chronology to mark, and a
  // stray tick over a decade cluster would be measuring the wrong thing.
  const layout = createLayout(buildGraph(diaryLibrary(), byDecade), WIDTH, HEIGHT);
  assert.deepEqual(layout.marks, []);
});

test("the same diary always settles into the same thread", () => {
  const graph = buildThread(diaryLibrary());

  const once = createLayout(graph, WIDTH, HEIGHT);
  settle(once.simulation);
  const twice = createLayout(graph, WIDTH, HEIGHT);
  settle(twice.simulation);

  /*
    Exact, like the hub-map case, and worth having twice over: d3-force separates
    two *exactly* coincident nodes with a random nudge, and the thread is the one
    topology that deliberately puts several films on one point. This is the
    assertion that would catch a knot losing its determinism.
  */
  assert.deepEqual(positionsOf(once.nodes), positionsOf(twice.nodes));
});
