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
 * A film may only ever hold hubs from *one* axis at a time. Axes are mutually
 * exclusive, not layered. Grouping by decade *and* rating simultaneously would
 * give every film two memberships and reintroduce the density the hub topology
 * exists to avoid — so rating is a hub the user can switch to, never a second
 * one they get for free. This is also why the rating on the film node stays:
 * the renderer encodes it as size on every axis.
 *
 * Ordinal axes additionally chain their hubs into a *spine*, so the map is one
 * connected object with a reading order rather than a row of islands that only
 * look sequential because the layout happened to place them that way.
 *
 * Output is plain and serializable. D3 attaches coordinates to its own copies;
 * nothing in this module knows that D3 exists.
 */

import {
  decadeLabel,
  decadeOf,
  ratingLabel,
  watchYearOf,
  type Film,
  type FilmId,
  type Library,
} from "../domain/types.ts";

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
  /**
   * Position along an ordinal axis, for hubs that have one.
   *
   * Carried on the node so the layout can order hubs by the axis's own scale
   * instead of inferring it from the id — `hub:rating:5` sorts *after*
   * `hub:rating:45` as a string, which would put half a star between four and a
   * half and five.
   */
  readonly order: number | null;
}

export type GraphEdgeKind = "membership" | "session" | "spine";

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
  /** Position on an ordinal axis: 1970 for a decade, 45 for four and a half. */
  readonly order?: number;
}

/**
 * Resolves the hubs a film belongs to — the axis the map is currently drawn on.
 *
 * `prepare` is called once per build, before any film is examined, and returns
 * the per-film function. That indirection exists because most axes need the
 * whole library: a rating lives in `library.ratings` and a watch date in
 * `library.watches`, neither of which is on the `Film`. Handing the library to
 * a per-film call instead would mean re-scanning it once per film.
 *
 * Implementations must stay pure and deterministic: the same library must always
 * produce the same hubs in the same order.
 */
export interface HubStrategy {
  readonly kind: string;
  /**
   * Whether the hubs form a scale. Ordinal axes get a spine; nominal ones
   * cannot — there is no meaningful order in which to chain directors.
   */
  readonly ordinal: boolean;
  /** What to call the bucket for films this axis cannot place. */
  readonly unplacedLabel: string;
  prepare(library: Library): (film: Film) => readonly Hub[];
}

/**
 * The bucket for films an axis cannot place.
 *
 * Held here rather than in each strategy so every axis behaves the same way, and
 * so there is exactly one of these however many strategies exist. It has no
 * `order`, which sorts it to the low end of the spine: unknowns read first, then
 * the scale proper.
 */
const UNPLACED_KEY = "unplaced";

export const byDecade: HubStrategy = {
  kind: "decade",
  ordinal: true,
  unplacedLabel: "Year unknown",
  prepare() {
    return (film) => {
      const decade = decadeOf(film);
      if (decade === null) return [];
      return [
        { key: `decade:${decade}`, label: decadeLabel(decade), order: decade },
      ];
    };
  },
};

export const byDirector: HubStrategy = {
  kind: "director",
  ordinal: false,
  unplacedLabel: "Director unknown",
  prepare() {
    return (film) =>
      film.directors.map((name) => ({
        key: `director:${name.toLowerCase()}`,
        label: name,
      }));
  },
};

/**
 * Rating bands, in half-star steps.
 *
 * Keys are scaled by ten so an id never carries a decimal point, and the same
 * integer doubles as the spine order.
 */
export const byRating: HubStrategy = {
  kind: "rating",
  ordinal: true,
  unplacedLabel: "Unrated",
  prepare(library) {
    return (film) => {
      const rating = library.ratings.get(film.id);
      if (rating === undefined) return [];
      const step = Math.round(rating * 10);
      return [
        { key: `rating:${step}`, label: ratingLabel(rating), order: step },
      ];
    };
  },
};

/**
 * The calendar years a film was watched in.
 *
 * The one axis where multiple membership is meaningful rather than accidental: a
 * film seen in 2022 and again in 2024 belongs to both years, and that edge pair
 * is a real bridge across the spine rather than a duplicate of the film.
 */
