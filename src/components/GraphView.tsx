"use client";

/**
 * The graph surface.
 *
 * The division of labour is strict, because mixing the two is what makes D3 and
 * React painful together. The line is drawn by what a value *derives from*, not
 * by which element it lands on:
 *
 *  - React owns structure and everything derived from the `Graph`. It renders one
 *    `<g>` per node and one `<line>` per edge, and expresses selection, rating
 *    and lit state as `data-` attributes that globals.css turns into a visual
 *    hierarchy.
 *  - The effects here own everything derived from *coordinates*, and write it
 *    straight to the DOM through refs: `transform` and the line endpoints on
 *    every tick, and `data-named` — which titles the map has room for — whenever
 *    the label choice is recomputed. None of those attributes appear in JSX, so
 *    React never fights for them, and a 60fps simulation costs zero
 *    reconciliation. `data-named` belongs on this side for the same reason: it is
 *    a function of where the dots came to rest, and routing 124 of them through
 *    state on every zoom step would defeat the whole arrangement.
 *
 * The split is worth being pedantic about: radius is derived from the graph in
 * both places rather than passed from the layout, so nothing in the render path
 * needs to know that a simulation exists.
 *
 * Accessibility: hubs are in the tab order because they are the structure of the
 * map and there are only a handful. Films are not — a force graph with a hundred
 * tab stops is worse than useless — so they are reachable through the film list
 * in the inspector instead, which is the keyboard-equivalent route to the same
 * selection. A film whose title lost the collision test is unaffected by any of
 * this: its `aria-label` carries the full description either way.
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
import { visibleLabels } from "@/viz/labels.ts";
import {
  createLayout,
  endpoint,
  filmRadius,
  fitToFrame,
  hubRadius,
  MARK_TICK,
  positionsOf,
  settle,
  type LayoutHandle,
  type LayoutNode,
} from "@/viz/layout.ts";

/**
 * How far the zoom must move before the labels are chosen again, as a log ratio.
 *
 * `visibleLabels` is O(n²) in the worst case and writes an attribute per film, so
 * running it on every wheel event of a continuous pinch would be wasteful for no
 * visible gain. About 6%: between recomputes the boxes the choice was made with
 * are at most that much out of step with the type actually drawn, which is a
 * fraction of the clear space around each title and cannot produce a collision.
 *
 * A log ratio rather than a difference so the step is the same *proportion* at
 * every scale — 0.25 → 0.27 is as big a change to a label's footprint as
 * 5.5 → 5.9, and an absolute threshold would treat them as wildly different.
 */
const ZOOM_STEP = 0.06;

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
   * Ids of the films lit by the current search and filters, or null when neither
   * is narrowing the map.
   *
   * These are `FilmId`s — what `narrow` and `searchFilms` answer in — not node
   * ids. Empty is meaningful and distinct from null: a search that found nothing
   * dims the map and reports zero, where null leaves it at full strength.
   */
  readonly lit: ReadonlySet<string> | null;
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

