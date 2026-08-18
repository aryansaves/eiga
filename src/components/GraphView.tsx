"use client";

/**
 * The graph surface.
 *
 * The division of labour is strict, because mixing the two is what makes D3 and
 * React painful together:
 *
 *  - React owns structure and state, and reads only the `Graph` to get them. It
 *    renders one `<g>` per node and one `<line>` per edge, and expresses
 *    selection as `data-` attributes that globals.css turns into a visual
 *    hierarchy.
 *  - D3 owns coordinates. The layout is created inside an effect — never during
 *    render — and on every tick it writes `transform`, `x1`, `y1`, `x2`, `y2`
 *    straight to the DOM through refs. None of those attributes appear in JSX,
 *    so React never fights it for them, and a 60fps simulation costs zero
 *    reconciliation.
 *
 * The split is worth being pedantic about: radius is derived from the graph in
 * both places rather than passed from the layout, so nothing in the render path
 * needs to know that a simulation exists.
 *
 * Accessibility: hubs are in the tab order because they are the structure of the
 * map and there are only a handful. Films are not — a force graph with a hundred
 * tab stops is worse than useless — so they are reachable through the film list
 * in the inspector instead, which is the keyboard-equivalent route to the same
 * selection.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3-zoom";

import { RATING_MAX } from "@/domain/types.ts";
import {
  groupCount,
  neighboursOf,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from "@/graph/build.ts";
import {
  createLayout,
  endpoint,
  filmRadius,
  fitToFrame,
  hubRadius,
  positionsOf,
  settle,
  type LayoutHandle,
  type LayoutNode,
} from "@/viz/layout.ts";

/** Scale at which titles are worth showing. Below it, only shape and hubs read. */
const DETAIL_ZOOM = 1.6;

/** Half-length of a year tick, in layout px. Short: it points, it does not divide. */
const MARK_TICK = 7;

/**
 * Relaying out on every resized pixel would thrash, so the layout's coordinate
 * space is quantised. The viewBox still tracks the real size, so the difference
 * only ever shifts the map by less than half a bucket.
 */
const LAYOUT_BUCKET = 64;

interface Viewport {
  readonly width: number;
  readonly height: number;
}

type ElementState = "rest" | "anchor" | "near" | "far";

export interface GraphViewProps {
  readonly graph: Graph;
  readonly focusedId: string | null;
  readonly onFocus: (id: string | null) => void;
  /**
   * Ids of the films matching the current search, or null when not searching.
   * Empty is meaningful and distinct from null: a search that found nothing.
   */
  readonly matches: ReadonlySet<string> | null;
  /**
   * Receives the live surface, for anything that needs the drawn map itself.
   *
   * Passed down rather than found with a query selector: exporting reads the same
   * element the simulation is writing to, and that dependency should be visible
   * in the types instead of resolved by a class name at runtime.
   */
  readonly surfaceRef?: RefObject<SVGSVGElement | null>;
}

function quantise(value: number): number {
  return Math.max(LAYOUT_BUCKET, Math.round(value / LAYOUT_BUCKET) * LAYOUT_BUCKET);
}

function filmDescription(node: GraphNode): string {
  const year = node.year === null ? "year unknown" : String(node.year);
  const rating = node.rating === null ? "unrated" : `rated ${node.rating}`;
  return `${node.label}, ${year}, ${rating}`;
}

/**
 * What the map is, for a screen reader.
 *
 * Branches on topology because the two say genuinely different things: a hub map
 * groups films, and the thread orders them. `groupCount` supplies the number in
 * both cases, so this can never disagree with the status line beneath the map.
 */
function mapDescription(graph: Graph, films: number): string {
  const groups = groupCount(graph);
  return graph.shape === "thread"
    ? `Map of ${films} films in the order they were watched, across ${groups} days`
    : `Map of ${films} films across ${groups} ${graph.groupKind} groups`;
}

