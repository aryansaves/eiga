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
import { buildGraph, byDecade, byRating, byWatchYear, orderedHubs, type GraphNode } from "../graph/build.ts";
import { buildThread, unthreaded } from "../graph/thread.ts";
import {
  clusterReach,
  createLayout,
  fitToFrame,
  FRAME_INSET,
  positionsOf,
  settle,
  YEAR_LABEL_GAP,
  YEAR_WIDTH,
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

/* --- The diary timeline -------------------------------------------------- */

/**
 * A library shaped like the export this was built against: 124 films, 114 of them
 * dated across 102 distinct days, ten with no date at all.
 *
 * Dates are eight days apart so the 102 days span three calendar years, which is
 * what gives the row stack and the year-boundary links something to be tested
 * against. Sharing a day every ninth film turns 114 dated films into 102 days — the
 * twelve knots that make the timeline's crowded case the normal one here rather than
 * a special test.
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

/** A settled timeline, and the exact place the calendar asked each film to sit. */
function timeline(library: Library = diaryLibrary()) {
  const graph = buildThread(library);
  const layout = createLayout(graph, WIDTH, HEIGHT);
  settle(layout.simulation);

  const rowFor = new Map(layout.rows.map((row) => [row.year, row]));
  /**
   * Where the calendar put a film, before the forces had their say.
   *
   * Recomputed from `when` rather than read off `anchorX`, deliberately: `anchorX`
   * is what the layout decided, and a test that measured a settled map against the
   * layout's own decision would pass however wrong that decision was. This is the
   * arithmetic the *map* claims — left edge plus fraction of a year — written out
   * independently.
   */
  const ideal = (node: GraphNode) => {
    if (node.when === null) return null;
    const row = rowFor.get(node.when.year);
    if (row === undefined) return null;
    return { x: row.left + node.when.through * YEAR_WIDTH, y: row.y };
  };

  return { graph, layout, rowFor, ideal };
}

/** How many pixels one day of the calendar is worth, for reporting drift. */
const DAY_PX = YEAR_WIDTH / 365;

test("the rows are the calendar: one per year, oldest at the top, all the same span", () => {
  const { graph, layout } = timeline();

  assert.deepEqual(
    layout.rows.map((row) => row.year),
    [2023, 2024, 2025],
    "the diary spans three years, so it should carry three rows",
  );
  assert.deepEqual(layout.rows.map((row) => row.year), [...graph.years]);

  for (let i = 1; i < layout.rows.length; i += 1) {
    assert.ok(
      layout.rows[i].y > layout.rows[i - 1].y,
      `${layout.rows[i].year} is drawn above ${layout.rows[i - 1].year}`,
    );
  }

  /*
    Every row starts and ends at the same x, and that is the whole reason the years
    are stacked rather than run end to end: it is what puts February under February
    in every row. A row scaled to the films it happens to hold would look tidier and
    would make the columns mean nothing.
  */
  for (const row of layout.rows) {
    assert.equal(row.left, layout.rows[0].left);
    assert.equal(row.right, layout.rows[0].left + YEAR_WIDTH);
    assert.equal(row.months.length, 12);
    assert.equal(row.months[0], row.left, "January starts at the left end of the row");
  }

  /*
    And the month ticks line up across rows to within a leap day — which is the
    honest limit, not a tolerance for sloppiness. 2024 has a 29th of February, so
    every tick after it sits a day earlier in fractional terms than in 2023. Held
    to two days' width so a regression to even twelfths, which is out by five, fails.
  */
  for (const row of layout.rows) {
    for (let month = 0; month < 12; month += 1) {
      const drift = Math.abs(row.months[month] - layout.rows[0].months[month]);
      assert.ok(
        drift < 2 * DAY_PX,
        `month ${month + 1} of ${row.year} is ${(drift / DAY_PX).toFixed(1)} days out of column`,
      );
    }
  }
});

/*
  The claim the whole map rests on, and the one the spiral it replaced could not
  make: a film's horizontal position *is* the day it was watched. Everything else
  here — the graticule, the row stack, the month ticks — is only meaningful if this
  holds on a settled map rather than on the anchors.
*/
test("a film settles on the day it was watched, not merely near it", () => {
  const { graph, layout, ideal } = timeline();
  const at = new Map(layout.nodes.map((node) => [node.id, node]));

  let worst = { off: 0, id: "" };
  let total = 0;
  let counted = 0;
  for (const node of graph.nodes) {
    const target = ideal(node);
    if (target === null) continue;
    const settled = at.get(node.id);
    assert.ok(settled, `${node.id} was not laid out`);
    const off = Math.abs(settled.x - target.x);
    if (off > worst.off) worst = { off, id: node.id };
    total += off;
    counted += 1;
  }

  assert.equal(counted, 114);
  /*
    Two days is the bar because a week is the unit the map is read in: a film pushed
    a week sideways by its neighbours has changed which part of a month it belongs
    to, and the reader has no way to know. Not a fitted number — the drift lands well
    inside this — but recorded so that loosening `PLACE_PULL_X`, or letting a
    many-body force back onto this map, fails here rather than being noticed by eye
    a year later.
  */
  assert.ok(
    worst.off < 2 * DAY_PX,
    `${worst.id} settled ${(worst.off / DAY_PX).toFixed(1)} days from the date it was watched`,
  );
  assert.ok(
    total / counted < DAY_PX,
    `films average ${(total / counted / DAY_PX).toFixed(2)} days off their date`,
  );
});

test("no film settles nearer another year's row than its own", () => {
  /*
    The timeline's version of "beside its own hub". Height inside a row is free —
    it is how a binge opens out into something legible — but only up to the point
    where a film is nearer the row above or below, at which point the map has
    quietly moved it to a different year. Measured as the nearest row rather than as
    a distance, because that is what the reader actually does.
  */
  const { graph, layout, ideal } = timeline();
  const at = new Map(layout.nodes.map((node) => [node.id, node]));

  for (const node of graph.nodes) {
    if (node.when === null) continue;
    const settled = at.get(node.id);
    const target = ideal(node);
    if (!settled || target === null) continue;

    let nearest = { year: 0, distance: Infinity };
    for (const row of layout.rows) {
      const distance = Math.abs(settled.y - row.y);
      if (distance < nearest.distance) nearest = { year: row.year, distance };
    }
    assert.equal(
      nearest.year,
      node.when.year,
      `${node.id} was watched in ${node.when.year} but settled nearest the ${nearest.year} row`,
    );
  }
});

test("films with no date sit below the calendar, not inside it", () => {
  /*
    They have to be somewhere, and every position inside the calendar means a date.
    Below the last row is the only placement that does not assert something false —
    and it has to be *entirely* below, since a single undated film level with the
    final row would read as something watched this year.
  */
  const { graph, layout } = timeline();
  const at = new Map(layout.nodes.map((node) => [node.id, node]));
  const yOf = (id: string) => at.get(id)?.y ?? NaN;

  const undated = unthreaded(graph).map((node) => yOf(node.id));
  const dated = graph.nodes
    .filter((node) => node.when !== null)
    .map((node) => yOf(node.id));

  assert.equal(undated.length, 10);
  assert.ok(
    Math.min(...undated) > Math.max(...dated),
    `an undated film settled at y=${Math.min(...undated).toFixed(0)}, level with a dated one at y=${Math.max(...dated).toFixed(0)}`,
  );
});

test("a hub map carries no year rows", () => {
  // Rows are the timeline's scale. A hub map has no chronology to lay out, and a
  // stray rule under a decade cluster would be measuring the wrong thing.
  const layout = createLayout(buildGraph(diaryLibrary(), byDecade), WIDTH, HEIGHT);
  assert.deepEqual(layout.rows, []);
});

test("framing keeps January and December on screen", () => {
  /*
    The reason `fitToFrame` takes the rows at all. Films rarely reach either end of
    a year, so framing the dots alone would leave the graticule running off both
    edges — and a rule cut off at the edge of the viewport reads as a rendering
    fault, not as a map. The year labels in the left margin are in the same claim.
  */
  const { layout } = timeline();
  const fit = fitToFrame(layout.nodes, WIDTH, HEIGHT, layout.rows);
  const onScreen = (x: number) => fit.x + fit.k * x;

  const row = layout.rows[0];
  assert.ok(onScreen(row.left - YEAR_LABEL_GAP) > 0, "the year labels are off the left edge");
  assert.ok(onScreen(row.right) < WIDTH, "December runs off the right edge");

  /*
    And it opens at 1×, which is what `YEAR_WIDTH` was chosen for rather than a
    happy accident: `labels.ts` prints nothing below 0.5×, so a three-year diary
    opening at full scale is a map that opens *with titles on it*. The straight
    single-row ribbon this replaced ran to some 2,600px and opened at 0.49×.
  */
  assert.equal(fit.k, 1, "a three-year diary should open at full scale");

  /*
    That cap is also why the rows' effect on the frame has to be measured somewhere
    the scale is free to move. Squeezed into a narrow window the rows are what sets
    the width — if these ever came out equal the rows would be having no effect and
    the assertions above would be passing by luck.
  */
  const narrow = 700;
  const withRows = fitToFrame(layout.nodes, narrow, HEIGHT, layout.rows);
  const dotsOnly = fitToFrame(layout.nodes, narrow, HEIGHT);
  assert.ok(
    withRows.k < dotsOnly.k,
    `the rows did not widen the frame (${withRows.k.toFixed(3)} vs ${dotsOnly.k.toFixed(3)} for the dots alone)`,
  );
});

test("framing one search match centres it without magnifying it", () => {
  /*
    The framing a search does — `GraphView` calls `fitToFrame` over the lit films
    alone, with no rows, because it is taking the user to the films rather than to
    the calendar under them.

    One match is the case that has to be pinned. A single film's extent is its own
    diameter, some 13px, so an uncapped fit into a 1128px frame would be about 87×:
    one dot the width of the screen, with its title rendered at a tenth of a pixel
    by the counter-scaling in globals.css. The cap inside `fitToFrame` is what
    stands between that and a usable map, and nothing else in the search path
    re-checks it.
  */
  const { layout } = timeline();
  const one = layout.nodes.filter((node) => node.kind === "film").slice(0, 1);

  const fit = fitToFrame(one, WIDTH, HEIGHT);
  assert.equal(fit.k, 1, "a single match should be framed at 1×, not magnified");

  /*
    And it should be *centred* in the frame, not merely on screen — the whole point
    is that the user does not have to hunt for the dot that just lit up. The frame
    is asymmetric, so the centre it lands on is the middle of the usable box rather
    than the middle of the viewport.
  */
  const usableWidth = WIDTH - FRAME_INSET.left - FRAME_INSET.right;
  const usableHeight = HEIGHT - FRAME_INSET.top - FRAME_INSET.bottom;
  assert.ok(
    Math.abs(fit.x + one[0].x - (FRAME_INSET.left + usableWidth / 2)) < 1,
    "the match is not horizontally centred",
  );
  assert.ok(
    Math.abs(fit.y + one[0].y - (FRAME_INSET.top + usableHeight / 2)) < 1,
    "the match is not vertically centred",
  );

  /*
    Several matches spread over the calendar are a wider extent than one, so they
    must not come out framed more tightly. Below 1× this is the only thing keeping
    the second match on screen, and above it the cap makes both answers 1 — which is
    why this is `<=` and not `<`.
  */
  const many = layout.nodes.filter((node) => node.kind === "film").slice(0, 12);
  assert.ok(
    fitToFrame(many, WIDTH, HEIGHT).k <= fit.k,
    "twelve matches were framed closer than one",
  );
});

test("a single-year library still gets a full row", () => {
  /*
    The degenerate case, and the one most libraries actually are for their first
    year. One row is a legitimate map — a year is a scale whether or not there is
    another to compare it to — so the row must still span the whole calendar rather
    than shrink to the films on it.
  */
  const library = diaryLibrary();
  const within = {
    ...library,
    watches: library.watches.filter((watch) => watch.watchedOn?.startsWith("2023")),
  };

  const layout = createLayout(buildThread(within), WIDTH, HEIGHT);
  settle(layout.simulation);

  assert.deepEqual(layout.rows.map((row) => row.year), [2023]);
  assert.equal(layout.rows[0].right - layout.rows[0].left, YEAR_WIDTH);
  assert.ok(
    fitToFrame(layout.nodes, WIDTH, HEIGHT, layout.rows).k <= 1,
    "a one-row map should not be blown up past 1×",
  );
});

test("the same diary always settles into the same timeline", () => {
  const graph = buildThread(diaryLibrary());

  const once = createLayout(graph, WIDTH, HEIGHT);
  settle(once.simulation);
  const twice = createLayout(graph, WIDTH, HEIGHT);
  settle(twice.simulation);

  /*
    Exact, like the hub-map case, and worth having twice over: d3-force separates
    two *exactly* coincident nodes with a random nudge, and the timeline is the one
    topology that deliberately puts several films on one point. This is the
    assertion that would catch a knot losing its determinism.
  */
  assert.deepEqual(positionsOf(once.nodes), positionsOf(twice.nodes));
  assert.deepEqual(once.rows, twice.rows);
});
