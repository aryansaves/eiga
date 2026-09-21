import type { Graph } from "../graph/build.ts";

export interface JourneyPoint {
  readonly x: number;
  readonly y: number;
  readonly tangentX: number;
  readonly tangentY: number;
}

/**
 * A continuous path of alternating runs and round turns. Each viewing gets
 * breathing room; longer gaps add distance on a compressed, non-calendar scale.
 * A small wave follows the sequence of ratings, giving each library its own
 * contour. Missing ratings use the midpoint and never imply a zero rating.
 */
export function journeyAnchors(
  graph: Graph,
  width: number,
  height: number,
): ReadonlyMap<string, JourneyPoint> {
  const run = Math.max(200, Math.min(860, width - 240));
  const radius = 68;
  const turn = Math.PI * radius;
  const section = run + turn;
  const stops = graph.nodes
    .filter((node) => node.order !== null)
    .sort((a, b) => a.order! - b.order!);
  const raw = new Map<string, JourneyPoint>();
  let distance = 0;

  stops.forEach((node, index) => {
    if (index > 0) distance += 46 + Math.min(72, Math.log2(1 + (node.gapDays ?? 0)) * 12);
    const row = Math.floor(distance / section);
    const along = distance % section;
    const direction = row % 2 === 0 ? 1 : -1;
    const startX = direction === 1 ? 0 : run;
    const y = row * radius * 2;
    if (along <= run) {
      const wave = Math.sin((Math.PI * along) / run);
      const bend = ((node.rating ?? 2.75) - 2.75) * 9;
      const slope = ((bend * Math.PI) / run) * Math.cos((Math.PI * along) / run);
      const length = Math.hypot(1, slope);
      raw.set(node.id, {
        x: startX + direction * along,
        y: y + bend * wave,
        tangentX: direction / length,
        tangentY: slope / length,
      });
    } else {
      const angle = (along - run) / radius;
      raw.set(node.id, {
        x: startX + direction * run + direction * radius * Math.sin(angle),
        y: y + radius * (1 - Math.cos(angle)),
        tangentX: direction * Math.cos(angle),
        tangentY: Math.sin(angle),
      });
    }
  });

  let floor = 0;
  for (const point of raw.values()) floor = Math.max(floor, point.y);
  const columns = Math.max(1, Math.floor(run / 46));
  graph.nodes
    .filter((node) => node.order === null)
    .forEach((node, index) => {
      raw.set(node.id, {
        x: (index % columns) * 46,
        y: floor + 130 + Math.floor(index / columns) * 60,
        tangentX: 0,
        tangentY: 0,
      });
    });
  if (raw.size === 0) return raw;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const point of raw.values()) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const dx = width / 2 - (minX + maxX) / 2;
  const dy = height / 2 - (minY + maxY) / 2;
  return new Map(
    [...raw].map(([id, point]) => [
      id,
      {
        ...point,
        x: point.x + dx,
        y: point.y + dy,
      },
    ]),
  );
}
