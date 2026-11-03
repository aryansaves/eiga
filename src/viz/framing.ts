import {
  fitToFrame,
  FRAME_INSET,
  FRAME_INSET_BARE,
  type FitTransform,
  type LayoutNode,
  type YearRow,
} from "./layout.ts";

export const PHONE_WIDTH = 640;

/** Fit the complete atlas inside the space left by its surrounding controls. */
export function frameAtlas(
  nodes: readonly LayoutNode[],
  width: number,
  height: number,
  rows: readonly YearRow[] = [],
  framed = false,
): FitTransform {
  const inset = framed || width < PHONE_WIDTH ? FRAME_INSET_BARE : FRAME_INSET;
  return fitToFrame(nodes, width, height, rows, inset);
}
