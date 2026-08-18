/**
 * Force layout.
 *
 * D3 owns coordinates; nothing else does. This module takes a `Graph`, hands
 * d3-force its own mutable copies of the nodes, and exposes the simulation. No
 * React, no DOM.
 *
 * There are two authored geometries here, one per topology, and in both cases the
 * authoring is the point: left to itself d3-force produces a symmetric blob with
 * no reading order, which is a picture of nothing.
 *
 * **The thread** — the default map — seeds films along an Archimedean spiral in
 * watch order, oldest at the centre. A whole viewing life fits in one disc with no
 * panning. See `spiralPoint` for the geometry and why it is not a sunflower.
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
 * Neither map is a plotted figure. A layout that placed every node exactly would
 * be a diagram, so both are given a reason to be irregular — the hub map by
 * anchoring films only faintly and letting their neighbours shoulder them around,
 * the thread by nudging every anchor off the true curve by a fixed distance in a
 * direction that never repeats. See `THREAD_WANDER`; the two mechanisms differ
 * because on the thread the exact position carries a date, and a film pushed a
 * step along the curve would be a film claiming the wrong day.
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

import { RATING_MAX, RATING_MIN } from "../domain/types.ts";
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
   * Where the calendar years fall along the thread. Empty on a hub map.
   *
   * Fixed geometry, not simulated: the marks sit on the ideal curve while the
   * films settle around it, which is exactly the relationship a printed map has
   * between its graticule and its terrain.
   */
  readonly marks: readonly YearMark[];
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

/* --- The diary spiral ---------------------------------------------------- */

/**
 * Radial distance between one turn of the spiral and the next.
 *
 * Wide enough that two turns read as two separate passes of the thread rather
 * than one thick band, which is the property that lets the eye follow watch order
 * around the disc.
 */
export const TURN_GAP = 46;

/**
 * Distance along the curve from one step to the next.
 *
 * A step is a distinct watch day, not a film. Comfortably more than twice the
 * largest film radius, so consecutive days do not collide and the chain between
 * them is visible as a line rather than as two touching dots.
 */
export const STEP = 26;

/**
 * Radius of the first step.
 *
 * Not zero: the centre is the most crowded part of any spiral, and starting at a
 * point would pile the earliest films on top of each other. Raise this before
 * anything else if the middle of the map reads as a blob.
 */
export const INNER_R = 30;

/** Radial growth per radian, so that one full turn adds exactly `TURN_GAP`. */
const SPIRAL_B = TURN_GAP / (2 * Math.PI);
/** The angle the first step sits at, which is what puts it at `INNER_R`. */
const SPIRAL_THETA0 = INNER_R / SPIRAL_B;

export interface SpiralPoint {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Radians from the positive x axis, for drawing a tick along the radius. */
  readonly theta: number;
}

/**
 * Where a step sits on the diary spiral, relative to the centre.
 *
 * An Archimedean spiral (`r = Bθ`), parameterised by *arc length* rather than by
 * angle. Stepping the angle evenly would crowd the early films together and fling
 * the recent ones apart, because the same angle covers more curve the further out
 * you are. Solving for the angle instead — `s = B(θ² − θ0²)/2`, so
 * `θ = √(θ0² + 2s/B)` — spaces every day the same distance from the day before it,
 * which is the only version that reads as a scale.
 *
 * Deliberately *not* a phyllotaxis/sunflower spiral, the usual choice for filling
 * a disc evenly. That one places consecutive points on opposite sides of the
 * centre; with a chain drawn through them in order the result is a scribble, and
 * watch order — the entire point — becomes unreadable.
 */
export function spiralPoint(step: number): SpiralPoint {
  const arc = Math.max(0, step) * STEP;
  const theta = Math.sqrt(SPIRAL_THETA0 * SPIRAL_THETA0 + (2 * arc) / SPIRAL_B);
  const r = SPIRAL_B * theta;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), r, theta };
}

