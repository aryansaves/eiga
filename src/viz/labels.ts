/**
 * Which titles the map is allowed to show.
 *
 * The reported bug, in the user's words: "the names of the movie are so close they
 * are unreadable and clogged". The mechanism this replaces was a single zoom
 * threshold — every title at once past 1.6× — which is not a hierarchy, it is a
 * switch. A hundred titles arriving together are a wall of text with a map behind
 * it, and on the diary timeline it is worse than on a hub map: a busy year puts a
 * hundred films along one 1,040px row, so their titles overlap several deep while
 * the dots themselves are still comfortably apart.
 *
 * So names are *chosen* rather than revealed. Boxes are laid down in priority
 * order and a title is kept only if its box misses every box already kept — the
 * standard cartographic answer, and the only one that degrades gracefully: at any
 * zoom the map shows as many names as fit and not one more.
 *
 * Pure, and deliberately not measuring the DOM. A `getBBox` per label per zoom
 * step would be exact and would also be a synchronous layout per label; widths
 * here are estimated from character count, which is cheap, testable in Node, and
 * wrong by a few percent on strings this short. Erring wide is the safe direction:
 * an over-wide box costs a name, an under-wide one prints two names on top of each
 * other, which is the thing being fixed.
 *
 * **Screen space, not map space.** Titles hold their size on screen while the map
 * scales under them — `--zoom` in globals.css — so a box shrinks in map
 * coordinates as the user zooms in, and more names fit with no second mechanism.
 * That is what makes `scale` load-bearing here rather than decorative: with text
 * that scaled with the map, crowding would be identical at every zoom and there
 * would be nothing to compute.
 *
 * Keeping the decision in a function the renderer *calls*, rather than inlining
 * the collision test where labels are written, is also what makes the deferred
 * anonymous share link a caller change instead of a refactor — a map with no names
 * is this returning empty.
 */

import { YEAR_LABEL_GAP, type LayoutNode, type YearRow } from "./layout.ts";

/** A label's footprint, in map coordinates. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Everything the choice depends on.
 *
 * An object rather than the two positional arguments this started as, because the
 * answer is not a function of the nodes alone: year marks occupy space without
 * being nodes, and which films the user is currently looking for changes the
 * order names are handed out in.
 */
export interface LabelPlan {
  readonly nodes: readonly LayoutNode[];
  /** Year rows, which claim their space without being nodes. Empty on a hub map. */
  readonly rows: readonly YearRow[];
  /**
   * Films lit by the search and filters, or null when neither is narrowing.
   *
   * Keyed by **film id**, not node id — the same seam that shipped broken once and
   * is asserted in `domain/filters.test.ts`. See `litState` in `GraphView`.
   */
  readonly lit: ReadonlySet<string> | null;
  /** The live zoom scale. Titles are screen-sized, so this sets their footprint. */
  readonly scale: number;
}

/**
 * Zoom below which the map carries no titles at all.
 *
 * An authored choice, not a technical floor — the collision test alone would
 * happily hand out four or five names at minimum zoom. But zoomed this far out the
 * map is being read as a shape: the reach of a viewing life, where the fives fall,
 * how busy a year was. Five arbitrary titles floating on that are not information,
 * they are litter. `fitToFrame` caps scale at 1, so a modest library opens with
 * names and a very wide hub map opens without them, which is the right way round.
 */
export const LABEL_FLOOR = 0.5;

/*
  Type metrics, mirroring globals.css and the `y`/`dy` attributes GraphView
  writes. Duplicated on purpose: the alternative is measuring the DOM, and this
  function's whole value is being pure. Drift shows up as titles that touch, and
  `GLYPH` is the one constant to reach for when it does.
*/

/** Font sizes in screen px: `.eiga-film`, `.eiga-hub`, `.eiga-year`. */
const FONT_FILM = 10;
const FONT_HUB = 9;
const FONT_YEAR = 8;

/** Letter-spacing in em. Hub labels are tracked and uppercased; films are not. */
const TRACK_HUB = 0.22;
const TRACK_YEAR = 0.08;

/**
 * Average glyph advance as a fraction of font size.
 *
 * Measured against the system sans stack this reads slightly wide for mixed-case
 * film titles, which is the direction to be wrong in. Lower it if the map feels
 * stingy with names; raise it if two titles ever touch.
 */
const GLYPH = 0.55;

/** Height above and below the baseline, as a fraction of font size. */
const ASCENT = 0.78;
const DESCENT = 0.24;

/**
 * Clear space around a title, as a fraction of its own font size.
 *
 * The density knob, and the one number here chosen by eye rather than derived.
 * Overlap alone is a low bar: measured on a 124-film thread, boxes padded just
 * enough to cover the halo accept 32 titles at rest, which do not touch and still
 * tile a third of the disc in text. At 0.7 it is 21, around 18% of the disc in
 * ink, which is roughly what a printed map carries — and the figure holds across
 * library sizes, since both the disc and the count grow together.
 *
 * Applied on all four sides, because vertical crowding is its own problem: two
 * titles a glyph-height apart do not overlap and still read as a paragraph.
 */
