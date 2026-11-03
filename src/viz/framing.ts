import {
  fitToFrame,
  FRAME_INSET,
  FRAME_INSET_BARE,
  type FitTransform,
  type LayoutNode,
  type YearRow,
} from "./layout.ts";

export const PHONE_WIDTH = 640;
const READING_SCALE = 0.8;

/** Phones open on readable detail; Fit all remains an explicit overview. */
export function frameAtlas(
  nodes: readonly LayoutNode[],
  width: number,
  height: number,
  rows: readonly YearRow[] = [],
  framed = false,
  overview = false,
): FitTransform {
  const inset = framed || width < PHONE_WIDTH ? FRAME_INSET_BARE : FRAME_INSET;
  const fit = fitToFrame(nodes, width, height, rows, inset);
  if (overview || width >= PHONE_WIDTH || fit.k >= READING_SCALE) return fit;

  // The latest dated stop gives a long journey a meaningful entrance. Attribute
  // maps open at their busiest hub, rather than the empty space between clusters.
  const dated = nodes.filter((node) => node.kind === "film" && node.order !== null);
  const anchor = dated.length
    ? dated.reduce((latest, node) => (node.order! > latest.order! ? node : latest))
    : (nodes
        .filter((node) => node.kind === "hub")
        .reduce<LayoutNode | null>(
          (largest, node) => (!largest || node.degree > largest.degree ? node : largest),
          null,
        ) ?? nodes[0]);
  if (!anchor) return fit;

  return {
    k: READING_SCALE,
    // Keep the winding path horizontally centred rather than centring one end
    // of a turn and needlessly clipping the other side. Leave more room for the
    // earlier stops above the latest viewing than for the short undated tail.
    x: dated.length
      ? width / 2 - ((width / 2 - fit.x) / fit.k) * READING_SCALE
      : width / 2 - anchor.x * READING_SCALE,
    y: height * (dated.length ? 0.7 : 0.5) - anchor.y * READING_SCALE,
  };
}
