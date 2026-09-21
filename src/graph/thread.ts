/**
 * A personal journey, with one stop per dated viewing and a linear chain.
 * Same-day order is stable but does not claim a time of day. Undated films stay
 * visible outside the path. The first stop keeps the film node id used by hubs.
 */
import { calendarPointOf } from "../domain/calendar.ts";
import type { Library, WatchEvent } from "../domain/types.ts";
import type { Graph, GraphEdge, GraphNode } from "./build.ts";

export const THREAD_GROUP_KIND = "viewing";

export function buildThread(library: Library): Graph {
  const films = new Map(library.films.map((film) => [film.id, film]));
  const unique = new Map<string, WatchEvent & { watchedOn: string }>();
  for (const watch of library.watches) {
    if (!films.has(watch.filmId) || watch.watchedOn === null) continue;
    if (calendarPointOf(watch.watchedOn) === null) continue;
    unique.set(`${watch.filmId}|${watch.watchedOn}|${watch.rewatch}`, {
      ...watch,
      watchedOn: watch.watchedOn,
    });
  }
  const watches = [...unique.values()].sort((a, b) =>
    a.watchedOn.localeCompare(b.watchedOn) ||
    a.filmId.localeCompare(b.filmId) || Number(a.rewatch) - Number(b.rewatch),
  );
  const seen = new Set<string>();
  const nodes: GraphNode[] = watches.map((watch, index) => {
    const film = films.get(watch.filmId)!;
    const first = !seen.has(film.id);
    seen.add(film.id);
    const previous = watches[index - 1];
    const gapDays = previous
      ? Math.round((Date.parse(watch.watchedOn) - Date.parse(previous.watchedOn)) / 86400000)
      : 0;
    const year = watch.watchedOn.slice(0, 4);
    const milestone = index === 0
      ? `First logged · ${year}`
      : index === watches.length - 1
        ? `Latest logged · ${year}`
        : previous.watchedOn.slice(0, 4) !== year ? year : undefined;
    return {
      id: first ? `film:${film.id}` : `viewing:${film.id}:${watch.watchedOn}:${watch.rewatch}`,
      kind: "film",
      label: film.title,
      filmId: film.id,
      year: film.year,
      rating: library.ratings.get(film.id) ?? null,
      degree: Number(index > 0) + Number(index < watches.length - 1),
      order: index,
      when: calendarPointOf(watch.watchedOn),
      watchedOn: watch.watchedOn,
      rewatch: watch.rewatch || !first,
      gapDays,
      milestone,
    };
  });
  const edges: GraphEdge[] = nodes.slice(1).map((node, index) => ({
    id: `chain:${nodes[index].id}:${node.id}`,
    source: nodes[index].id,
    target: node.id,
    kind: "chain",
  }));
  let firstUndated = true;
  for (const film of [...library.films].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(film.id)) continue;
    nodes.push({
      id: `film:${film.id}`,
      kind: "film",
      label: film.title,
      filmId: film.id,
      year: film.year,
      rating: library.ratings.get(film.id) ?? null,
      degree: 0,
      order: null,
      when: null,
      milestone: firstUndated ? "Date unknown" : undefined,
    });
    firstUndated = false;
  }
  return {
    nodes,
    edges,
    shape: "thread",
    groupKind: THREAD_GROUP_KIND,
    years: [...new Set(watches.map((watch) => Number(watch.watchedOn.slice(0, 4))))],
  };
}

export function unthreaded(graph: Graph): readonly GraphNode[] {
  return graph.nodes.filter((node) => node.kind === "film" && node.order === null);
}

/** A caption grounded in the recorded journey, without inferring missing history. */
export function journeyObservation(graph: Graph): string | null {
  const stops = graph.nodes.filter((node) => node.watchedOn !== undefined);
  if (stops.length === 0) return null;
  const visits = new Map<string, { title: string; count: number }>();
  for (const stop of stops) {
    if (!stop.filmId) continue;
    const previous = visits.get(stop.filmId);
    visits.set(stop.filmId, { title: stop.label, count: (previous?.count ?? 0) + 1 });
  }
  const mostVisited = [...visits.values()].sort((a, b) =>
    b.count - a.count || a.title.localeCompare(b.title),
  )[0];
  if (mostVisited && mostVisited.count > 1) {
    return `${mostVisited.title}, again — ${mostVisited.count} viewings along your journey.`;
  }
  const pause = [...stops].sort((a, b) => (b.gapDays ?? 0) - (a.gapDays ?? 0))[0];
  if ((pause.gapDays ?? 0) >= 30) {
    return `${pause.gapDays} days between logs. Then, ${pause.label}.`;
  }
  return stops.length === 1
    ? `Your first recorded stop: ${stops[0].label}.`
    : `From ${stops[0].label} to ${stops[stops.length - 1].label} — ${stops.length} viewings, your own path.`;
}
