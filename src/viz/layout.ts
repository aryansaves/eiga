/**
 * Force layout.
 *
 * D3 owns coordinates; nothing else does. This module takes a `Graph`, hands
 * d3-force its own mutable copies of the nodes, and exposes the simulation. No
 * React, no DOM.
 *
 * There are three authored geometries here, one per topology, and in every case
 * the authoring is the point: left to itself d3-force produces a symmetric blob
 * with no reading order, which is a picture of nothing.
 *
 * **The timeline** — the default map — is the calendar itself. One row per year,
 * stacked oldest at the top; a film's horizontal place is the day it was seen and
 * nothing else, so the same week sits under the same month tick in every row and a
 * dormant spring is visible as empty rule. See `calendarRows` for the geometry, and
 * `graph/thread.ts` for why this replaced a spiral that spaced films by their
 * place in a queue.
 *
 * **The discovery tree** borrows that grammar and re-labels both axes: across is
 * still the day a film was seen, but the whole watch history now fits one span
 * instead of folding into years, and a row is a *release decade* rather than a
 * calendar year. So a limb reaching down the rows is a viewing life reaching back
 * through film history, which is the reading `graph/tree.ts` builds the branching
 * for. See `decadeBands` and `timeScale`.
 *
 * **A hub map** pins hubs along a staggered horizontal band in *axis* order and
 * seeds films beside their hub. On an ordinal axis that reads left-to-right
 * through the scale — decades through time, ratings low to high; on a nominal axis
 * the order is alphabetical, which is arbitrary but stable. How far apart they sit
 * follows how far their clusters reach rather than how wide the window is, and the
 * stagger is part of that arithmetic rather than a flourish — see `hubAnchors`. The
 * graph's own spine edges are laid over that as a slack tether: the anchors do the
 * placing, because deterministic placement is worth more than an organic chain, and
 * the tether only stops the ends of a long scale from drifting apart.
 *
 * None of the three is a plotted figure. A layout that placed every node exactly
 * would be a diagram, so each is given a reason to be irregular — the hub map by
 * anchoring films only faintly and letting their neighbours shoulder them around,
 * the two film-to-film maps by scattering films *within* their row. The mechanisms
 * differ because where an axis carries a date the other axis carries nothing: a
 * film nudged sideways would be claiming the wrong day, so it is only ever nudged
 * up and down. See `ROW_WANDER`.
 *
 * Seeding is deterministic — no `Math.random` — so the same library always
 * settles into recognisably the same map, and a reload does not shuffle a place
 * the user had started to learn.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import { monthStarts } from "../domain/calendar.ts";
import {
  decadeFromYear,
  decadeLabel,
  RATING_MAX,
  RATING_MIN,
} from "../domain/types.ts";
import { orderedHubs, type Graph, type GraphEdgeKind, type GraphNode } from "../graph/build.ts";

export interface LayoutNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  /** Drawn radius. Films encode rating; hubs encode how many films they hold. */
  readonly radius: number;
  /** Where the node wants to sit. Hubs are placed; films drift around them. */
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface LayoutEdge extends SimulationLinkDatum<LayoutNode> {
  readonly id: string;
  readonly kind: GraphEdgeKind;
  /** A node id before the simulation initialises, the node itself after. */
  source: string | LayoutNode;
  target: string | LayoutNode;
}

export interface LayoutHandle {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly simulation: Simulation<LayoutNode, LayoutEdge>;
  /**
   * The graticule rows: calendar years on the timeline, release decades on the
   * tree. Empty on a hub map, which has no scale to read along.
   *
   * Fixed geometry, not simulated: the rows are the scale and the films settle
   * against them, which is exactly the relationship a printed map has between its
   * graticule and its terrain. A graticule that drifted with the terrain would be
   * measuring nothing.
   */
  readonly rows: readonly MapRow[];
  /**
   * Whether any node started from a previous position.
   *
   * The caller uses this to decide between settling silently and animating: a
   * seeded layout is the same map being re-drawn, so the movement is the point.
   * An unseeded one is a map appearing for the first time, where watching it
   * assemble is a loading screen pretending to be an insight.
   */
  readonly seeded: boolean;
}

/** Where a node was before the graph changed, so it can migrate rather than jump. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

const FILM_RADIUS_MIN = 2.6;
const FILM_RADIUS_MAX = 6.4;

/**
 * Rating is ordinal, so it is encoded as size rather than colour — a scale the
 * eye reads as "more" without needing a legend.
 */
