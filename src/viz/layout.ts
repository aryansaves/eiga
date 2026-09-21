/** Coordinates for the winding viewing journey and the existing hub maps. */

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

import { journeyAnchors, type JourneyPoint } from "./journey.ts";
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
  readonly tangentX?: number;
  readonly tangentY?: number;
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
  /** Optional calendar bounds; the winding journey supplies no rows. */
  readonly rows: readonly YearRow[];
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

/** Retained calendar geometry vocabulary for label and framing helpers. */
export const YEAR_WIDTH = 1040;
export const ROW_GAP = 92;
export const MONTH_TICK = 3.5;
export const YEAR_LABEL_GAP = 14;
export interface YearRow {
  readonly year: number;
  readonly y: number;
  readonly left: number;
  readonly right: number;
  readonly months: readonly number[];
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
};

const LINK_STRENGTH: Record<GraphEdgeKind, number> = {
  membership: 0.55,
  session: 0.06,
  spine: 0.05,
  chain: 0.09,
  // Legacy edge kind retained for graph compatibility.
  wrap: 0.004,
};

export function createLayout(
  graph: Graph,
  width: number,
  height: number,
  previous?: ReadonlyMap<string, Position>,
): LayoutHandle {
  const centre = { x: width / 2, y: height / 2 };
  const thread = graph.shape === "thread";
  const rows: readonly YearRow[] = [];
  const anchors = thread
    ? journeyAnchors(graph, width, height)
    : hubMapAnchors(graph, width, height);
  let seeded = false;

  const nodes: LayoutNode[] = graph.nodes.map((node, index) => {
    const isHub = node.kind === "hub";
    const anchor = anchors.get(node.id) ?? centre;

    // On a hub map films fan out around their hub, having nowhere better to be
    // until the forces sort them out. On the timeline the anchor already is the
    // answer, so a film starts exactly on it.
    const spread = thread ? 0 : isHub ? 0 : 34 + 5 * Math.sqrt(index);
    const angle = index * GOLDEN_ANGLE;

    /*
      A film that was already on screen starts where it was, so switching axes
      reads as the same films re-sorting themselves rather than a new picture
      cutting in. Hubs are not carried over: they belong to the axis, so they
      simply appear at their new places and the films travel to them.
    */
    const seed = isHub || thread ? undefined : previous?.get(node.id);
    if (seed) seeded = true;

    return {
      ...node,
      radius: isHub ? hubRadius(node.degree) : filmRadius(node.rating),
      anchorX: anchor.x,
      anchorY: anchor.y,
      ...(thread ? {
        fx: anchor.x,
        fy: anchor.y,
        tangentX: (anchor as JourneyPoint).tangentX,
        tangentY: (anchor as JourneyPoint).tangentY,
      } : {}),
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
        // Journey stops are fixed; these forces arrange attribute maps.
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
    // Hub positions are firm; films are free to settle around them.
    .force(
      "x",
      forceX<LayoutNode>((node) => node.anchorX).strength((node) =>
        node.kind === "hub" ? 0.42 : 0.02,
      ),
    )
    .force(
      "y",
      forceY<LayoutNode>((node) => node.anchorY).strength((node) =>
        node.kind === "hub" ? 0.3 : 0.03,
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

  // Journey geometry is authored; only hub maps need repulsion.
  if (!thread) {
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

/** The four edges of a frame. Named so the two insets cannot drift apart. */
export interface FrameInset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * The same idea for a frame with nothing floating in it.
 *
 * Below `sm` the chrome is a header and a footer in flow rather than two bands
 * over the map, so there is no caption to keep clear of and every pixel the
 * asymmetric inset reserves is simply thrown away. It was: on a 375×304 map slot
 * the desktop inset frames the graph into 223×76, which is a fifth of the width
 * and a quarter of the height it was given, and the whole library then opens as a
 * thumbnail with no title on it. Symmetric, and small enough to read as a margin
 * rather than as reserved space.
 */
export const FRAME_INSET_BARE = { top: 24, right: 24, bottom: 24, left: 24 };

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
 * The year rows are measured alongside the nodes, and have to be: a row spans a
 * whole calendar year while the films on it rarely reach either end, so framing
 * the dots alone would push January and December off the screen and leave the
 * graticule cut off at both edges — which reads as a rendering fault rather than
 * as a map. The year labels in the left margin are included for the same reason.
 *
 * `inset` is a parameter rather than the constant it used to read directly,
 * because how much room the chrome takes is a fact about the layout it is drawn
 * in and not about the graph. The caller knows which of the two it is showing;
 * this function stays a pure measurement either way.
 *
 * Returned as plain numbers rather than a d3 transform: coordinates are this
 * module's business, but the zoom behaviour that owns them is not.
 */
export function fitToFrame(
  nodes: readonly LayoutNode[],
  width: number,
  height: number,
  rows: readonly YearRow[] = [],
  inset: FrameInset = FRAME_INSET,
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
    // A four-digit year at 8px is about 30px of tracked mono; erring generous
    // here costs a percent of scale, and erring short clips the label.
    minX = Math.min(minX, row.left - YEAR_LABEL_GAP - 32);
    maxX = Math.max(maxX, row.right);
    minY = Math.min(minY, row.y - MONTH_TICK);
    maxY = Math.max(maxY, row.y + MONTH_TICK);
  }

  const usableWidth = Math.max(width - inset.left - inset.right, 1);
  const usableHeight = Math.max(height - inset.top - inset.bottom, 1);
  const k = Math.min(
    1,
    usableWidth / Math.max(maxX - minX, 1),
    usableHeight / Math.max(maxY - minY, 1),
  );

  return {
    k,
    x: inset.left + usableWidth / 2 - k * ((minX + maxX) / 2),
    y: inset.top + usableHeight / 2 - k * ((minY + maxY) / 2),
  };
}