/**
 * A calendar year, marked where it begins along the thread.
 *
 * Returned from the layout and drawn by React as a background mark, *not* as a
 * node — a year that could be clicked, focused or counted would be a hub, and the
 * thread has none. Thin cartographic ticks over the map, nothing more.
 */
export interface YearMark {
  readonly year: number;
  readonly x: number;
  readonly y: number;
  /** Radians from the centre, so the tick can lie along the radius. */
  readonly angle: number;
}

/**
 * Half-length of a year tick, in layout px. Short: it points, it does not divide.
 *
 * Lives here rather than in the component that draws it because it is map
 * geometry, and two callers need it to agree: the renderer places the year label
 * beyond the tick, and `viz/labels.ts` has to know where that puts it in order to
 * keep a film's title off it.
 */
export const MARK_TICK = 7;

/** How far beyond the outermost turn the films with no date are scattered. */
const UNDATED_GAP = 52;

/**
 * How far a film's place is nudged off the exact curve.
 *
 * The user asked for a map that reads as scattered, and a perfectly plotted
 * spiral is the opposite — a figure, not a place. So every film is displaced a
 * fixed distance in a golden-angle direction, which reads as a hand-drawn line
 * because the deviations never fall into a pattern the eye can name.
 *
 * It belongs to the *anchor* rather than to the seed, and that is the whole
 * mechanism: a nudge applied only at seeding would be pulled straight back onto
 * the curve within a few ticks, leaving the diagram this exists to avoid.
 *
 * Measured on a 124-film library: mean displacement 6px, worst 13px, and
 * neighbouring turns still pass ~30px apart centre-to-centre. Raising it much
 * beyond a quarter of `STEP` starts closing that gap, at which point two passes
 * of the thread begin to read as one thick band.
 */
const THREAD_WANDER = 6;

/**
 * Where each film sits on the thread.
 *
 * Films with a step take their point on the curve, nudged. Films with none —
 * around ten in a real export — are scattered in a loose band beyond the last
 * turn: they have to be somewhere, and every position inside the spiral means a
 * date, which for these films would be a date they were not watched on. Outside
 * and unlinked is the only honest place, and the status line names the count so
 * the band reads as a statement rather than as a rendering fault.
 */