export function filmRadius(rating: number | null): number {
  if (rating === null) return FILM_RADIUS_MIN;
  const t = (rating - RATING_MIN) / (RATING_MAX - RATING_MIN);
  return FILM_RADIUS_MIN + t * (FILM_RADIUS_MAX - FILM_RADIUS_MIN);
}

/** Square-rooted and capped: a hub with 50 films must not become a planet. */
export function hubRadius(degree: number): number {
  return 6 + Math.min(7, Math.sqrt(degree));
}

/**
 * How far a hub's films spread out around it, in layout pixels.
 *
 * An empirical fit to the forces rather than a rule imposed on them. Charge and
 * collide already scale a cluster with its degree — measured on isolated clusters,
 * a hub holding 4 films reaches 94px and one holding 124 reaches 192px — so what
 * this exists for is to *predict* that reach before the simulation has run, which
 * is the one thing `hubAnchors` needs and cannot get from the simulation itself.
 *
 * The square root is the shape the measurement has: reach ÷ √degree flattens out
 * around 17–19 across the whole range while reach ÷ degree keeps falling, which is
 * area per film staying roughly constant. `BASE + 11√d` sits on the two ends of the
 * measured curve and 5–15px *outside* it in the middle — deliberately the generous
 * direction, since allotting a cluster too much room costs a little scale and
 * allotting it too little strands films beside a hub they do not belong to.
 *
 * Note this is not `LINK_DISTANCE.membership`, and deliberately not fed into it.
 * The link distance is a floor the charge then exceeds; scaling it by degree as
 * well would push clusters wider than this predicts and defeat the spacing it is
 * used for.
 */

/** Reach of a hub holding one film — near enough the membership link distance. */
const CLUSTER_BASE = 72;
/** Added per film, square-rooted. Fitted to the measured 94px…192px curve. */
const CLUSTER_PER_FILM = 11;

/**
 * Clear space between the edges of two clusters.
 *
 * Small on purpose. This is not breathing room — `clusterReach` already errs wide
 * — it is the margin that keeps two clusters legibly separate places rather than
 * one continuous field, and every pixel of it is paid for in scale, because a
 * wider band means `fitToFrame` draws the whole map smaller.
 */
const CLUSTER_GAP = 40;

export function clusterReach(degree: number): number {
  return CLUSTER_BASE + CLUSTER_PER_FILM * Math.sqrt(Math.max(degree, 1));
}

/**
 * Evenly spaced, alternately offset anchors for hubs.
 *
 * Takes the hubs already in axis order — the caller knows the scale, and
 * re-deriving it from the id here would get it wrong, since `hub:rating:5` sorts
 * after `hub:rating:45` as a string.
 *
 * Spacing is a function of what the clusters need rather than of the viewport.
 * Fitting a fixed band to the window is what broke at scale: twenty watch years
 * across a 900px band leaves 47px between hubs, clusters interpenetrate, and a
 * fifth of the films settle nearer a hub they do not belong to — measured at
 * 102 of 500. The band is instead as wide as the reaches make it and centred, and
 * `fitToFrame` scales the result down; a library that needs more room is drawn
 * smaller, which is the honest trade.
 *
 * Two separations have to hold, and only one of them is the obvious one:
 *
 *  - **Adjacent hubs** are already 2 × `rise` apart vertically, so the horizontal
 *    step they need is the leg of a right triangle, not the whole distance. This is
 *    why the stagger is load-bearing rather than decorative, and why the band does
 *    not have to be twice as wide as it is.
 *  - **Hubs two apart** sit on the *same* side of the centre line with nothing
 *    between them, so they get no help from the stagger at all. This is the binding
 *    constraint, and the one that was failing: the worst cluster overlap on a real
 *    library was between hubs 4 and 6, never between neighbours.
 */