export const byWatchYear: HubStrategy = {
  kind: "watch year",
  ordinal: true,
  unplacedLabel: "Never logged",
  prepare(library) {
    const seen = new Map<FilmId, Set<number>>();
    for (const watch of library.watches) {
      const year = watchYearOf(watch.watchedOn);
      if (year === null) continue;
      const years = seen.get(watch.filmId) ?? new Set<number>();
      years.add(year);
      seen.set(watch.filmId, years);
    }

    return (film) => {
      const years = seen.get(film.id);
      if (!years) return [];
      return [...years]
        .sort((a, b) => a - b)
        .map((year) => ({
          key: `watched:${year}`,
          label: String(year),
          order: year,
        }));
    };
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

  const hubsFor = strategy.prepare(library);

  const hubLabels = new Map<string, string>();
  const hubOrders = new Map<string, number>();
  const edges = new Map<string, GraphEdge>();
  const degree = new Map<string, number>();

  const bump = (nodeId: string) =>
    degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);

  /**
   * `counts` is false for the spine. A hub's degree is how many films it holds
   * — that is what sizes it and what its label announces — so structural links
   * between hubs must not inflate it.
   */
  const addEdge = (edge: GraphEdge, counts = true) => {
    if (edges.has(edge.id)) return;
    edges.set(edge.id, edge);
    if (!counts) return;
    bump(edge.source);
    bump(edge.target);
  };

  // Membership: one edge per film per hub.
  for (const film of library.films) {
    const found = hubsFor(film);
    /*
      Films the axis cannot place go to a named bucket rather than floating at
      degree zero. An unrated film or one with no release year is an answer the
      map should be able to show, not a gap that drifts off the edge of it.
    */
    const hubs: readonly Hub[] =
      found.length > 0
        ? found
        : [{ key: UNPLACED_KEY, label: strategy.unplacedLabel }];

    for (const hub of hubs) {
      // First label wins. Hub keys are normalised, so two spellings of one
      // director collapse to one hub; overwriting would let an ALL-CAPS entry
      // decide how the hub reads for everyone.
      if (!hubLabels.has(hub.key)) hubLabels.set(hub.key, hub.label);
      if (hub.order !== undefined && !hubOrders.has(hub.key)) {
        hubOrders.set(hub.key, hub.order);
      }
      const source = filmNodeId(film.id);
      const target = hubNodeId(hub.key);
      addEdge({ id: `member:${source}:${target}`, source, target, kind: "membership" });
    }
  }

  /*
    The spine: adjacent hubs on an ordinal axis, chained.

    Without this the map is a set of disconnected islands that merely look
    sequential, because the only thing placing them in order is the layout's
    anchoring. One edge per gap — `hubs - 1` in total — so connecting the map
    costs nothing like the clique it replaces.
  */
  if (strategy.ordinal) {
    const chain = [...hubLabels.keys()].sort(compareHubs(hubOrders));
    for (let i = 0; i + 1 < chain.length; i += 1) {
      const source = hubNodeId(chain[i]);
      const target = hubNodeId(chain[i + 1]);
      addEdge({ id: `spine:${source}:${target}`, source, target, kind: "spine" }, false);
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
    order: null,
  }));

  const hubNodes: GraphNode[] = [...hubLabels.entries()].map(([key, label]) => ({
    id: hubNodeId(key),
    kind: "hub",
    label,
    filmId: null,
    year: null,
    rating: null,
    degree: degree.get(hubNodeId(key)) ?? 0,
    order: hubOrders.get(key) ?? null,
  }));

  return {
    // Sorted for determinism: identical input must yield an identical graph.
    nodes: [...filmNodes, ...hubNodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    hubKind: strategy.kind,
  };
}

/**
 * Orders hubs along an axis: by declared position, then by key.
 *
 * Written as explicit comparisons rather than a subtraction because the
 * unplaced bucket has no position, and the key tie-break keeps the result
 * deterministic when two hubs somehow share one.
 */
function compareHubs(
  orders: ReadonlyMap<string, number>,
): (a: string, b: string) => number {
  return (a, b) => {
    const left = orders.get(a);
    const right = orders.get(b);
    if (left !== right) {
      if (left === undefined) return -1;
      if (right === undefined) return 1;
      return left < right ? -1 : 1;
    }
    return a.localeCompare(b);
  };
}

/** Hubs in axis order, for anything that needs to lay the spine out in a line. */
export function orderedHubs(graph: Graph): readonly GraphNode[] {
  return [...graph.nodes]
    .filter((node) => node.kind === "hub")
    .sort((a, b) => {
      if (a.order !== b.order) {
        if (a.order === null) return -1;
        if (b.order === null) return 1;
        return a.order < b.order ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });
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
