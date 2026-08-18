/**
 * What to light up on the map.
 *
 * Mirrors the `AXES` registry in `graph/axes.ts` deliberately: pure descriptors in
 * one place, so a component holds an id and the set can grow without the UI
 * learning about it. The difference is that axes are exclusive and these are not —
 * an axis decides what the map *means*, a filter decides which of its dots are
 * worth looking at, and you can reasonably want two of the latter at once.
 *
 * Filtering here means *lighting*, never removing. A map that deleted its
 * unmatched films would lose the shape that gives the lit ones their meaning: the
 * whole reading of "eight rewatches, all of them in one winter" is where those
 * eight sit relative to everything else. So this module only ever answers *which
 * films*, and the renderer dims the rest.
 *
 * Search lives here too rather than beside it, because the two combine into one
 * answer and the map can only be in one state. Keeping them apart would leave the
 * question "does the search apply within the filter or beside it?" to be answered
 * by whichever component happened to read them last.
 */

import { searchFilms } from "./search.ts";
import type { FilmId, Library } from "./types.ts";

export type FilterId = "liked" | "rewatched";

/**
 * One way of picking films out of a library.
 *
 * Private: `filtersFor` is the only door, and it hands out the *result* of
 * `select` rather than the function. That is what stops a chip's count from being
 * computed by one caller and the lit set by another, which is exactly the class of
 * bug that let the search highlight ship broken.
 */
interface Filter {
  readonly id: FilterId;
  /** How the control names it. Rendered uppercase; stored in sentence case. */
  readonly label: string;
  select(library: Library): ReadonlySet<FilmId>;
}

/**
 * Restricts a set of ids to films the library actually holds.
 *
 * Every filter passes through this so a chip's count is always the number of dots
 * that will light. `Library.likes` is documented as a subset of `films` and the
 * importer enforces it — but a count that can disagree with the map is not worth
 * resting on a promise made in another module, and the demo and the tests build
 * libraries by hand.
 */
function onlyKnown(library: Library, ids: Iterable<FilmId>): ReadonlySet<FilmId> {
  const known = new Set(library.films.map((film) => film.id));
  const found = new Set<FilmId>();
  for (const id of ids) {
    if (known.has(id)) found.add(id);
  }
  return found;
}

const FILTERS: readonly Filter[] = [
  {
    id: "liked",
    label: "Liked",
    select: (library) => onlyKnown(library, library.likes),
  },
  {
    id: "rewatched",
    label: "Rewatched",
    /*
      A film, not a viewing. Someone who has returned to a film four times is one
      dot on the map, so they are one entry here — the count answers "how many
      films have I gone back to", which is the question the chip appears to ask.
    */
    select: (library) =>
      onlyKnown(
        library,
        library.watches.filter((watch) => watch.rewatch).map((watch) => watch.filmId),
      ),
  },
];

/** A filter and the films it would light, ready for a control to render. */
export interface FilterOption {
  readonly id: FilterId;
  readonly label: string;
  /**
   * Computed once, here, and handed on: the control shows `films.size` and
   * `narrow` unions the same sets, so the number beside a chip is by construction
   * the number of dots that light when it is pressed.
   */
  readonly films: ReadonlySet<FilmId>;
}

/**
 * The filters worth offering for this library, in display order.
 *
 * Withholds anything that would light nothing, as `axesFor` withholds an axis a
 * library cannot speak to. A thin import shows fewer chips rather than dead ones,
 * and "Rewatched 0" is a control that can only disappoint. May be empty, unlike
 * `axesFor` — a library with no likes and no rewatches has nothing to highlight,
 * and the control simply does not appear.
 */
export function filtersFor(library: Library): readonly FilterOption[] {
  return FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    films: filter.select(library),
  })).filter((option) => option.films.size > 0);
}

/**
 * The films lit by the chosen filters and the query together.
 *
 * Filters **union** with each other and then **intersect** with the search.
 * Union, because two highlights are two things you want to see and anding them
 * would make each chip's count a lie the moment a second one was pressed.
 * Intersect with the query, because a search is not another highlight — it is the
 * question "where is this one", and it should narrow whatever you were looking at
 * rather than widen it.
 *
 * Returns null for "not narrowing" and empty for "narrowed to nothing". Both
 * matter and they are not the same: null leaves the map at full strength, empty
 * dims it and reports zero. See `searchFilms`, which draws the same distinction
 * for the same reason.
 *
 * Chosen ids are resolved against what the library can actually offer, the way
 * `resolveAxis` resolves an axis. Otherwise importing a library with no likes
 * while the Liked chip is pressed would dim every film on screen and light none —
 * a stale control emptying the map is the same failure as a broken one.
 */
export function narrow(
  library: Library,
  active: readonly FilterId[],
  query: string,
): ReadonlySet<FilmId> | null {
  const chosen = filtersFor(library).filter((option) => active.includes(option.id));
  const found = searchFilms(library.films, query);

  if (chosen.length === 0) return found;

  const union = new Set<FilmId>();
  for (const option of chosen) {
    for (const id of option.films) union.add(id);
  }
  if (found === null) return union;

  const both = new Set<FilmId>();
  for (const id of union) {
    if (found.has(id)) both.add(id);
  }
  return both;
}
