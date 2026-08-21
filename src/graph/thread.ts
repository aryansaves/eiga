/**
 * The diary thread — EIGA's default map.
 *
 * A hub map answers *what do I have a lot of*. It cannot answer *what has my
 * watching been like*, and the second is the question an enthusiast opens the app
 * for. So the default topology is not a grouping at all: it is the watch history
 * laid out on the calendar, one row per year, each film joined to the one seen
 * before it.
 *
 * This joins films directly to films, which `build.ts` refuses to do — for a
 * reason that does not apply here. That rule exists against *quadratic* growth:
 * an attribute shared by 51 films is 1,275 edges. A chronological chain is n−1
 * edges, the sparsest connected graph there is, and 123 edges for a 124-film
 * library is a thread rather than a web.
 *
 * Four decisions worth stating, because each one is a claim about the data:
 *
 *  1. **One film is one dot, always**, placed at its *earliest* dated viewing.
 *     A rewatch is not a second film, and drawing it twice would double every
 *     title anyone has returned to. When a rewatch happened is a property of the
 *     film, surfaced by the rewatch highlight, not by its position.
 *  2. **A film sits on its true calendar position**, not at its place in a
 *     queue. This replaces a spiral that spaced films by step index, where two
 *     films a day apart and two films three months apart sat the same distance
 *     from each other — so a dormant spring was invisible and a binge looked
 *     like an ordinary week. Position is now the date; `order` is kept only as
 *     reading order.
 *  3. **A step is still a distinct day, not a film.** A real library logged 124
 *     films across 102 days, so films seen together share a position and resolve
 *     into a knot — a binge looks like one, which is the honest reading. The
 *     chain still runs through them, so the order inside a knot stays traceable.
 *  4. **A film with no readable watch date joins nothing.** Around ten in a real
 *     export have none. They are still nodes, because dropping films from the map
 *     would be a silent lie about the size of a library, but inventing a position
 *     for them on a calendar would be a louder one.
 *
 * Same-day films need no `session` edges here: the chain already runs through
 * them consecutively, and a second edge asserting the same fact is noise.
 *
 * Pure and deterministic, like `build.ts`, and shares its output types so the
 * layout and the renderer treat both topologies as one kind of thing.
 */

import { calendarPointOf } from "../domain/calendar.ts";
import { watchYearOf, type FilmId, type Library } from "../domain/types.ts";
import type { Graph, GraphEdge, GraphNode } from "./build.ts";

/** What one step of the thread stands for, for the status line and the label. */
export const THREAD_GROUP_KIND = "day";

/**
 * How many empty rows a dormant stretch may draw before the gap is simply closed.
 *
 * Dormant years get rows of their own — a five-year break in watching is real and
 * a map that hid it would be claiming continuity it does not have. But the row
 * count is also the height of the map, and the height is what the opening zoom is
 * fitted to, so an unbounded span would zoom a small library down until it carried
 * no titles at all. Past this many blank rows the jump is left to the year labels
 * to state, which they do plainly: two rows reading 2011 and 2019 are not
 * mistakable for consecutive years.
 */
const MAX_BLANK_ROWS = 3;

/**
 * Every year the timeline draws, ascending, with short dormant gaps filled in.
 *
 * Takes the years films were actually seen in and returns the rows to draw for
 * them. Separate from the node pass because it is a fact about the library as a
 * whole, and because the gap rule is the one place the map is allowed to be less
 * than literal.
 */
function yearRows(watched: readonly number[]): readonly number[] {
  const rows: number[] = [];
  for (const year of watched) {
    const previous = rows[rows.length - 1];
    if (previous !== undefined && year - previous - 1 <= MAX_BLANK_ROWS) {
      for (let blank = previous + 1; blank < year; blank += 1) rows.push(blank);
    }
    rows.push(year);
  }
  return rows;
}