function hubAnchors(
  ordered: readonly GraphNode[],
  width: number,
  height: number,
): ReadonlyMap<string, { x: number; y: number }> {
  // Adjacent clusters sit above and below the centre line so they interleave
  // instead of pushing each other outwards.
  const rise = Math.min(height * 0.16, 150);

  const reach = ordered.map((hub) => clusterReach(hub.degree));
  /** Centre-to-centre distance two clusters need to stay clear of each other. */
  const need = (a: number, b: number) => reach[a] + reach[b] + CLUSTER_GAP;

  const steps = ordered.map((_, i) => {
    if (i + 1 >= ordered.length) return 0;

    // Adjacent: the stagger covers 2 × rise of it, so solve for the leg.
    const across = need(i, i + 1);
    const leg = Math.sqrt(Math.max(0, across * across - 4 * rise * rise));

    /*
      Same side: two steps have to cover it between them, so each carries half.
      Both windows that contain this gap are considered, which is what makes the
      sum work out — the pair (i, i+2) is covered by half from this step and half
      from the next, where it appears as (i+1)−1 to (i+1)+1.
    */
    let half = 0;
    if (i + 2 < ordered.length) half = Math.max(half, need(i, i + 2) / 2);
    if (i > 0) half = Math.max(half, need(i - 1, i + 1) / 2);

    return Math.max(leg, half);
  });

  const xs: number[] = [];
  let x = 0;
  ordered.forEach((_, index) => {
    if (index > 0) x += steps[index - 1];
    xs.push(x);
  });

  // Centred, so a map that outgrows the viewport grows in both directions.
  const shift = width / 2 - (xs[xs.length - 1] ?? 0) / 2;

  const anchors = new Map<string, { x: number; y: number }>();
  ordered.forEach((hub, index) => {
    anchors.set(hub.id, {
      x: xs[index] + shift,
      y: height / 2 + (index % 2 === 0 ? -rise : rise),
    });
  });
  return anchors;
}

/** The hub each film belongs to, for seeding. First membership edge wins. */
function homeHubs(graph: Graph): ReadonlyMap<string, string> {
  const home = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "membership") continue;
    if (typeof edge.source !== "string") continue;
    if (!home.has(edge.source)) home.set(edge.source, edge.target);
  }
  return home;
}

/** Golden-angle offsets: deterministic, but organic rather than gridded. */
const GOLDEN_ANGLE = 2.399963229728653;

/* --- The diary timeline -------------------------------------------------- */

/**
 * How wide one calendar year is drawn, in layout px.
 *
 * The scale of the whole map, so it is chosen against the frame rather than
 * against the data: a little under a laptop viewport, so a library of a few years
 * opens at close to 1× and therefore opens *with titles* — `fitToFrame` caps the
 * scale at 1 and `labels.ts` prints nothing below 0.5×. A straight single-row
 * ribbon of the same library ran to some 2,600px and opened at 0.49×, a hundredth
 * below the floor, with a blank map as the result. Folding into rows is what buys
 * the width back.
 *
 * At this width a busy year of 300 watch days puts consecutive days three or four
 * pixels apart, which is closer than two dots can sit — so a heavy month reads as
 * a solid run and `forceCollide` spreads it vertically. That is the intended
 * reading, not a defect: it is what a binge looks like from a distance.
 */
export const YEAR_WIDTH = 1040;

/**
 * Vertical distance between one year row and the next.
 *
 * Sized for what goes *between* two rows rather than for the dots themselves: a
 * title hanging below a film, the vertical spread `forceCollide` gives a crowded
 * month, and the wrap curve that carries December into January. Tighter than this
 * and a busy year's films start reading as belonging to the row below.
 */
export const ROW_GAP = 92;

/**
 * Half-length of a month tick, in layout px. Short: it measures, it does not divide.
 *
 * Twelve of these per row is already 120 marks on a ten-year map, so they are kept
 * to the smallest length that still reads as a scale. Full-height rules through the
 * whole stack were the alternative and would have made the map a grid — see
 * `.eiga-year` in globals.css for why the graticule stays this quiet.
 */
export const MONTH_TICK = 3.5;

/**
 * Gap between a row's left end and its year label, in layout px.
 *
 * Map geometry rather than a rendering detail, and it lives here because two
 * callers must agree on it: the renderer places the label, and `viz/labels.ts` has
 * to know where that puts it in order to keep a film's title off it.
 */
export const YEAR_LABEL_GAP = 14;

/** Clear space between the last year row and the band of undated films. */
const UNDATED_GAP = 78;
/** Horizontal spacing inside the undated band, and the drop between its lines. */
const UNDATED_STRIDE = 30;
const UNDATED_LINE = 34;

/**
 * How far a film's place is scattered *within* its row, in layout px.
 *
 * The user asked for a map that reads as scattered, and a row of dots on a rule is
 * the opposite — a chart, not a place. So every film is displaced vertically by a
 * fixed distance in a direction that never falls into a pattern the eye can name.
 *
 * Vertical only, and that is the whole reason this constant exists separately from
 * the hub map's spread. Horizontal position on this map *is* the date: a film
 * nudged sideways by seven pixels would be a film claiming a different week. Height
 * inside a row means nothing at all, so it is free.
 *
 * It belongs to the *anchor* rather than to the seed, and that is the mechanism: a
 * nudge applied only at seeding would be pulled straight back onto the rule within
 * a few ticks, leaving the chart this exists to avoid.
 */
