"use client";

/**
 * The graph surface.
 *
 * The division of labour is strict, because mixing the two is what makes D3 and
 * React painful together. The line is drawn by what a value *derives from*, not
 * by which element it lands on:
 *
 *  - React owns structure and everything derived from the `Graph`. It renders one
 *    `<g>` per node and one line per edge, and expresses selection, rating and lit
 *    state as `data-` attributes that globals.css turns into a visual hierarchy.
 *    The year graticule counts as structure too: which years exist, and where each
 *    month falls inside one, are facts about the calendar rather than about where
 *    the simulation came to rest.
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
import { zoom, zoomIdentity, zoomTransform, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

import { monthStarts } from "@/domain/calendar.ts";
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
  MONTH_TICK,
  positionsOf,
  settle,
  YEAR_LABEL_GAP,
  YEAR_WIDTH,
  type LayoutHandle,
  type Position,
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

/**
 * How far the December→January link reaches past its own ends, in layout px.
 *
 * Every other chain edge joins two films a few days apart and is drawn straight.
 * This one crosses a year boundary, and because the years are stacked as rows that
 * means it runs from somewhere near the right of one row to somewhere near the left
 * of the row below — the width of the whole map. Drawn straight it would cut a
 * diagonal through every film in both rows.
 *
 * So it is drawn as a cubic instead, with both control points displaced *outward*
 * and half a row down. The curve leaves to the right, flattens out through the empty
 * band between the rows, and re-enters from the left: a carriage return, which is
 * exactly what it is. `wrapPath` works out why the arithmetic lands in the gutter.
 */
const WRAP_REACH = 44;

/**
 * The path for a wrap edge: out to the right, along the gutter, back in at the left.
 *
 * The two control points sit at the same height, half way between the rows, which is
 * what puts the flat middle of the curve in the empty band. Worth showing, since it
 * is the one thing this function has to get right: for a cubic, the point at
 * t = ½ is (P₀ + 3P₁ + 3P₂ + P₃) ÷ 8, and with both controls at y + Δ/2 that is
 * y + (1 + 3·½ + 3·½ + 1)·Δ/8 … = y + Δ/2 exactly. The reaches cancel in x for the
 * same reason, so the sweep is centred whatever the dates at either end happen to be.
 */
