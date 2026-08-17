/**
 * Force layout.
 *
 * D3 owns coordinates; nothing else does. This module takes a `Graph`, hands
 * d3-force its own mutable copies of the nodes, and exposes the simulation. No
 * React, no DOM.
 *
 * The one authored decision here is the hub spine. Left to itself d3-force
 * produces a symmetric blob with no reading order, so hubs are pinned along a
 * staggered horizontal band in *axis* order and films are seeded beside their
 * hub. On an ordinal axis that turns the map into something that reads
 * left-to-right through the scale — decades through time, ratings low to high;
 * on a nominal axis the order is alphabetical, which is arbitrary but stable.
 * The stagger is what keeps neighbouring clusters from shouldering each other
 * sideways into one long horizontal smear. Films then drift where the forces
 * take them.
 *
 * The graph's own spine edges are laid over that as a slack tether: the anchors
 * do the placing, because deterministic placement is worth more than an organic
 * chain, and the tether only stops the ends of a long scale from drifting apart.
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
 * Evenly spaced, alternately offset anchors for hubs.
 *
 * Takes the hubs already in axis order — the caller knows the scale, and
 * re-deriving it from the id here would get it wrong, since `hub:rating:5` sorts
 * after `hub:rating:45` as a string.
 */
function hubAnchors(
  ordered: readonly GraphNode[],
  width: number,
  height: number,
): ReadonlyMap<string, { x: number; y: number }> {
  const inset = Math.min(width * 0.15, 190);
  const span = Math.max(width - inset * 2, 1);
  // Adjacent clusters sit above and below the centre line so they interleave
  // instead of pushing each other outwards.
  const rise = Math.min(height * 0.16, 150);

  const anchors = new Map<string, { x: number; y: number }>();
  ordered.forEach((hub, index) => {
    const t = ordered.length === 1 ? 0.5 : index / (ordered.length - 1);
    anchors.set(hub.id, {
      x: inset + t * span,
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

const LINK_DISTANCE: Record<GraphEdgeKind, number> = {
  membership: 74,
  session: 120,
  spine: 240,
};

const LINK_STRENGTH: Record<GraphEdgeKind, number> = {
  membership: 0.55,
  session: 0.06,
  spine: 0.05,
};

export function createLayout(
  graph: Graph,
  width: number,
  height: number,
  previous?: ReadonlyMap<string, Position>,
): LayoutHandle {
  const ordered = orderedHubs(graph);
  const anchors = hubAnchors(ordered, width, height);
  const home = homeHubs(graph);
  const centre = { x: width / 2, y: height / 2 };
  let seeded = false;

  const nodes: LayoutNode[] = graph.nodes.map((node, index) => {
    const isHub = node.kind === "hub";
    const anchor =
      (isHub ? anchors.get(node.id) : anchors.get(home.get(node.id) ?? "")) ??
      centre;

    const spread = isHub ? 0 : 34 + 5 * Math.sqrt(index);
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
        */
        .distance((edge) => LINK_DISTANCE[edge.kind])
        .strength((edge) => LINK_STRENGTH[edge.kind]),
    )
    // Hubs push hard so clusters read as separate places, not one mass.
    .force(
      "charge",
      forceManyBody<LayoutNode>().strength((node) =>
        node.kind === "hub" ? -820 : -110,
      ),
    )
    .force(
      "collide",
      forceCollide<LayoutNode>()
        .radius((node) => node.radius + 5)
        .iterations(2),
    )
    /*
      Every node is pulled toward its own anchor: hubs hard, to their place on the
      axis; films only faintly, to the region their hub occupies.

      The film pull is deliberately near-nothing. Membership links already hold a
      film to its hub, and the anchor is a second, weaker claim on the same film —
      enough to bias a cluster toward its side of the map, not enough to flatten
      it into a rosette around a point. Raising it tightens every cluster and
      makes the map more diagram than map, so it stays low.
    */
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

  return { nodes, edges, simulation, seeded };
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
