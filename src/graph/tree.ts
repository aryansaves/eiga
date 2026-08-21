/**
 * The discovery tree — how a viewing life branched.
 *
 * The diary thread answers *what has my watching been like* as one continuous
 * line: film 40 follows film 39 because that is the order the days fell in. It is
 * honest and it is flat. Nothing about it says that a Thursday spent on a 1962
 * French film and the Friday after it spent on a 1996 American one are two
 * different reaches into film history rather than one continuous motion.
 *
 * This topology says that. Every film hangs from the film **nearest it in release
 * year** that had already been seen, so the map grows limbs: reach into a new part
 * of history and a limb splits off, then everything later watched from near that
 * era grows along it. The root is the first film ever logged.
 *
 * Like `thread.ts` this joins films directly to films, and for the same reason
 * `build.ts` allows: a tree over n films is n−1 edges. The rule being avoided is
 * quadratic growth, not adjacency.
 *
 * ## The branching rule
 *
 * Over films in watch order, `parent(f)` is the already-watched `p` minimising
 *
 *     |releaseYear(f) − releaseYear(p)| + RATING_WEIGHT × |rating(f) − rating(p)|
 *
 * with ties going to the most recently watched candidate, and the rating term
 * contributing nothing when either film is unrated.
 *
 * The rating term is not decoration. Release year alone collapses on a library
 * bought entirely from one era: every candidate scores zero, the tie-break picks
 * the previous film every time, and the tree degenerates into the diary chain it
 * was built to improve on — measured at depth 299 on a synthetic all-one-year
 * library, against 15 with the term. It also encodes something true: two films
 * from the same decade rated a star apart were not the same kind of reach.
 *
 * A recency term was tried and rejected. Biasing toward the most recent film is
 * chain-forming by construction, and it made depth *worse* at every library size
 * tested. See ADR-009.
 *
 * ## Two decisions carried over from the thread, deliberately
 *
 *  1. **One film is one dot**, placed at its earliest dated viewing. A rewatch is
 *     not a second film, and a film cannot hang from two parents without ceasing
 *     to be a tree.
 *  2. **A film the axis cannot place joins nothing.** Here that means missing
 *     *either* a readable watch date or a release year: the first leaves it with no
 *     position along time and no place in the watch order the rule reads, and the
 *     second leaves it with nothing to be near. Attaching such a film to the most
 *     recently watched one would put it on a row labelled "1990s" while carrying no
 *     claim to be from the 1990s, which is the loudest kind of quiet lie a map can
 *     tell. They stay as nodes — dropping them would misstate the size of a
 *     library — and are drawn in the same parked band the thread uses.
 *
 * Pure and deterministic, and shares `build.ts`'s output types so the layout and
 * the renderer treat all three topologies as one kind of thing.
 */

import { calendarPointOf, type CalendarPoint } from "../domain/calendar.ts";
import { decadeFromYear, type FilmId, type Library } from "../domain/types.ts";
import type { Graph, GraphEdge, GraphNode } from "./build.ts";

/** What one grouping stands for, for the status line and the accessible label. */
export const TREE_GROUP_KIND = "branch point";

/**
 * How much a half-star of disagreement is worth in years of release date.
 *
 * At 0.5 a full star of difference weighs the same as one year, so the rating only
 * ever decides between films already close in release year — which is the intent.
 * It separates same-era films rather than reordering eras: raise it far enough and
 * the tree starts branching on taste instead of on history, which is a different
 * map and not this one.
 */
const RATING_WEIGHT = 0.5;

/** A film the tree can place, with everything the rule needs, in watch order. */
interface Seed {
  readonly filmId: FilmId;
  /** ISO `YYYY-MM-DD`, earliest known viewing. */
  readonly watchedOn: string;
  readonly at: CalendarPoint;
  readonly year: number;
  readonly rating: number | null;
}

/** A film the tree can place, and when it was first seen. */
interface Placement {
  readonly on: string;
  readonly at: CalendarPoint;
}

/**
 * Every film the tree can place, with its earliest readable viewing.
 *
 * The one implementation of what "placeable" means here, because two would drift
 * and the failure mode is an axis control that draws an empty map. `axesFor` asks
 * this the same question `buildTree` does — see {@link placeableFilms}.
 *
 * Unreadable dates are dropped in this pass rather than after it, so a film with
 * one malformed date and one good one is placed on the good one. Filtering
 * afterwards would let the malformed date win the string comparison and take the
 * film off the map with it.
 */
function placements(library: Library): Map<FilmId, Placement> {
  const known = new Map(library.films.map((film) => [film.id, film]));
  const earliest = new Map<FilmId, Placement>();

  for (const watch of library.watches) {
    /*
      A watch naming a film the library does not hold would put a branch on the
      tree with nothing at the end of it. A film with no release year is dropped
      for a longer reason — see the header.
    */
    const film = known.get(watch.filmId);
    if (film === undefined || film.year === null) continue;
    if (watch.watchedOn === null) continue;
    const at = calendarPointOf(watch.watchedOn);
    if (at === null) continue;

    const found = earliest.get(watch.filmId);
    // ISO dates compare correctly as strings, which is most of why the domain
    // model keeps them as strings.
    if (found === undefined || watch.watchedOn < found.on) {
      earliest.set(watch.filmId, { on: watch.watchedOn, at });
    }
  }

  return earliest;
}

