/**
 * The views a library can be mapped in.
 *
 * One place that knows both how a view is built and how to name it, so the UI
 * holds an id rather than a function and the set can grow without a component
 * learning about it.
 *
 * Three topologies live in one list, which is the point of the union: the diary
 * thread and the discovery tree are not groupings at all, but from the user's side
 * they are the same kind of choice as a grouping — *how do I want to see this* —
 * and splitting them into a separate control would make the most important views
 * of the product look like a mode switch. The map branches on `kind` exactly once.
 *
 * `available` exists because no view is universally meaningful. A Letterboxd
 * export carries no director credits, so offering a Director control on a real
 * import would present a button that produces a single "Director unknown" blob;
 * and a library imported from `watched.csv` alone has no dates, so it has no
 * diary. A view that cannot say anything about this library is not offered at all
 * — better than a dead control that technically works.
 */

import { watchYearOf, type AxisId, type HubAxisId, type Library } from "../domain/types.ts";
import {
  byDecade,
  byDirector,
  byRating,
  byWatchYear,
  type HubStrategy,
} from "./build.ts";
import { placeableFilms } from "./tree.ts";

export type { AxisId };

interface AxisBase {
  readonly id: AxisId;
  /** How the control names it. Rendered uppercase; stored in sentence case. */
  readonly label: string;
  /** Whether this view can say anything about the given library. */
  available(library: Library): boolean;
}

/** The diary thread: the watch history as one line, and the default view. */
export interface ThreadAxis extends AxisBase {
  readonly kind: "thread";
  readonly id: "diary";
}

/** The discovery tree: the same history, branched by how far each film reached. */
export interface TreeAxis extends AxisBase {
  readonly kind: "tree";
  readonly id: "discovery";
}

/** An attribute grouping: films joined to hubs, which the user re-sorts into. */
export interface HubAxis extends AxisBase {
  readonly kind: "hubs";
  readonly id: HubAxisId;
  readonly strategy: HubStrategy;
}

export type Axis = ThreadAxis | TreeAxis | HubAxis;

export const AXES: readonly Axis[] = [
  {
    kind: "thread",
    id: "diary",
    /*
      Named for what it shows rather than for the mechanism. "Diary" is
      Letterboxd's word and would ask the user to already know it; "Watch dates"
      says what the rows mean, which is the only thing they need.

      It said "Watch order" while the map was a spiral, where a film's place was
      its position in the queue and nothing more. On a calendar the position *is*
      the date — two films a week apart sit a week apart — so "order" now
      understates the axis and, worse, describes the one thing it no longer
      encodes visually.
    */
    label: "Watch dates",
    /*
      First in the list, so `resolveAxis`'s existing fallback to `options[0]`
      makes it the default with no new defaulting logic anywhere.

      Needs one dated viewing to exist at all. An import of `watched.csv` alone
      has none, and a thread with no steps would be a ring of undated films around
      an empty centre — so such a library correctly falls through to Decade.
    */
    available: (library) => library.watches.some((watch) => watch.watchedOn !== null),
  },
  {
    kind: "tree",
    id: "discovery",
    /*
      Named for what the branching means rather than for the shape. "Tree" describes
      the drawing, which the user can already see; "Discovery" names the claim — each
      limb is a reach into a part of film history, and a fork is the moment one began.
    */
    label: "Discovery",
    /*
      Second, so Watch dates stays `options[0]` and therefore stays the default.

      Withheld below two placeable films: one is a root with nothing hanging off it,
      and two is the smallest library that can fork at all. Below that the tree is
      the diary thread drawn again under another name, which is the same reason
      Director is withheld from an import that cannot fill it.
    */
    available: (library) => placeableFilms(library) >= 2,
  },
  {
    kind: "hubs",
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
    kind: "hubs",
    id: "rating",
    label: "Rating",
    strategy: byRating,
    available: (library) => library.ratings.size > 0,
  },
  {
    kind: "hubs",
    id: "watchYear",
    label: "Watch year",
    strategy: byWatchYear,
    available: (library) =>
      library.watches.some((watch) => watchYearOf(watch.watchedOn) !== null),
  },
  {
    kind: "hubs",
    id: "director",
    label: "Director",
    strategy: byDirector,
    // Last in the row: only the authored demo can offer it.
    available: (library) => library.films.some((film) => film.directors.length > 0),
  },
];

/** The views worth offering for this library, in display order. Never empty. */
export function axesFor(library: Library): readonly Axis[] {
  return AXES.filter((axis) => axis.available(library));
}

/**
 * Resolves a chosen view against what this library can actually offer.
 *
 * Called on every render rather than synchronised in an effect: swapping the
 * demo for an import can take the current view away, and deriving the answer
 * means there is no window in which the held id and the drawn map disagree.
 */
export function resolveAxis(library: Library, chosen: AxisId): Axis {
  const options = axesFor(library);
  return options.find((axis) => axis.id === chosen) ?? options[0];
}