const PAD = 0.7;

/** Baseline offsets in em, matching the `dy` the renderer writes. */
const DY_FILM = 1.1;
const DY_HUB = -0.9;
const DY_YEAR = 0.32;

/** How wide a run of text is, near enough. */
function extent(label: string, size: number, tracking: number): number {
  return label.length * size * (GLYPH + tracking);
}

/** A padded box around a run of text sitting on a baseline. */
function around(left: number, right: number, baseline: number, size: number): Box {
  const pad = PAD * size;
  return {
    left: left - pad,
    right: right + pad,
    top: baseline - ASCENT * size - pad,
    bottom: baseline + DESCENT * size + pad,
  };
}

/**
 * Where a node's label sits, if it is drawn.
 *
 * Exported so tests can assert the invariant this module exists for — that no two
 * accepted labels overlap — against the same geometry the choice was made with,
 * rather than against a second copy of it that could quietly disagree.
 */
export function labelBox(node: LayoutNode, scale: number): Box {
  const hub = node.kind === "hub";
  const size = (hub ? FONT_HUB : FONT_FILM) / scale;
  const half = extent(node.label, size, hub ? TRACK_HUB : 0) / 2;
  // Films hang below their dot, hubs sit above: mirrors GraphView's `y` and `dy`.
  const baseline = hub
    ? node.y - node.radius + DY_HUB * size
    : node.y + node.radius + DY_FILM * size;
  return around(node.x - half, node.x + half, baseline, size);
}

/** The optional journey caption above a stop, reserved with its film title. */
function milestoneBox(node: LayoutNode, scale: number): Box | null {
  if (!node.milestone) return null;
  const captionSize = 9 / scale;
  const captionHalf = extent(node.milestone, captionSize, 0.08) / 2;
  return around(node.x - captionHalf, node.x + captionHalf,
    node.y - node.radius - 1.1 * captionSize, captionSize);
}

/**
 * A year row's label, which is right-anchored in the margin left of the row.
 *
 * Exported for the same reason as `labelBox`: the tests assert that no film is
 * named over the graticule, and they have to ask this module where the graticule's
 * text is rather than keeping a second copy of the answer.
 *
 * A margin rather than a mark on the row itself, which is where it sat when the
 * timeline was a spiral and a year was a tick somewhere inside the map. Ten years
 * of labels down one edge is a printed chart's axis; ten numbers scattered through
 * the films is ten more things competing with the titles.
 */
export function yearLabelBox(row: YearRow, scale: number): Box {
  const size = FONT_YEAR / scale;
  const right = row.left - YEAR_LABEL_GAP;
  const width = extent(String(row.year), size, TRACK_YEAR);
  return around(right - width, right, row.y + DY_YEAR * size, size);
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The films whose titles the map can show at this zoom, by node id.
 *
 * Hubs and year marks are not in the answer because they are never in question:
 * they are drawn unconditionally and only *claim* space here. Structure outranks
 * subject — a cluster or a year with no name leaves the reader without an answer
 * to "what am I looking at", which is a worse map than one where a film is a dot
 * you have to hover.
 *
 * That ranking has a consequence worth stating rather than discovering: a film the
 * user has just searched for, whose title would land on a year mark, is lit and
 * framed but not named. It is readable by hovering it or from the inspector, and
 * the alternative is printing two pieces of text over each other — which is the
 * bug this module exists to fix, so it stays absolute.
 *
 * Among films the order is: lit first, then by rating, then by id. Lit first is
 * what stops a query that matches forty titles from re-clogging the map — they
 * compete for space like anything else, they just get first refusal. Rating next
 * makes the named films the ones the user thought most of, which is the same claim
 * the citron fives make. Id last is only there so the answer never depends on the
 * order `graph.nodes` happened to arrive in.
 */
export function visibleLabels(plan: LabelPlan): ReadonlySet<string> {
  const named = new Set<string>();
  if (plan.scale < LABEL_FLOOR) return named;

  const taken: Box[] = plan.rows.map((row) => yearLabelBox(row, plan.scale));
  const films: LayoutNode[] = [];
  for (const node of plan.nodes) {
    if (node.kind === "hub") taken.push(labelBox(node, plan.scale));
    else films.push(node);
  }

  const isLit = (node: LayoutNode) =>
    plan.lit !== null && node.filmId !== null && plan.lit.has(node.filmId);

  films.sort((a, b) => {
    const byLit = Number(isLit(b)) - Number(isLit(a));
    if (byLit !== 0) return byLit;
    const byMilestone = Number(Boolean(b.milestone)) - Number(Boolean(a.milestone));
    if (byMilestone !== 0) return byMilestone;
    const byRating = (b.rating ?? -1) - (a.rating ?? -1);
    if (byRating !== 0) return byRating;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  for (const film of films) {
    const boxes = [labelBox(film, plan.scale), milestoneBox(film, plan.scale)]
      .filter((box): box is Box => box !== null);
    if (boxes.some((box) => taken.some((other) => overlaps(other, box)))) continue;
    taken.push(...boxes);
    named.add(film.id);
  }

  return named;
}