/**
 * How many films this tree would have on it.
 *
 * For `axes.ts`, which withholds the axis below two: one film is a root with
 * nothing hanging off it, and a tree with no branches is the diary thread drawn
 * again under a different name.
 */
export function placeableFilms(library: Library): number {
  return placements(library).size;
}

/**
 * The release decades the tree draws rows for, ascending, with gaps filled.
 *
 * Gaps are filled for the reason the timeline fills dormant years: two adjacent
 * rows reading 1950s and 1980s would claim the library spans two decades of
 * cinema when it spans four. Unlike the timeline there is no bound on the run,
 * because there is a natural one — cinema is about fourteen decades old, so the
 * worst case is a map fourteen rows tall, which is within what the timeline
 * already draws for a modest viewing history.
 */
function decadeRows(seeds: readonly Seed[]): readonly number[] {
  if (seeds.length === 0) return [];

  let low = Infinity;
  let high = -Infinity;
  for (const seed of seeds) {
    const decade = decadeFromYear(seed.year);
    if (decade < low) low = decade;
    if (decade > high) high = decade;
  }

  const rows: number[] = [];
  for (let decade = low; decade <= high; decade += 10) rows.push(decade);
  return rows;
}

/** How far apart two films sit under the branching rule. Lower is nearer. */
function distance(a: Seed, b: Seed): number {
  const years = Math.abs(a.year - b.year);
  if (a.rating === null || b.rating === null) return years;
  return years + RATING_WEIGHT * Math.abs(a.rating - b.rating);
}

export function buildTree(library: Library): Graph {
  const filmNodeId = (id: FilmId) => `film:${id}`;

  const known = new Map(library.films.map((film) => [film.id, film]));

  /*
    Watch order, which is the order the rule reads: a film may only hang from one
    already seen. Inside a day the tie is broken by film id, because Letterboxd
    records no time of day — any order within a day is invented, and an arbitrary
    but stable one at least makes the tree identical every time it is built.
  */
  const seeds: Seed[] = [];
  for (const [filmId, when] of [...placements(library).entries()].sort((a, b) =>
    a[1].on === b[1].on ? a[0].localeCompare(b[0]) : a[1].on.localeCompare(b[1].on),
  )) {
    // Re-narrowing rather than trusting the pass above, because `year` is what
    // every line below depends on and TypeScript cannot carry the guarantee here.
    const film = known.get(filmId);
    if (film === undefined || film.year === null) continue;
    seeds.push({
      filmId,
      watchedOn: when.on,
      at: when.at,
      year: film.year,
      rating: library.ratings.get(filmId) ?? null,
    });
  }

  const depth = new Map<FilmId, number>();
  const edges = new Map<string, GraphEdge>();
  const degree = new Map<string, number>();

  // The root: first film logged, hanging from nothing.
  if (seeds.length > 0) depth.set(seeds[0].filmId, 0);

  for (let i = 1; i < seeds.length; i += 1) {
    const child = seeds[i];

    let chosen = 0;
    let nearest = Infinity;
    for (let candidate = 0; candidate < i; candidate += 1) {
      const gap = distance(child, seeds[candidate]);
      /*
        `<=` rather than `<`, and it is the whole tie-break: candidates are in
        watch order, so accepting each equal-scoring one in turn leaves the most
        recently watched holding the position. Preferring the recent film is what
        keeps a limb growing while it is being explored instead of jumping back to
        whichever film from that era happened to be seen first.
      */
      if (gap <= nearest) {
        nearest = gap;
        chosen = candidate;
      }
    }

    const parent = seeds[chosen];
    // Parents are always earlier in `seeds`, so a depth is already recorded.
    depth.set(child.filmId, (depth.get(parent.filmId) ?? 0) + 1);

    const source = filmNodeId(parent.filmId);
    const target = filmNodeId(child.filmId);
    const id = `branch:${source}:${target}`;
    edges.set(id, { id, source, target, kind: "branch" });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }

  const placed = new Map(seeds.map((seed) => [seed.filmId, seed]));

  const nodes: GraphNode[] = library.films.map((film) => {
    const id = filmNodeId(film.id);
    const seed = placed.get(film.id);
    return {
      id,
      kind: "film",
      label: film.title,
      filmId: film.id,
      year: film.year,
      rating: library.ratings.get(film.id) ?? null,
      degree: degree.get(id) ?? 0,
      // Depth, and null for a parked film — so `order` and `when` can never
      // disagree about whether a film is on the map.
      order: seed === undefined ? null : (depth.get(film.id) ?? null),
      when: seed?.at ?? null,
    };
  });

  return {
    // Sorted for determinism: identical input must yield an identical graph.
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    shape: "tree",
    groupKind: TREE_GROUP_KIND,
    rows: decadeRows(seeds),
  };
}