export function GraphView({ graph, focusedId, onFocus, matches, surfaceRef }: GraphViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  /**
   * Year marks, keyed by year, and their labels separately.
   *
   * Two maps because a mark is written twice: the group is turned to lie along the
   * radius, and the label inside it is turned back so it stays upright. A rotated
   * year would read as a decorative sunburst, which is the opposite of a graticule.
   */
  const markEls = useRef(new Map<number, SVGGElement>());
  const markLabelEls = useRef(new Map<number, SVGGElement>());
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  /** Set once the user pans or zooms, after which the view is theirs to keep. */
  const exploredRef = useRef(false);
  /**
   * The live layout, and the exact viewport it should be framed in.
   *
   * Both are refs because they are read only from effects. The layout in
   * particular must never be built during render: it is a mutable simulation, and
   * a render React discards would leave one behind.
   */
  const layoutRef = useRef<LayoutHandle | null>(null);
  const sizeRef = useRef<Viewport | null>(null);
  /** True while a re-sort is in flight, so framing waits for the new shape. */
  const animatingRef = useRef(false);
  /** The graph the current layout was built from, to tell a re-sort from a resize. */
  const lastGraphRef = useRef<Graph | null>(null);

  const [size, setSize] = useState<Viewport | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const next = { width, height };
      // Mirrored into a ref so the layout effect can frame to the true size
      // without taking a dependency on it and rebuilding on every pixel.
      sizeRef.current = next;
      setSize(next);
    };

    /*
      Measured once directly, before observing. A ResizeObserver only delivers
      while the document is being rendered, so a map opened in a background tab
      would otherwise have no size at all until it was looked at.
    */
    const box = host.getBoundingClientRect();
    measure(box.width, box.height);

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (next) measure(next.width, next.height);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const layoutWidth = size ? quantise(size.width) : 0;
  const layoutHeight = size ? quantise(size.height) : 0;
  const ready = layoutWidth > 0 && layoutHeight > 0;

  // Structure, straight from the graph. Deliberately free of coordinates.
  const films = useMemo(() => graph.nodes.filter((node) => node.kind === "film"), [graph]);
  const hubs = useMemo(() => graph.nodes.filter((node) => node.kind === "hub"), [graph]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (!svg || !viewport) return;

    svg.dataset.detail = "far";

    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 6])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        // A null sourceEvent means we moved the view, not the user.
        if (event.sourceEvent) exploredRef.current = true;
        viewport.setAttribute("transform", event.transform.toString());
        svg.dataset.detail = event.transform.k >= DETAIL_ZOOM ? "near" : "far";
      });

    zoomRef.current = behaviour;
    const selection = select(svg);
    // Double-click-to-zoom fights double-clicking a node, and jumps the view.
    selection.call(behaviour).on("dblclick.zoom", null);

    return () => {
      selection.on(".zoom", null);
      zoomRef.current = null;
    };
  }, []);

  /*
    Framing goes through the zoom behaviour rather than around it: writing the
    viewport transform directly would leave d3-zoom's internal state stale, and
    the user's next scroll would snap the map back. Never re-frames once the user
    has moved the view themselves — re-centring someone's map out from under them
    while they are reading it is worse than an imperfect fit.
  */
  const frameTo = (nodes: readonly LayoutNode[], viewport: Viewport | null) => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (!svg || !behaviour || !viewport || exploredRef.current) return;

    const fit = fitToFrame(nodes, viewport.width, viewport.height);
    behaviour.transform(select(svg), zoomIdentity.translate(fit.x, fit.y).scale(fit.k));
  };

  // Coordinates: computed here, written straight to the DOM, never through state.
  useLayoutEffect(() => {
    if (!ready) return;

    /*
      Where everything currently is, carried into the new layout so films migrate
      rather than jump. Read off the outgoing handle rather than tracked on every
      tick — d3 mutates its node objects in place, so the old layout already holds
      exactly where each one came to rest.
    */
    const previous = layoutRef.current ? positionsOf(layoutRef.current.nodes) : undefined;
    const layout = createLayout(graph, layoutWidth, layoutHeight, previous);
    layoutRef.current = layout;

    /*
      A re-sort is the graph itself changing — a new axis, or a library replacing
      the demo — while films are already on screen. A resize also rebuilds the
      layout, but nothing has been re-grouped, so it must not re-animate.
    */
    const resorting = layout.seeded && lastGraphRef.current !== graph;
    lastGraphRef.current = graph;

    const { simulation } = layout;

    const paint = () => {
      for (const node of layout.nodes) {
        nodeEls.current
          .get(node.id)
          ?.setAttribute("transform", `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})`);
      }
      for (const edge of layout.edges) {
        const line = edgeEls.current.get(edge.id);
        const from = endpoint(edge.source);
        const to = endpoint(edge.target);
        if (!line || !from || !to) continue;
        line.setAttribute("x1", from.x.toFixed(2));
        line.setAttribute("y1", from.y.toFixed(2));
        line.setAttribute("x2", to.x.toFixed(2));
        line.setAttribute("y2", to.y.toFixed(2));
      }
    };

    const frame = () => frameTo(layout.nodes, sizeRef.current);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /*
      Year marks are placed once and never again. They are the map's graticule:
      fixed to the ideal curve while the films settle around it, which is the
      relationship a printed map has between its grid and its terrain — and a
      graticule that drifted with the terrain would be measuring nothing.
    */
    for (const mark of layout.marks) {
      const degrees = ((mark.angle * 180) / Math.PI).toFixed(2);
      markEls.current
        .get(mark.year)
        ?.setAttribute(
          "transform",
          `translate(${mark.x.toFixed(2)} ${mark.y.toFixed(2)}) rotate(${degrees})`,
        );
      markLabelEls.current.get(mark.year)?.setAttribute("transform", `rotate(-${degrees})`);
    }

    /*
      A map that is not re-sorting settles before it is shown. Watching a hundred
      films fly out from a common point is a loading screen pretending to be an
      insight, and it also means framing has a stable shape to measure.

      A re-sort is the same films finding their places on a new axis, and there
      the movement is the whole point — so it animates from where everything
      already was. Unless motion is unwelcome, in which case the answer arrives
      without the journey.
    */
    if (!resorting || reducedMotion) {
      settle(simulation);
      paint();
      // Only a first paint reclaims the view; a re-sort leaves the framing be.
      if (!layout.seeded) exploredRef.current = false;
      animatingRef.current = false;
      frame();
      if (reducedMotion) return;

      // Re-heat gently, so the map is seen finding its last few millimetres.
      simulation.on("tick", paint).alpha(0.18).restart();
      return () => {
        simulation.on("tick", null).stop();
      };
    }

    animatingRef.current = true;
    /*
      The seed positions are written before the browser paints: films where they
      already were, hubs at their new anchors. Without this the incoming hubs
      would have no transform at all for one frame and appear stacked at the
      origin, which reads as a glitch rather than a re-sort.
    */
    paint();
    simulation
      .on("tick", paint)
      .on("end", () => {
        animatingRef.current = false;
        // Frame the shape the map actually took, once it has stopped moving.
        frame();
      })
      // Enough energy for a film to cross the map to a hub at the other end.
      .alpha(0.9)
      .restart();

    return () => {
      simulation.on("tick", null).on("end", null).stop();
      animatingRef.current = false;
    };
  }, [graph, layoutWidth, layoutHeight, ready]);

  /*
    Reframing on a viewport change alone. The layout is quantised, so a resize
    within one bucket does not rebuild it and the effect above does not run —
    but the frame still has to follow the real size.
  */
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout || animatingRef.current) return;
    frameTo(layout.nodes, size);
  }, [size]);

  const neighbours = useMemo(
    () => (focusedId ? neighboursOf(graph, focusedId) : null),
    [graph, focusedId],
  );

  const nodeState = (id: string): ElementState => {
    if (!focusedId) return "rest";
    if (id === focusedId) return "anchor";
    return neighbours?.has(id) ? "near" : "far";
  };

  const edgeState = (edge: GraphEdge): ElementState => {
    if (!focusedId) return "rest";
    const touches = edge.source === focusedId || edge.target === focusedId;
    return touches ? "near" : "far";
  };

  const registerNode = (id: string) => (el: SVGGElement | null) => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  };

  const registerEdge = (id: string) => (el: SVGLineElement | null) => {
    if (el) edgeEls.current.set(id, el);
    else edgeEls.current.delete(id);
  };

  const registerMark = (year: number) => (el: SVGGElement | null) => {
    if (el) markEls.current.set(year, el);
    else markEls.current.delete(year);
  };

  const registerMarkLabel = (year: number) => (el: SVGGElement | null) => {
    if (el) markLabelEls.current.set(year, el);
    else markLabelEls.current.delete(year);
  };

  const toggle = (id: string) => onFocus(id === focusedId ? null : id);

  return (
    <div ref={hostRef} className="eiga-grid relative h-full w-full">
      <svg
        ref={(el) => {
          svgRef.current = el;
          if (surfaceRef) surfaceRef.current = el;
        }}
        className="eiga-graph"
        viewBox={`0 0 ${size?.width ?? 0} ${size?.height ?? 0}`}
        data-focused={focusedId ? "true" : "false"}
        data-searching={matches ? "true" : "false"}
        data-shape={graph.shape}
        role="group"
        aria-label={mapDescription(graph, films.length)}
        // Clicking the surface itself — not a node — releases the anchor.
        onClick={(event) => {
          if (event.target === event.currentTarget) onFocus(null);
        }}
      >
        <g ref={viewportRef}>
          {/*
            Nothing is drawn until the host has been measured. One render would
            otherwise mount every node before the layout exists, and a pile of
            dots at the origin is not a map.
          */}

          {/*
            The year marks, underneath everything — a graticule the map is drawn
            over, never a thing in it. Deliberately not nodes: a year that could be
            clicked, focused or counted would be a hub, and the thread has none.
            Rendered from `graph.yearStarts`, positioned from `layout.marks`, which
            is the same division of labour as every node here.
          */}
          <g aria-hidden="true">
            {ready &&
              graph.yearStarts.map((start) => (
                <g key={start.year} ref={registerMark(start.year)} className="eiga-year">
                  <line x1={-MARK_TICK} x2={MARK_TICK} />
                  <g ref={registerMarkLabel(start.year)}>
                    <text x={MARK_TICK + 6} dy="0.32em">
                      {start.year}
                    </text>
                  </g>
                </g>
              ))}
          </g>

          <g>
            {ready &&
              graph.edges.map((edge) => (
                <line
                  key={edge.id}
                  ref={registerEdge(edge.id)}
                  className="eiga-edge"
                  data-kind={edge.kind}
                  data-state={edgeState(edge)}
                />
              ))}
          </g>

          <g>
            {ready &&
              films.map((node) => {
                const radius = filmRadius(node.rating);
                return (
                  <g
                    key={node.id}
                    ref={registerNode(node.id)}
                    className="eiga-node eiga-film"
                    data-state={nodeState(node.id)}
                    data-loved={node.rating === RATING_MAX ? "true" : "false"}
                    data-match={matches ? String(matches.has(node.id)) : undefined}
                    role="button"
                    tabIndex={-1}
                    aria-label={filmDescription(node)}
                    aria-pressed={node.id === focusedId}
                    onClick={() => toggle(node.id)}
                  >
                    <circle r={radius} />
                    <text className="eiga-label" y={radius + 11}>
                      {node.label}
                    </text>
                  </g>
                );
              })}
          </g>

          <g>
            {ready &&
              hubs.map((node) => {
                const radius = hubRadius(node.degree);
                return (
                  <g
                    key={node.id}
                    ref={registerNode(node.id)}
                    className="eiga-node eiga-hub"
                    data-state={nodeState(node.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.label}, ${node.degree} films`}
                    aria-pressed={node.id === focusedId}
                    onClick={() => toggle(node.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      toggle(node.id);
                    }}
                  >
                    <circle r={radius} />
                    <text className="eiga-label" y={-(radius + 8)}>
                      {node.label}
                    </text>
                  </g>
                );
              })}
          </g>
        </g>
      </svg>
    </div>
  );
}
