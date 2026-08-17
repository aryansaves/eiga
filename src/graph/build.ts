/**
 * Graph construction.
 *
 * The central decision here is topological. Connecting films directly to other
 * films that share an attribute produces cliques: a library with 51 films from
 * the 2010s would emit 1,275 edges for that decade alone, which renders as an
 * unreadable ball regardless of how it is drawn.
 *
 * So films are never joined to each other by attribute. Each film is joined to
 * a small *hub* node representing the attribute, giving one edge per film and a
 * layout that settles into legible clusters. Films stay the primary visual
 * objects; hubs are few and quiet.
 *
 * Rating is deliberately *not* a hub. It is an ordinal scale, not a category —
 * a "4 stars" node would reintroduce the clique problem while telling the user
 * nothing. It travels on the film node instead, for the renderer to encode.
 *
 * Output is plain and serializable. D3 attaches coordinates to its own copies;
 * nothing in this module knows that D3 exists.
 */

import { decadeLabel, decadeOf, type Film, type FilmId, type Library } from "../domain/types.ts";

export type GraphNodeKind = "film" | "hub";

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** Set on film nodes only. */
  readonly filmId: FilmId | null;
  readonly year: number | null;
  /** The user's rating, when known. Film nodes only. */
  readonly rating: number | null;
  /** Members for a hub; connection count for a film. */
  readonly degree: number;
}

export type GraphEdgeKind = "membership" | "session";

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: GraphEdgeKind;
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** What the hubs in this graph represent, e.g. "decade" or "director". */
  readonly hubKind: string;
}

export interface Hub {
  readonly key: string;
  readonly label: string;
}

/**
 * Resolves the hubs a film belongs to.
 *
 * This is the seam that keeps the topology honest as data improves: a Letterboxd
 * export supports `byDecade`, and `byDirector` becomes available the moment
 * director data exists, with no change to anything downstream.
 */
export interface HubStrategy {
  readonly kind: string;
  hubsFor(film: Film): readonly Hub[];
}

export const byDecade: HubStrategy = {
  kind: "decade",
  hubsFor(film) {
    const decade = decadeOf(film);
    if (decade === null) return [];
    return [{ key: `decade:${decade}`, label: decadeLabel(decade) }];
  },
};

export const byDirector: HubStrategy = {
  kind: "director",
  hubsFor(film) {
    return film.directors.map((name) => ({
      key: `director:${name.toLowerCase()}`,
      label: name,
    }));
  },
};

/**
 * A single day's viewing is only treated as a shared session up to this many
 * films. Beyond it the day is almost certainly a bulk backfill of old entries
 * rather than a marathon, and connecting them would fabricate a dense cluster
 * out of a bookkeeping artefact.
 */
export const SESSION_MAX_FILMS = 5;

export function buildGraph(library: Library, strategy: HubStrategy): Graph {
  const filmNodeId = (id: FilmId) => `film:${id}`;
  const hubNodeId = (key: string) => `hub:${key}`;

  const hubLabels = new Map<string, string>();
  const edges = new Map<string, GraphEdge>();
  const degree = new Map<string, number>();

  const bump = (nodeId: string) =>
    degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);

  const addEdge = (edge: GraphEdge) => {
    if (edges.has(edge.id)) return;
    edges.set(edge.id, edge);
    bump(edge.source);
    bump(edge.target);
  };

  // Membership: one edge per film per hub.
  for (const film of library.films) {
    for (const hub of strategy.hubsFor(film)) {
      // First label wins. Hub keys are normalised, so two spellings of one
      // director collapse to one hub; overwriting would let an ALL-CAPS entry
      // decide how the hub reads for everyone.
      if (!hubLabels.has(hub.key)) hubLabels.set(hub.key, hub.label);
      const source = filmNodeId(film.id);
      const target = hubNodeId(hub.key);
      addEdge({ id: `member:${source}:${target}`, source, target, kind: "membership" });
    }
  }

  /*
    Session edges: films seen on the same day. Sparse by nature — a garnish that
    adds texture over the hub backbone, never the backbone itself. Pairs are
    deduped so two films watched together twice still share one edge.
  */
  const byDate = new Map<string, Set<FilmId>>();
  for (const watch of library.watches) {
    if (watch.watchedOn === null) continue;
    const existing = byDate.get(watch.watchedOn) ?? new Set<FilmId>();
    existing.add(watch.filmId);
    byDate.set(watch.watchedOn, existing);
  }

  const known = new Set(library.films.map((film) => film.id));
  for (const date of [...byDate.keys()].sort()) {
    const sameDay = [...(byDate.get(date) ?? [])]
      .filter((id) => known.has(id))
      .sort();
    if (sameDay.length < 2 || sameDay.length > SESSION_MAX_FILMS) continue;

    for (let i = 0; i < sameDay.length; i += 1) {
      for (let j = i + 1; j < sameDay.length; j += 1) {
        const source = filmNodeId(sameDay[i]);
        const target = filmNodeId(sameDay[j]);
        addEdge({ id: `session:${source}:${target}`, source, target, kind: "session" });
      }
    }
  }

  const filmNodes: GraphNode[] = library.films.map((film) => ({
    id: filmNodeId(film.id),
    kind: "film",
    label: film.title,
    filmId: film.id,
    year: film.year,
    rating: library.ratings.get(film.id) ?? null,
    degree: degree.get(filmNodeId(film.id)) ?? 0,
  }));

  const hubNodes: GraphNode[] = [...hubLabels.entries()].map(([key, label]) => ({
    id: hubNodeId(key),
    kind: "hub",
    label,
    filmId: null,
    year: null,
    rating: null,
    degree: degree.get(hubNodeId(key)) ?? 0,
  }));

  return {
    // Sorted for determinism: identical input must yield an identical graph.
    nodes: [...filmNodes, ...hubNodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    hubKind: strategy.kind,
  };
}

/** Direct neighbours of a node. Used to decide what stays lit when focusing. */
export function neighboursOf(graph: Graph, nodeId: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === nodeId) found.add(edge.target);
    else if (edge.target === nodeId) found.add(edge.source);
  }
  return found;
}
