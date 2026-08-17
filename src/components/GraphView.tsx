"use client";

/**
 * The graph surface.
 *
 * The division of labour is strict, because mixing the two is what makes D3 and
 * React painful together:
 *
 *  - React owns structure and state. It renders one `<g>` per node and one
 *    `<line>` per edge, and expresses selection as `data-` attributes that
 *    globals.css turns into a visual hierarchy.
 *  - D3 owns coordinates. On every tick it writes `transform`, `x1`, `y1`, `x2`,
 *    `y2` straight to the DOM through refs. None of those attributes appear in
 *    JSX, so React never fights it for them, and a 60fps simulation costs zero
 *    reconciliation.
 *
 * Accessibility: hubs are in the tab order because they are the structure of the
 * map and there are only a handful. Films are not — a force graph with a hundred
 * tab stops is worse than useless — so they are reachable through the film list
 * in the inspector instead, which is the keyboard-equivalent route to the same
 * selection.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3-zoom";

import { RATING_MAX } from "@/domain/types.ts";
import { neighboursOf, type Graph } from "@/graph/build.ts";
import {
  createLayout,
  endpoint,
  fitToFrame,
  settle,
  type LayoutEdge,
  type LayoutNode,
} from "@/viz/layout.ts";

/** Scale at which titles are worth showing. Below it, only shape and hubs read. */
const DETAIL_ZOOM = 1.6;

/**
 * Relaying out on every resized pixel would thrash, so the layout's coordinate
 * space is quantised. The viewBox still tracks the real size, so the difference
 * only ever shifts the map by less than half a bucket.
 */
const LAYOUT_BUCKET = 64;

type ElementState = "rest" | "anchor" | "near" | "far";

export interface GraphViewProps {
  readonly graph: Graph;
  readonly focusedId: string | null;
  readonly onFocus: (id: string | null) => void;
}

function quantise(value: number): number {
  return Math.max(LAYOUT_BUCKET, Math.round(value / LAYOUT_BUCKET) * LAYOUT_BUCKET);
}

function endpointId(value: string | LayoutNode): string {
  return typeof value === "string" ? value : value.id;
}

function filmDescription(node: LayoutNode): string {
  const year = node.year === null ? "year unknown" : String(node.year);
  const rating = node.rating === null ? "unrated" : `rated ${node.rating}`;
  return `${node.label}, ${year}, ${rating}`;
}

export function GraphView({ graph, focusedId, onFocus }: GraphViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  /** Set once the user pans or zooms, after which the view is theirs to keep. */
  const exploredRef = useRef(false);

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        setSize({ width: box.width, height: box.height });
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const layoutWidth = size ? quantise(size.width) : 0;
  const layoutHeight = size ? quantise(size.height) : 0;

  const layout = useMemo(
    () =>
      layoutWidth && layoutHeight
        ? createLayout(graph, layoutWidth, layoutHeight)
        : null,
    [graph, layoutWidth, layoutHeight],
  );

  /*
    Zoom is installed before the simulation runs, because the framing pass below
    has to go through this behaviour rather than around it — writing the viewport
    transform directly would leave d3-zoom's internal state stale, and the user's
    next scroll would snap the map back.
  */
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

  // Positions: written straight to the DOM, never through React state.
  useLayoutEffect(() => {
    if (!layout) return;
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

    /*
      Settle before showing anything. Watching a hundred films fly out from a
      common point is a loading screen pretending to be an insight, and it also
      means the framing below has a stable shape to measure.
    */
    settle(simulation);
    paint();
    exploredRef.current = false;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Then re-heat gently, so the map is seen finding its last few millimetres.
    simulation.on("tick", paint).alpha(0.18).restart();

    return () => {
      simulation.on("tick", null);
      simulation.stop();
    };
  }, [layout]);

  /*
    Framing. Runs after the layout has settled and again on resize, but never
    once the user has moved the view themselves — re-centring someone's map out
    from under them while they are reading it is worse than an imperfect fit.
  */
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const behaviour = zoomRef.current;
    if (!layout || !svg || !behaviour || !size) return;
    if (exploredRef.current) return;

    const fit = fitToFrame(layout.nodes, size.width, size.height);
    behaviour.transform(select(svg), zoomIdentity.translate(fit.x, fit.y).scale(fit.k));
  }, [layout, size]);

  const neighbours = useMemo(
    () => (focusedId ? neighboursOf(graph, focusedId) : null),
    [graph, focusedId],
  );

  const nodeState = (id: string): ElementState => {
    if (!focusedId) return "rest";
    if (id === focusedId) return "anchor";
    return neighbours?.has(id) ? "near" : "far";
  };

  const edgeState = (edge: LayoutEdge): ElementState => {
    if (!focusedId) return "rest";
    const touches =
      endpointId(edge.source) === focusedId || endpointId(edge.target) === focusedId;
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

  const toggle = (id: string) => onFocus(id === focusedId ? null : id);

  const films = layout?.nodes.filter((node) => node.kind === "film") ?? [];
  const hubs = layout?.nodes.filter((node) => node.kind === "hub") ?? [];

  return (
    <div ref={hostRef} className="eiga-grid relative h-full w-full">
      <svg
        ref={svgRef}
        className="eiga-graph"
        viewBox={`0 0 ${size?.width ?? 0} ${size?.height ?? 0}`}
        data-focused={focusedId ? "true" : "false"}
        role="group"
        aria-label={`Map of ${films.length} films across ${hubs.length} ${graph.hubKind} groups`}
        // Clicking the surface itself — not a node — releases the anchor.
        onClick={(event) => {
          if (event.target === event.currentTarget) onFocus(null);
        }}
      >
        <g ref={viewportRef}>
          <g>
            {layout?.edges.map((edge) => (
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
            {films.map((node) => (
              <g
                key={node.id}
                ref={registerNode(node.id)}
                className="eiga-node eiga-film"
                data-state={nodeState(node.id)}
                data-loved={node.rating === RATING_MAX ? "true" : "false"}
                role="button"
                tabIndex={-1}
                aria-label={filmDescription(node)}
                aria-pressed={node.id === focusedId}
                onClick={() => toggle(node.id)}
              >
                <circle r={node.radius} />
                <text className="eiga-label" y={node.radius + 11}>
                  {node.label}
                </text>
              </g>
            ))}
          </g>

          <g>
            {hubs.map((node) => (
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
                <circle r={node.radius} />
                <text className="eiga-label" y={-(node.radius + 8)}>
                  {node.label}
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
