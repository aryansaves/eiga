/**
 * The axes a library can be mapped on.
 *
 * One place that knows both the strategy and how to name it, so the UI holds an
 * id rather than a function and the set of axes can grow without a component
 * learning about it.
 *
 * `available` exists because axes are not universally meaningful. A Letterboxd
 * export carries no director credits, so offering a Director control on a real
 * import would present a button that produces a single "Director unknown" blob.
 * An axis that cannot say anything about this library is not offered at all —
 * better than a dead control that technically works.
 */

import { watchYearOf, type AxisId, type Library } from "../domain/types.ts";
import {
  byDecade,
  byDirector,
  byRating,
  byWatchYear,
  type HubStrategy,
} from "./build.ts";

export type { AxisId };

export interface Axis {
  readonly id: AxisId;
  /** How the control names it. Rendered uppercase; stored in sentence case. */
  readonly label: string;
  readonly strategy: HubStrategy;
  /** Whether this axis can say anything about the given library. */
  available(library: Library): boolean;
}

export const AXES: readonly Axis[] = [
  {
    id: "decade",
    label: "Decade",
    strategy: byDecade,
    /*
      Always offered. Release year is the one field every export has, and a
      library with none of it still needs somewhere to be drawn — so this is the
      floor that guarantees `axesFor` is never empty.
    */
    available: () => true,
  },
  {
    id: "rating",
    label: "Rating",
    strategy: byRating,
    available: (library) => library.ratings.size > 0,
  },
  {
    id: "watchYear",
    label: "Watch year",
    strategy: byWatchYear,
    available: (library) =>
      library.watches.some((watch) => watchYearOf(watch.watchedOn) !== null),
  },
  {
    id: "director",
    label: "Director",
    strategy: byDirector,
    // Last in the row: only the authored demo can offer it.
    available: (library) => library.films.some((film) => film.directors.length > 0),
  },
];

/** The axes worth offering for this library, in display order. Never empty. */
export function axesFor(library: Library): readonly Axis[] {
  return AXES.filter((axis) => axis.available(library));
}

/**
 * Resolves a chosen axis against what this library can actually offer.
 *
 * Called on every render rather than synchronised in an effect: swapping the
 * demo for an import can take the current axis away, and deriving the answer
 * means there is no window in which the held id and the drawn map disagree.
 */
export function resolveAxis(library: Library, chosen: AxisId): Axis {
  const options = axesFor(library);
  return options.find((axis) => axis.id === chosen) ?? options[0];
}