const ROW_WANDER = 7;

/**
 * One row of a graticule: a labelled horizontal rule films are read against.
 *
 * Deliberately one type for two things. A calendar year on the timeline and a
 * release decade on the tree are drawn identically and measured identically, and
 * the alternative — a second parallel row type — would fork every consumer of it:
 * the framing arithmetic, the label collision pass, and the renderer.
 *
 * Returned from the layout and drawn by React as a background mark, *not* as a
 * node. A row that could be clicked, focused or counted would be a hub, and
 * neither of these topologies has any.
 */
export interface MapRow {
  /** The year or decade this row stands for. Identity, and ascending across rows. */
  readonly key: number;
  /** How it reads in the margin: "2024", or "1990s". */
  readonly label: string;
  /** The rule's y, which is also the height films in this row are drawn at. */
  readonly y: number;
  /** Where the rule starts: January 1st, or the first day in the history. */
  readonly left: number;
  /** Where it ends: the end of December 31st, or the last day in the history. */
  readonly right: number;
  /**
   * Subdivisions along the rule, as absolute x. Twelve month starts on a
   * timeline row, unevenly spaced; none on a tree, whose rule spans a whole
   * viewing life and has no unit small enough to tick without becoming a grid.
   */
  readonly ticks: readonly number[];
}

/**
 * The rows for a timeline — one per calendar year.
 *
 * Every row spans a whole year, `left` to `right`, whether or not films reach
 * either end. That is what makes the stack readable across rows — February is at
 * the same x in every one of them — and it is also the honest drawing: the rule is
 * the year, and a bare stretch of it is a month nothing was watched in.
 */
function calendarRows(graph: Graph, centre: Position): readonly MapRow[] {
  const count = graph.rows.length;
  if (count === 0) return [];

  const left = centre.x - YEAR_WIDTH / 2;
  const top = centre.y - ((count - 1) * ROW_GAP) / 2;

  return graph.rows.map((year, index) => ({
    key: year,
    label: String(year),
    y: top + index * ROW_GAP,
    left,
    right: left + YEAR_WIDTH,
    // Computed per year, not shared: February moves in a leap year, and a tick
    // drawn a day and a half off is a film sitting on the wrong side of its month.
    ticks: monthStarts(year).map((fraction) => left + fraction * YEAR_WIDTH),
  }));
}

/**
 * Parks the films a scale could not place, in a band below the last row.
 *
 * Shared by both film-to-film maps, because both face the same problem and both
 * answer it the same way. These films have to be drawn somewhere, and every
 * position *inside* the scale means a date — which for a film with no readable
 * watch date would be a date it was not watched on. Outside and unlinked is the
 * only honest place, and the status line names the count so the band reads as a
 * statement rather than as a rendering fault.
 *
 * A tidy run rather than a scatter, deliberately: these films are an appendix to
 * the map, not a region of it, and a strip reads as one. `graph.nodes` is sorted
 * by id, so which film lands where is stable across reloads.
 */
function park(
  graph: Graph,
  anchors: Map<string, Position>,
  left: number,
  width: number,
  floor: number,
): void {
  const columns = Math.max(1, Math.floor(width / UNDATED_STRIDE));
  const top = floor + UNDATED_GAP;
  let placed = 0;
  for (const node of graph.nodes) {
    if (node.when !== null) continue;
    anchors.set(node.id, {
      x: left + (placed % columns) * UNDATED_STRIDE,
      y: top + Math.floor(placed / columns) * UNDATED_LINE,
    });
    placed += 1;
  }
}

/**
 * Where each film sits on the timeline.
 *
 * Films with a calendar position take it exactly, scattered only in height. Films
 * with none — around ten in a real export — go to the parked band.
 */