function threadAnchors(graph: Graph, centre: Position): ReadonlyMap<string, Position> {
  const anchors = new Map<string, Position>();
  let reach = INNER_R;

  /*
    Indexed by position in `graph.nodes`, which is sorted by id — so which film
    gets which nudge is arbitrary but identical on every reload. It also parts
    the films sharing a step: consecutive golden angles are 137.5° apart, so a
    knot opens into a small rosette instead of starting as one coincident pile,
    which is what d3-force resolves with a random nudge.
  */
  graph.nodes.forEach((node, index) => {
    if (node.order === null) return;
    const point = spiralPoint(node.order);
    const away = index * GOLDEN_ANGLE;
    reach = Math.max(reach, point.r);
    anchors.set(node.id, {
      x: centre.x + point.x + THREAD_WANDER * Math.cos(away),
      y: centre.y + point.y + THREAD_WANDER * Math.sin(away),
    });
  });

  /*
    Golden-angle spacing with a shallow radial stagger, so the undated films read
    as a scatter rather than as a ring somebody drew on purpose. `graph.nodes` is
    sorted by id, so which film lands where is stable across reloads.
  */
  const band = reach + UNDATED_GAP;
  let placed = 0;
  for (const node of graph.nodes) {
    if (node.order !== null) continue;
    const angle = placed * GOLDEN_ANGLE;
    const r = band + (placed % 3) * 9;
    anchors.set(node.id, {
      x: centre.x + r * Math.cos(angle),
      y: centre.y + r * Math.sin(angle),
    });
    placed += 1;
  }

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

/** The year marks for a thread. Empty for anything else, since it has no years. */
function yearMarks(graph: Graph, centre: Position): readonly YearMark[] {
  return graph.yearStarts.map((start) => {
    const point = spiralPoint(start.step);
    return {
      year: start.year,
      x: centre.x + point.x,
      y: centre.y + point.y,
      angle: point.theta,
    };
  });
}

/* --- Forces -------------------------------------------------------------- */

const LINK_DISTANCE: Record<GraphEdgeKind, number> = {
  membership: 74,
  session: 120,
  spine: 240,
  chain: STEP,
};

const LINK_STRENGTH: Record<GraphEdgeKind, number> = {
  membership: 0.55,
  session: 0.06,
  spine: 0.05,
  chain: 0.09,
};

/**
 * How firmly a film is held to its place on the spiral.
 *
 * The anchors carry the entire meaning of the picture, so this pulls far harder
 * than a film's pull on a hub map, and equally in both directions: the spiral has
 * no preferred axis, unlike the hub band, which is horizontal by construction.
 * The irregularity that keeps the map from reading as a diagram is authored into
 * the anchor itself — see `THREAD_WANDER` — so the pull is free to be firm.
 */
const THREAD_PULL = 0.35;

export function createLayout(
  graph: Graph,
  width: number,
  height: number,
  previous?: ReadonlyMap<string, Position>,
): LayoutHandle {
  const centre = { x: width / 2, y: height / 2 };
  const thread = graph.shape === "thread";
  const anchors = thread
    ? threadAnchors(graph, centre)
    : hubMapAnchors(graph, width, height);
  let seeded = false;

  const nodes: LayoutNode[] = graph.nodes.map((node, index) => {
    const isHub = node.kind === "hub";
    const anchor = anchors.get(node.id) ?? centre;

    // On a hub map films fan out around their hub, having nowhere better to be
    // until the forces sort them out. On the thread the anchor already is the
    // answer, wander and all, so a film starts exactly on it.
    const spread = thread ? 0 : isHub ? 0 : 34 + 5 * Math.sqrt(index);
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

          The chain is slacker still. On the thread the spiral is the structure,
          and a chain strong enough to hold films a step apart would straighten
          the curve it is drawn along. Its distance matters only inside a knot,
          where it opens a day's films out from their shared point.
        */
        .distance((edge) => LINK_DISTANCE[edge.kind])
        .strength((edge) => LINK_STRENGTH[edge.kind]),
    )
    // Charge is not among the forces here: it is a hub map's, and it is added
    // below rather than chained, because the thread must not carry one.
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

      On the thread, equally in both directions: a spiral has no preferred axis,
      unlike the hub band, which is horizontal by construction.
    */
    .force(
      "x",
      forceX<LayoutNode>((node) => node.anchorX).strength((node) =>
        thread ? THREAD_PULL : node.kind === "hub" ? 0.42 : 0.02,
      ),
    )
    .force(
      "y",
      forceY<LayoutNode>((node) => node.anchorY).strength((node) =>
        thread ? THREAD_PULL : node.kind === "hub" ? 0.3 : 0.03,
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

    The thread gets none at all. Repulsion acts along the line between two films,
    and on a spiral the nearest films are the ones before and after on the curve,
    so that line points along the thread and its outward component inflates the
    disc turn by turn. Measured on 124 films: a strength of −20 pushed the average
    film a full step off the curve, and −46 pushed turn 2 into turn 3 — the thread
    crossing itself, which is watch order becoming unreadable. Separation is left
    to `forceCollide`, which cannot move two dots further apart than they actually
    overlap. Omitted rather than set to zero: a zero-strength many-body force still
    builds a quadtree on every tick.
  */
  if (!thread) {
    simulation.force(
      "charge",
      forceManyBody<LayoutNode>().strength((node) => (node.kind === "hub" ? -820 : -110)),
    );
  }

  return { nodes, edges, simulation, marks: yearMarks(graph, centre), seeded };
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
 * Returned as plain numbers rather than a d3 transform: coordinates are this
 * module's business, but the zoom behaviour that owns them is not.
 */
export function fitToFrame(
  nodes: readonly LayoutNode[],
  width: number,
  height: number,
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