export function GraphView({ graph, focusedId, onFocus, lit, surfaceRef }: GraphViewProps) {
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
  /**
   * The live zoom scale, and the scale the current label choice was made at.
   *
   * Two values rather than one because the choice is throttled: `scaleRef` tracks
   * every zoom event, `namedAtRef` only moves when the labels are actually
   * recomputed, and the distance between them is what `ZOOM_STEP` measures.
   */
  const scaleRef = useRef(1);
  const namedAtRef = useRef(1);
  /**
   * `lit`, mirrored so the label choice can read it without being a dependency.
   *
   * The zoom handler is bound once, on mount, and therefore holds the first
   * render's `applyNames` forever. That is only safe because `applyNames` reads
   * refs exclusively — no prop, no state. This ref is what keeps that true when
   * the search changes.
   */
  const litRef = useRef<ReadonlySet<string> | null>(lit);

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

  /**
   * Choose which titles the map has room for, and publish the scale it was chosen
   * at.
   *
   * Reads refs and nothing else, which is what lets the once-bound zoom handler
   * call it safely for the life of the component. Writes `data-named` directly
   * rather than through state: this runs on settle, on every re-sort and on every
   * zoom step, and 124 re-renders a step would undo the reason the coordinates
   * live outside React at all.
   *
   * `--zoom` is set here rather than on every zoom event so the type on screen and
   * the boxes the choice was made with always agree. They can drift by up to
   * `ZOOM_STEP` mid-gesture, which is invisible, where writing it every frame
   * would restyle every label on the map for the same result.
   */
  const applyNames = () => {
    const svg = svgRef.current;
    const layout = layoutRef.current;
    if (!svg || !layout) return;

    const scale = scaleRef.current;
    namedAtRef.current = scale;
    svg.style.setProperty("--zoom", scale.toFixed(3));

    const named = visibleLabels({
      nodes: layout.nodes,
      marks: layout.marks,
      lit: litRef.current,
      scale,
    });

    for (const node of layout.nodes) {
      if (node.kind !== "film") continue;
      const el = nodeEls.current.get(node.id);
      if (el) el.dataset.named = named.has(node.id) ? "true" : "false";
    }
  };

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (!svg || !viewport) return;

    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 6])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        // A null sourceEvent means we moved the view, not the user.
        if (event.sourceEvent) exploredRef.current = true;
        viewport.setAttribute("transform", event.transform.toString());

        const { k } = event.transform;
        scaleRef.current = k;
        // Titles hold their size on screen, so a new scale means a new answer to
        // how many of them fit — but only worth asking once the change is real.
        if (Math.abs(Math.log(k / namedAtRef.current)) > ZOOM_STEP) applyNames();
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
      /*
        After framing, never before: `frame` goes through the zoom behaviour, so
        it is what tells us the scale the map is about to be read at, and the
        label choice is a function of that scale.
      */
      applyNames();
      if (reducedMotion) return;

      // Re-heat gently, so the map is seen finding its last few millimetres.
      // Names are chosen again at the end of it, against where the dots actually
      // stopped rather than where `settle` left them.
      simulation.on("tick", paint).on("end", applyNames).alpha(0.18).restart();
      return () => {
        simulation.on("tick", null).on("end", null).stop();
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
        /*
          And only now choose the names. A re-sort is a hundred films in flight;
          recomputing mid-journey would flicker titles on and off as dots passed
          each other, and every intermediate answer would be about an arrangement
          nobody is going to read. Films that were already named keep their titles
          for the trip, so names travel with their dots — the new ones arrive when
          the map settles, which is when there is something to read.
        */
        applyNames();
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

  /*
    Searching or filtering changes which titles the map should spend its space on:
    a lit film gets first refusal, so the answer has to be computed again even
    though nothing moved. Mirrored into a ref in the same step, so the once-bound
    zoom handler keeps seeing the current query.
  */
  useLayoutEffect(() => {
    litRef.current = lit;
    applyNames();
  }, [lit]);

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

  /**
   * Whether a film is lit, or undefined when nothing is narrowing the map.
   *
   * Keyed on `filmId`, deliberately — this is the seam that shipped broken.
   * `narrow` and `searchFilms` answer in film ids, while a node's id is
   * `film:${filmId}`, so testing the wrong one made every film read as unlit: the
   * map dimmed to 8% with nothing highlighted, while the count beside the search
   * box stayed correct and made the failure look cosmetic. Asserted in
   * `domain/filters.test.ts`.
   */
  const litState = (node: GraphNode): string | undefined => {
    if (lit === null || node.filmId === null) return undefined;
    return String(lit.has(node.filmId));
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
        data-narrowed={lit ? "true" : "false"}
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
                    <text x={MARK_TICK} dx="0.7em" dy="0.32em">
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
                    data-lit={litState(node)}
                    role="button"
                    tabIndex={-1}
                    aria-label={filmDescription(node)}
                    aria-pressed={node.id === focusedId}
                    onClick={() => toggle(node.id)}
                  >
                    <circle r={radius} />
                    {/*
                      The gap to the dot is an `em`, not a constant: type here is
                      counter-scaled by `--zoom`, so an offset in px would close up
                      as the user zoomed in and titles would end up sitting on their
                      own dots. `viz/labels.ts` duplicates these two numbers in
                      order to place its boxes, and a test pins them together.
                    */}
                    <text className="eiga-label" y={radius} dy="1.1em">
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
                    <text className="eiga-label" y={-radius} dy="-0.9em">
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