function timelineAnchors(
  graph: Graph,
  rows: readonly MapRow[],
  centre: Position,
): ReadonlyMap<string, Position> {
  const anchors = new Map<string, Position>();
  const byYear = new Map(rows.map((row) => [row.key, row]));
  const left = rows[0]?.left ?? centre.x - YEAR_WIDTH / 2;

  /*
    Indexed by position in `graph.nodes`, which is sorted by id — so which film
    gets which offset is arbitrary but identical on every reload. It also parts the
    films sharing a day: consecutive golden angles are 137.5° apart, so a knot
    opens into a small vertical spread instead of starting as one coincident pile,
    which is what d3-force would otherwise resolve with a random nudge.
  */
  graph.nodes.forEach((node, index) => {
    if (node.when === null) return;
    const row = byYear.get(node.when.year);
    if (row === undefined) return;
    anchors.set(node.id, {
      x: row.left + node.when.through * YEAR_WIDTH,
      y: row.y + ROW_WANDER * Math.sin(index * GOLDEN_ANGLE),
    });
  });

  park(graph, anchors, left, YEAR_WIDTH, rows[rows.length - 1]?.y ?? centre.y);
  return anchors;
}

/* --- The discovery tree -------------------------------------------------- */

/**
 * Narrowest and widest the tree's time axis may be drawn, in layout px.
 *
 * Unlike the timeline, whose scale is fixed at `YEAR_WIDTH` per year because its
 * rows have to line up with each other, the tree draws its whole history as one
 * span and so has to fit a scale to it. The mapping stays linear either way — a
 * dormant year is proportionally as wide here as it is there, which is the claim
 * that makes x readable as a date at all. These two bounds only decide how many
 * pixels the whole span gets.
 *
 * The floor is for a library watched over a fortnight: at `YEAR_WIDTH` that is
 * 40px, so the rules would be dashes and every film would sit on top of every
 * other. The ceiling is the same trade `YEAR_WIDTH` documents from the other
 * side — a twenty-year history compressed into it gets dense along x, and the
 * alternative is a map so wide that `fitToFrame` opens it below the scale at
 * which any title prints.
 *
 * Exported for the tests, which assert both bounds bite: a clamp nobody notices is
 * a clamp that can quietly stop clamping.
 */
export const TREE_MIN_SPAN = 720;
export const TREE_MAX_SPAN = 2400;

/** The tree's time axis: where the history starts, how long it runs, how wide it is drawn. */
interface TimeScale {
  /** Absolute time of the earliest placed film, as `year + fraction`. */
  readonly start: number;
  /** Length of the history in years. Zero for a library watched in one day. */
  readonly span: number;
  /** How many layout px that span is drawn across. */
  readonly extent: number;
}

function timeScale(graph: Graph): TimeScale {
  let low = Infinity;
  let high = -Infinity;
  for (const node of graph.nodes) {
    if (node.when === null) continue;
    // Absolute time, which is all this needs from a calendar point — the fraction
    // through the year is exactly what makes two dates in one year comparable.
    const at = node.when.year + node.when.through;
    if (at < low) low = at;
    if (at > high) high = at;
  }

  if (low === Infinity) return { start: 0, span: 0, extent: TREE_MIN_SPAN };

  const span = high - low;
  return {
    start: low,
    span,
    extent: Math.min(TREE_MAX_SPAN, Math.max(TREE_MIN_SPAN, YEAR_WIDTH * span)),
  };
}

/**
 * The rows for a tree — one per release decade, oldest at the top.
 *
 * Reuses `ROW_GAP` rather than declaring a band gap of its own, because the
 * vertical need is the same one: room for a title hanging below a film, and room
 * for `forceCollide` to open a crowded stretch out. If anything a tree wants
 * slightly more, since its branch edges cross between rows where the timeline's
 * chain mostly runs along them.
 */
function decadeBands(
  graph: Graph,
  centre: Position,
  scale: TimeScale,
): readonly MapRow[] {
  const count = graph.rows.length;
  if (count === 0) return [];

  const left = centre.x - scale.extent / 2;
  const top = centre.y - ((count - 1) * ROW_GAP) / 2;

  return graph.rows.map((decade, index) => ({
    key: decade,
    label: decadeLabel(decade),
    y: top + index * ROW_GAP,
    left,
    right: left + scale.extent,
    ticks: [],
  }));
}

/**
 * Where each film sits on the tree: across by watch date, down by release decade.
 *
 * The two axes are read the same way the timeline's are, which is why the same
 * `ROW_WANDER` scatter applies and applies vertically only. Height *within* a
 * band carries nothing — a film is not more 1990s than its neighbour — while its
 * horizontal place is the day it was seen, so a sideways nudge would be a claim
 * about a date.
 *
 * A film's parent is placed by the same rule and never consulted here. That is
 * deliberate: a tree drawn by descending from the root would put a film where its
 * lineage says it belongs rather than where its data does, and the branch edges
 * would then be the only true thing on the map. Here they are drawn between two
 * independently correct positions, so a long edge is a real reach across time and
 * a short one is a real neighbour.
 */