function wrapPath(from: Position, to: Position): string {
  const sag = (to.y - from.y) / 2;
  const c1 = `${(from.x + WRAP_REACH).toFixed(2)} ${(from.y + sag).toFixed(2)}`;
  const c2 = `${(to.x - WRAP_REACH).toFixed(2)} ${(to.y - sag).toFixed(2)}`;
  return `M${from.x.toFixed(2)} ${from.y.toFixed(2)}C${c1} ${c2} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

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
   * Films the view should travel to, or null to return to wherever it was.
   *
   * Deliberately a separate prop from `lit` rather than derived from it. `lit` is
   * the union of the search and the highlight chips, and a chip lighting forty
   * films spread across the whole map has nothing to travel *to* — framing that
   * set is a zoom out to the map already on screen, so pressing "Liked" would jerk
   * the view for no gain. A search names a film, which is a place. Passing the
   * search's own answer separately keeps that distinction in `Atlas`, where it is
   * a fact about the query, instead of teaching this component what a query is.
   *
   * Film ids, like `lit`, for the same reason: see `litState`.
   */
  readonly travel: ReadonlySet<string> | null;
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
 * groups films, and the thread places them on a calendar. `groupCount` supplies the
 * number in both cases, so this can never disagree with the status line beneath the
 * map.
 *
 * The thread wording carries the span because the row stack is the one thing a
 * screen reader cannot see and the year labels are the only place it is written
 * down. Saying "in the order they were watched" — true of the spiral this replaced —
 * would now describe the sequence and omit the scale.
 */
function mapDescription(graph: Graph, films: number): string {
  const groups = groupCount(graph);
  if (graph.shape !== "thread") {
    return `Map of ${films} films across ${groups} ${graph.groupKind} groups`;
  }
  const first = graph.years[0];
  const last = graph.years[graph.years.length - 1];
  const span =
    first === undefined ? "" : first === last ? ` in ${first}` : ` from ${first} to ${last}`;
  return `Map of ${films} films on the days they were watched, across ${groups} days${span}`;
}

export function GraphView({ graph, focusedId, onFocus, lit, travel, surfaceRef }: GraphViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement | SVGPathElement>());
  /**
   * The year rows, keyed by year.
   *
   * One element each, not four: a row's rule, its twelve month ticks and its number
   * are all placed relative to the row's own left end, so the only coordinate the
   * simulation contributes is where that end is. Everything inside is a fixed offset
   * React can write once.
   */
  const rowEls = useRef(new Map<number, SVGGElement>());
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  /** Set once the user pans or zooms, after which the view is theirs to keep. */
  const exploredRef = useRef(false);
  /**
   * The view a search took the user away from, or null if there is nothing to
   * return them to.
   *
   * Saved on the transition into searching rather than on every keystroke, so
   * refining a query narrows the framing without losing the place to come back to.
   * Cleared the moment the user pans or zooms themselves: restoring a pre-search
   * framing over a gesture they just made would undo their own work on a keystroke
   * they did not make.
   */
  const beforeTravelRef = useRef<ZoomTransform | null>(null);
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
      rows: layout.rows,
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
        if (event.sourceEvent) {
          exploredRef.current = true;
          // And once they have moved it, there is nowhere to put them back.
          beforeTravelRef.current = null;
        }
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
  const frameTo = (layout: LayoutHandle, viewport: Viewport | null) => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (!svg || !behaviour || !viewport || exploredRef.current) return;

    // The whole handle rather than its nodes, because a year row is part of the
    // extent the map has to be framed to and is not a node — see `fitToFrame`.
    const fit = fitToFrame(layout.nodes, viewport.width, viewport.height, layout.rows);
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
        const el = edgeEls.current.get(edge.id);
        const from = endpoint(edge.source);
        const to = endpoint(edge.target);
        if (!el || !from || !to) continue;
        // A wrap is a `<path>` and everything else a `<line>` — see `wrapPath`.
        if (edge.kind === "wrap") {
          el.setAttribute("d", wrapPath(from, to));
          continue;
        }
        el.setAttribute("x1", from.x.toFixed(2));
        el.setAttribute("y1", from.y.toFixed(2));
        el.setAttribute("x2", to.x.toFixed(2));
        el.setAttribute("y2", to.y.toFixed(2));
      }
    };

    const frame = () => frameTo(layout, sizeRef.current);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /*
      Year rows are placed once and never again. They are the map's graticule:
      fixed to the calendar while the films settle against it, which is the
      relationship a printed map has between its grid and its terrain — and a
      graticule that drifted with the terrain would be measuring nothing.

      Only the row's left end is written here. The rule, the twelve month ticks and
      the number are all offsets from it, so React has already placed them.
    */
    for (const row of layout.rows) {
      rowEls.current
        .get(row.year)
        ?.setAttribute("transform", `translate(${row.left.toFixed(2)} ${row.y.toFixed(2)})`);
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
    frameTo(layout, size);
  }, [size]);

  /*
    Take the user to the match, and bring them back.

    Searching dims rather than filters, which keeps the map's shape — but on a
    hundred-film library the answer can be a single lit dot two screens away, and a
    highlight nobody can find is the same as no answer. So a search that matched
    something frames what it matched, and clearing the field returns the view to
    where it was before the first match.

    Ordered before the `lit` effect on purpose. This changes the scale, and the
    scale is what decides how many titles fit; `applyNames` there then runs last,
    against the framing the user is actually about to read.

    Framed instantly rather than travelled to over 400ms. That is the same idiom as
    `frameTo`, and the alternative costs a `d3-transition` import plus a moving
    target for the next keystroke to interrupt — the citron ring on the match is
    what says "this is the thing", and it is already there when the view arrives.

    Never sets `exploredRef`: a programmatic transform arrives with
    `sourceEvent === null`, so d3 cannot mistake this for the user panning, and a
    search does not cost them the automatic framing on their next resize.
  */
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    const layout = layoutRef.current;
    const viewport = sizeRef.current;
    if (!svg || !behaviour || !layout || !viewport) return;

    if (travel === null) {
      const held = beforeTravelRef.current;
      if (!held) return;
      beforeTravelRef.current = null;
      behaviour.transform(select(svg), held);
      return;
    }

    /*
      Mid-re-sort the coordinates are in flight, so there is nothing to frame:
      films are somewhere between two axes and the fit would land the view on empty
      space. Skipping leaves the map where it is, which is the better failure — and
      because nothing was saved, clearing the field correctly does nothing either.
    */
    if (animatingRef.current) return;

    const matches = layout.nodes.filter(
      (node) => node.filmId !== null && travel.has(node.filmId),
    );
    // A search that matched nothing has no place to go. The count beside the field
    // is the report; the view stays put rather than framing an empty extent.
    if (matches.length === 0) return;

    beforeTravelRef.current ??= zoomTransform(svg);

    /*
      No rows passed, unlike `frameTo`: this frames the films that matched, not the
      calendar they sit on. Including the graticule would widen every fit to a whole
      year and defeat the point of travelling at all.

      `fitToFrame` caps the scale at 1, which is what stops one match from becoming
      one enormous dot filling the screen — a single film's extent is some 13px
      across, so the uncapped fit would be about 90×.
    */
    const fit = fitToFrame(matches, viewport.width, viewport.height);
    behaviour.transform(select(svg), zoomIdentity.translate(fit.x, fit.y).scale(fit.k));
  }, [travel]);

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

  const registerEdge = (id: string) => (el: SVGLineElement | SVGPathElement | null) => {
    if (el) edgeEls.current.set(id, el);
    else edgeEls.current.delete(id);
  };

  const registerRow = (year: number) => (el: SVGGElement | null) => {
    if (el) rowEls.current.set(year, el);
    else rowEls.current.delete(year);
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
            The year rows, underneath everything — a graticule the map is drawn
            over, never a thing in it. Deliberately not nodes: a year that could be
            clicked, focused or counted would be a hub, and the timeline has none.

            Each row is a group placed at its own January 1st, so everything in it is
            written in offsets from there: the rule runs the width of a year, the
            ticks stand at the true start of each month, and the number sits out in
            the left margin. Rendered from `graph.years`, positioned from
            `layout.rows`, which is the same division of labour as every node here.
          */}
          <g aria-hidden="true">
            {ready &&
              graph.years.map((year) => (
                <g key={year} ref={registerRow(year)} className="eiga-year">
                  <line className="eiga-year-rule" x2={YEAR_WIDTH} />
                  {/*
                    Twelve, and unevenly spaced: February is 28 days of 365, so the
                    March tick belongs a few pixels left of an even twelfth. The same
                    function places the films, which is the point of `domain/calendar`.
                  */}
                  {monthStarts(year).map((fraction, month) => {
                    const x = fraction * YEAR_WIDTH;
                    return (
                      <line
                        key={month}
                        className="eiga-year-tick"
                        x1={x}
                        x2={x}
                        y1={-MONTH_TICK}
                        y2={MONTH_TICK}
                      />
                    );
                  })}
                  <text x={-YEAR_LABEL_GAP} dy="0.32em">
                    {year}
                  </text>
                </g>
              ))}
          </g>

          <g>
            {ready &&
              graph.edges.map((edge) =>
                /*
                  A wrap crosses a year boundary, which on a stacked map is the width
                  of the whole thing, so it is the one edge drawn as a curve rather
                  than a straight line. Both branches carry identical attributes: the
                  element differs, the state does not.
                */
                edge.kind === "wrap" ? (
                  <path
                    key={edge.id}
                    ref={registerEdge(edge.id)}
                    className="eiga-edge"
                    data-kind={edge.kind}
                    data-state={edgeState(edge)}
                  />
                ) : (
                  <line
                    key={edge.id}
                    ref={registerEdge(edge.id)}
                    className="eiga-edge"
                    data-kind={edge.kind}
                    data-state={edgeState(edge)}
                  />
                ),
              )}
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