export function buildThread(library: Library): Graph {
  const filmNodeId = (id: FilmId) => `film:${id}`;

  /*
    Restricted to films the library actually holds: a watch event naming an
    unknown film would otherwise put a step on the thread with no dot on it.
  */
  const known = new Set(library.films.map((film) => film.id));

  const earliest = new Map<FilmId, string>();
  for (const watch of library.watches) {
    if (watch.watchedOn === null || !known.has(watch.filmId)) continue;
    /*
      A date that cannot be read as a calendar day is treated as no date at all,
      so `order` and `when` can never disagree about whether a film is on the
      timeline. Letting a malformed date through with a step but no position would
      thread the chain to a film that is drawn out in the undated band.
    */
    if (calendarPointOf(watch.watchedOn) === null) continue;
    const found = earliest.get(watch.filmId);
    // ISO dates compare correctly as strings, which is most of why they are kept
    // as strings all the way through the domain model.
    if (found === undefined || watch.watchedOn < found) {
      earliest.set(watch.filmId, watch.watchedOn);
    }
  }

  const stepOf = new Map<string, number>();
  /*
    Years are collected in the same pass that numbers the steps, because the span
    of the map is a fact about this ordering and would have to be recovered from
    the dates all over again anywhere else.
  */
  const watchedYears: number[] = [];
  for (const date of [...new Set(earliest.values())].sort()) {
    stepOf.set(date, stepOf.size);

    const year = watchYearOf(date);
    if (year !== null && year !== watchedYears[watchedYears.length - 1]) {
      watchedYears.push(year);
    }
  }

  /*
    The thread's reading order. Inside a day the tie is broken by film id rather
    than by anything in the export: Letterboxd records no time of day, so any
    order within a day would be invented, and an arbitrary-but-stable one at
    least makes the map identical every time it is drawn.
  */
  const threaded = [...earliest.entries()].sort((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1].localeCompare(b[1]),
  );

  const edges = new Map<string, GraphEdge>();
  const degree = new Map<string, number>();

  for (let i = 0; i + 1 < threaded.length; i += 1) {
    const source = filmNodeId(threaded[i][0]);
    const target = filmNodeId(threaded[i + 1][0]);
    /*
      A link across a year boundary is its own kind, and not for decoration's
      sake. Rows are stacked, so this one edge runs from the right-hand end of a
      row to the left-hand end of the row below — a distance the width of the
      whole map, where every other chain edge spans a few days. Asked to hold both
      at the same length the simulation would spend every tick dragging each
      December back toward the following January, bending the end of every year
      out of true. The renderer wants the distinction too, but the physics needs
      it.
    */
    const wraps = watchYearOf(threaded[i][1]) !== watchYearOf(threaded[i + 1][1]);
    const kind = wraps ? "wrap" : "chain";
    const id = `${kind}:${source}:${target}`;
    if (edges.has(id)) continue;
    edges.set(id, { id, source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = library.films.map((film) => {
    const id = filmNodeId(film.id);
    const watchedOn = earliest.get(film.id);
    return {
      id,
      kind: "film",
      label: film.title,
      filmId: film.id,
      year: film.year,
      rating: library.ratings.get(film.id) ?? null,
      degree: degree.get(id) ?? 0,
      order: watchedOn === undefined ? null : (stepOf.get(watchedOn) ?? null),
      // Non-null whenever a date survived the pass above, by construction.
      when: watchedOn === undefined ? null : calendarPointOf(watchedOn),
    };
  });

  return {
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    shape: "thread",
    groupKind: THREAD_GROUP_KIND,
    rows: yearRows(watchedYears),
  };
}

/**
 * Films a film-to-film map could not place, in library order.
 *
 * Shared by the thread and the tree. They park a film for slightly different
 * reasons — the thread needs a readable watch date, the tree needs a release year
 * as well — but both mark it the same way, with a null `order`, so the check here
 * is the shape-neutral one and stays correct for either. Returned rather than
 * counted so the caller can both report the number and lay them out; the status
 * line stating how many there are is the only thing that keeps their band from
 * reading as a rendering fault.
 */
export function unplaced(graph: Graph): readonly GraphNode[] {
  return graph.nodes.filter((node) => node.kind === "film" && node.order === null);
}