function treeAnchors(
  graph: Graph,
  rows: readonly MapRow[],
  centre: Position,
  scale: TimeScale,
): ReadonlyMap<string, Position> {
  const anchors = new Map<string, Position>();
  const byDecade = new Map(rows.map((row) => [row.key, row]));
  const left = rows[0]?.left ?? centre.x - scale.extent / 2;

  graph.nodes.forEach((node, index) => {
    if (node.when === null || node.year === null) return;
    const row = byDecade.get(decadeFromYear(node.year));
    if (row === undefined) return;
    const at = node.when.year + node.when.through;
    // A library watched in a single day has no span to divide by, and every film
    // in it happened at the same moment — so they share the middle of the rule.
    const across = scale.span === 0 ? 0.5 : (at - scale.start) / scale.span;
    anchors.set(node.id, {
      x: row.left + across * scale.extent,
      y: row.y + ROW_WANDER * Math.sin(index * GOLDEN_ANGLE),
    });
  });

  park(graph, anchors, left, scale.extent, rows[rows.length - 1]?.y ?? centre.y);
  return anchors;
}

/** Every hub, and every film beside its own hub. */
function hubMapAnchors(
  graph: Graph,
  width: number,
  height: number,
): ReadonlyMap<string, Position> {
  const hubs = hubAnchors(orderedHubs(graph), width, height);
  const home = homeHubs(graph);

  const anchors = new Map<string, Position>(hubs);
  for (const node of graph.nodes) {
    if (node.kind === "hub") continue;
    const at = hubs.get(home.get(node.id) ?? "");
    if (at) anchors.set(node.id, at);
  }
  return anchors;
}

/* --- Forces -------------------------------------------------------------- */

const LINK_DISTANCE: Record<GraphEdgeKind, number> = {
  membership: 74,
  session: 120,
  spine: 240,
  chain: 22,
  wrap: YEAR_WIDTH,
  branch: 90,
};

const LINK_STRENGTH: Record<GraphEdgeKind, number> = {
  membership: 0.55,
  session: 0.06,
  spine: 0.05,
  chain: 0.09,
  /*
    All but inert. A wrap edge really does span the width of the map, and its
    endpoints are already placed to the pixel by the calendar — there is nothing
    for a force to improve. It is in the simulation only so `forceLink` resolves
    its endpoints to nodes for the renderer to draw between. Not zero, because a
    link with no strength at all reads as an accident to anyone changing this
    later; this is a number small enough to say "on purpose, and negligible".
  */
  wrap: 0.004,
  /*
    Inert for the same reason, and more strictly so. Both ends of a branch are
    placed by data — across by watch date, down by release decade — so any pull
    along it would move a film off one of the two facts the tree is drawn from.
    Its `LINK_DISTANCE` is therefore arbitrary and never reached; it is a
    plausible number rather than a meaningful one.
  */
  branch: 0.004,
};

/**
 * How firmly a film is held to its place on a map whose axes carry meaning.
 *
 * Split by axis, unlike the hub map, because on these maps the two axes mean
 * different things. Horizontal position *is* the watch date, and the whole claim
 * of the map is that it can be read as one — so x pulls hard and a film dragged a
 * fortnight out of place by its neighbours is a bug. Vertical position inside a
 * row means nothing, so y is left loose enough for `forceCollide` to open a binge
 * out into a legible clump rather than compressing it into an unreadable bar.
 *
 * Both are far firmer than a film's pull on a hub map, where the anchor is only a
 * hint and membership does the holding. Here the anchor carries the entire meaning
 * of the picture.
 */
const PLACE_PULL_X = 0.62;
const PLACE_PULL_Y = 0.2;

/**
 * The graticule for a map at a given size, oldest row first.
 *
 * Exported because the renderer needs a row's label, its ticks and its width at
 * *render* time — a row's contents are React's children, written once and never
 * touched again — while a simulation does not exist until an effect has run. Being
 * pure and depending only on `(graph, width, height)` is what makes that safe: the
 * renderer and `createLayout` call the same function with the same arguments and
 * cannot disagree about where a row is or what it says.
 *
 * Empty on a hub map, which has no scale to draw against.
 */
