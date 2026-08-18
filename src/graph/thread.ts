/**
 * The diary thread — EIGA's default map.
 *
 * A hub map answers *what do I have a lot of*. It cannot answer *what has my
 * watching been like*, and the second is the question an enthusiast opens the app
 * for. So the default topology is not a grouping at all: it is the watch history
 * as a single line, first logged film to most recent, each film joined to the one
 * seen before it.
 *
 * This joins films directly to films, which `build.ts` refuses to do — for a
 * reason that does not apply here. That rule exists against *quadratic* growth:
 * an attribute shared by 51 films is 1,275 edges. A chronological chain is n−1
 * edges, the sparsest connected graph there is, and 123 edges for a 124-film
 * library is a thread rather than a web.
 *
 * Three decisions worth stating, because each one is a claim about the data:
 *
 *  1. **One film is one dot, always**, placed at its *earliest* dated viewing.
 *     A rewatch is not a second film, and drawing it twice would double every
 *     title anyone has returned to. When a rewatch happened is a property of the
 *     film, surfaced by the rewatch highlight, not by its position.
 *  2. **A step is a distinct day, not a film.** A real library logged 124 films
 *     across 102 days, so films seen together share a position and resolve into
 *     a knot — a binge looks like one, which is the honest reading. The chain
 *     still runs through them, so the order inside a knot stays traceable.
 *  3. **A film with no watch date joins nothing.** Around ten in a real export
 *     have none. They are still nodes, because dropping films from the map would
 *     be a silent lie about the size of a library, but inventing a position for
 *     them on a timeline would be a louder one.
 *
 * Same-day films need no `session` edges here: the chain already runs through
 * them consecutively, and a second edge asserting the same fact is noise.
 *
 * Pure and deterministic, like `build.ts`, and shares its output types so the
 * layout and the renderer treat both topologies as one kind of thing.
 */

import { watchYearOf, type FilmId, type Library } from "../domain/types.ts";
import type { Graph, GraphEdge, GraphNode, YearStart } from "./build.ts";

/** What one step of the thread stands for, for the status line and the label. */
export const THREAD_GROUP_KIND = "day";

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
    const found = earliest.get(watch.filmId);
    // ISO dates compare correctly as strings, which is most of why they are kept
    // as strings all the way through the domain model.
    if (found === undefined || watch.watchedOn < found) {
      earliest.set(watch.filmId, watch.watchedOn);
    }
  }

  const stepOf = new Map<string, number>();
  /*
    Years are collected in the same pass that numbers the steps, because "the
    first step of 2024" is a fact about this ordering and would have to be
    recovered from the dates all over again anywhere else. A date whose year is
    unreadable simply starts no year — the mark is decoration on a scale, and one
    reading "NaN" would be worse than a gap in the ticks.
  */
  const yearStarts: YearStart[] = [];
  for (const date of [...new Set(earliest.values())].sort()) {
    const step = stepOf.size;
    stepOf.set(date, step);

    const year = watchYearOf(date);
    if (year !== null && year !== yearStarts[yearStarts.length - 1]?.year) {
      yearStarts.push({ year, step });
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
    const id = `chain:${source}:${target}`;
    if (edges.has(id)) continue;
    edges.set(id, { id, source, target, kind: "chain" });
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
    };
  });

  return {
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    shape: "thread",
    groupKind: THREAD_GROUP_KIND,
    yearStarts,
  };
}

/**
 * Films the thread could not place, in library order.
 *
 * Returned rather than counted so the caller can both report the number and lay
 * them out; the status line saying "10 undated" is the only thing that keeps
 * their scattered band from reading as a rendering fault.
 */
export function unthreaded(graph: Graph): readonly GraphNode[] {
  return graph.nodes.filter((node) => node.kind === "film" && node.order === null);
}