export function mapRows(graph: Graph, width: number, height: number): readonly MapRow[] {
  const centre = { x: width / 2, y: height / 2 };
  if (graph.shape === "thread") return calendarRows(graph, centre);
  if (graph.shape === "tree") return decadeBands(graph, centre, timeScale(graph));
  return [];
}

export function createLayout(
  graph: Graph,
  width: number,
  height: number,
  previous?: ReadonlyMap<string, Position>,
): LayoutHandle {
  const centre = { x: width / 2, y: height / 2 };

  /*
    The thread and the tree differ in what their axes are labelled and in nothing
    else about how they are laid out: both draw a fixed graticule, both place films
    on it by date, and both need the same forces. So most of what follows branches
    on `placed` rather than on the shape.
  */
  const thread = graph.shape === "thread";
  const tree = graph.shape === "tree";
  const placed = thread || tree;

  const rows = mapRows(graph, width, height);
  const anchors = thread
    ? timelineAnchors(graph, rows, centre)
    : tree
      ? treeAnchors(graph, rows, centre, timeScale(graph))
      : hubMapAnchors(graph, width, height);
  let seeded = false;

  const nodes: LayoutNode[] = graph.nodes.map((node, index) => {
    const isHub = node.kind === "hub";
    const anchor = anchors.get(node.id) ?? centre;

    // On a hub map films fan out around their hub, having nowhere better to be
    // until the forces sort them out. On a placed map the anchor already is the
    // answer, scatter and all, so a film starts exactly on it.
    const spread = placed ? 0 : isHub ? 0 : 34 + 5 * Math.sqrt(index);
    const angle = index * GOLDEN_ANGLE;

    /*
      A film that was already on screen starts where it was, so switching axes
      reads as the same films re-sorting themselves rather than a new picture
      cutting in. Hubs are not carried over: they belong to the axis, so they
      simply appear at their new places and the films travel to them.
    */
    const seed = isHub ? undefined : previous?.get(node.id);
    if (seed) seeded = true;

    return {
      ...node,
      radius: isHub ? hubRadius(node.degree) : filmRadius(node.rating),
      anchorX: anchor.x,
      anchorY: anchor.y,
      x: seed ? seed.x : anchor.x + spread * Math.cos(angle),
      y: seed ? seed.y : anchor.y + spread * Math.sin(angle),
    };
  });

  const edges: LayoutEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
  }));

  const simulation = forceSimulation<LayoutNode, LayoutEdge>(nodes)
    .force(
      "link",
      forceLink<LayoutNode, LayoutEdge>(edges)
        .id((node) => node.id)
        /*
          Membership pulls firmly — it is the structure. The spine is a long slack
          tether between neighbouring hubs, since the anchors already place them:
          asking for a short distance here would drag the scale in on itself and
          fight the anchoring. Sessions only suggest.

          The chain is slacker still. On the timeline the calendar is the
          structure, and a chain strong enough to hold films a fixed distance
          apart would stretch a quiet month and compress a busy one — the two
          things the map exists to tell apart. Its distance matters only inside a
          knot, where it opens a day's films out from their shared point.
        */
        .distance((edge) => LINK_DISTANCE[edge.kind])
        .strength((edge) => LINK_STRENGTH[edge.kind]),
    )
    // Charge is not among the forces here: it is a hub map's, and it is added
    // below rather than chained, because neither placed map may carry one.
    .force(
      "collide",
      forceCollide<LayoutNode>()
        .radius((node) => node.radius + 5)
        .iterations(2),
    )
    /*
      Every node is pulled toward its own anchor.

      On a hub map: hubs hard, to their place on the axis; films only faintly, to
      the region their hub occupies. The film pull is deliberately near-nothing —
      membership links already hold a film to its hub, and the anchor is a second,
      weaker claim on the same film, enough to bias a cluster toward its side of
      the map and not enough to flatten it into a rosette around a point.

      On the timeline and the tree, hard across and loose down: the horizontal axis
      is a date and the vertical one is only room to breathe. See `PLACE_PULL_X`.
    */
    .force(
      "x",
      forceX<LayoutNode>((node) => node.anchorX).strength((node) =>
        placed ? PLACE_PULL_X : node.kind === "hub" ? 0.42 : 0.02,
      ),
    )
    .force(
      "y",
      forceY<LayoutNode>((node) => node.anchorY).strength((node) =>
        placed ? PLACE_PULL_Y : node.kind === "hub" ? 0.3 : 0.03,
      ),
    )
    // A little heavier than default, so the map glides to rest instead of
    // twitching. Motion should read as settling, not as computation.
    .velocityDecay(0.45)
    /*
      Stopped on creation. `forceSimulation` starts an internal timer the moment
      it is constructed, which would mean a layout built during a render that
      React later discards keeps running with nothing listening. The caller
      starts it from an effect, where it can also be torn down.
    */
    .stop();

  /*
    Charge belongs to a hub map, and only to one. Hubs push hard so clusters read
    as separate places rather than one mass; films push a little so a cluster is
    a spread rather than a rosette.

    Neither placed map gets any. Repulsion acts along the line between two films,
    and on both of these the nearest neighbour is almost always the next day — so
    that line points along the time axis, and its horizontal component moves a film
    to a date it was not watched on. That is not a cosmetic cost: the entire claim
    of both maps is that x can be read as a date. Separation is left to
    `forceCollide`, which cannot move two dots further apart than they actually
    overlap. Omitted rather than set to zero: a zero-strength many-body force still
    builds a quadtree on every tick.
  */
  if (!placed) {
    simulation.force(
      "charge",
      forceManyBody<LayoutNode>().strength((node) => (node.kind === "hub" ? -820 : -110)),
    );
  }

  return { nodes, edges, simulation, rows, seeded };
}

/** Captures where everything currently is, to seed the next layout from. */
export function positionsOf(
  nodes: readonly LayoutNode[],
): ReadonlyMap<string, Position> {
  const positions = new Map<string, Position>();
  for (const node of nodes) positions.set(node.id, { x: node.x, y: node.y });
  return positions;
}

/**
 * Runs the simulation to rest without animating.
 *
 * Used when the user prefers reduced motion: they get the settled map on first
 * paint rather than watching it assemble itself.
 */
export function settle(
  simulation: Simulation<LayoutNode, LayoutEdge>,
  ticks = 400,
): void {
  simulation.stop();
  simulation.tick(ticks);
}

/** Resolves a link endpoint once the simulation has replaced ids with nodes. */
export function endpoint(value: string | LayoutNode): LayoutNode | null {
  return typeof value === "string" ? null : value;
}

/**
 * Space kept clear around the map, in viewport pixels.
 *
 * The captions are drawn over the graph rather than beside it, so the frame is
 * deliberately asymmetric: more room at the bottom, where the inspector sits.
 */
export const FRAME_INSET = { top: 96, right: 76, bottom: 132, left: 76 };

export interface FitTransform {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Frames the settled map inside the viewport.
 *
 * Without this the layout is only as well-composed as the viewport happens to
 * be — a wide library runs off both edges, a small one huddles in the middle.
 * Scale is capped at 1 so a library of five films is presented small and
 * precise rather than blown up into five enormous dots.
 *
 * The graticule rows are measured alongside the nodes, and have to be: a row spans
 * a whole calendar year — or, on the tree, the whole watch history — while the
 * films on it rarely reach either end, so framing the dots alone would push the
 * ends of every rule off the screen and leave the graticule cut off at both edges,
 * which reads as a rendering fault rather than as a map. The row labels in the left
 * margin are included for the same reason.
 *
 * Returned as plain numbers rather than a d3 transform: coordinates are this
 * module's business, but the zoom behaviour that owns them is not.
 */
export function fitToFrame(
  nodes: readonly LayoutNode[],
  width: number,
  height: number,
  rows: readonly MapRow[] = [],
): FitTransform {
  if (nodes.length === 0) return { k: 1, x: 0, y: 0 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }

  for (const row of rows) {
    // A five-character decade at 8px is about 32px of tracked mono, and a
    // four-digit year less; erring generous here costs a percent of scale, and
    // erring short clips the label.
    minX = Math.min(minX, row.left - YEAR_LABEL_GAP - 32);
    maxX = Math.max(maxX, row.right);
    minY = Math.min(minY, row.y - MONTH_TICK);
    maxY = Math.max(maxY, row.y + MONTH_TICK);
  }

  const usableWidth = Math.max(width - FRAME_INSET.left - FRAME_INSET.right, 1);
  const usableHeight = Math.max(height - FRAME_INSET.top - FRAME_INSET.bottom, 1);
  const k = Math.min(
    1,
    usableWidth / Math.max(maxX - minX, 1),
    usableHeight / Math.max(maxY - minY, 1),
  );

  return {
    k,
    x: FRAME_INSET.left + usableWidth / 2 - k * ((minX + maxX) / 2),
    y: FRAME_INSET.top + usableHeight / 2 - k * ((minY + maxY) / 2),
  };
}
