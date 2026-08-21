import test from "node:test";
import assert from "node:assert/strict";

import type { Film, FilmId, Library, WatchEvent } from "../domain/types.ts";
import { groupCount, type Graph } from "./build.ts";
import { buildTree, placeableFilms, TREE_GROUP_KIND } from "./tree.ts";
import { unplaced } from "./thread.ts";

function film(id: string, year: number | null = 1999): Film {
  return { id, title: `Film ${id}`, year, uri: null, directors: [] };
}

function library(
  films: readonly Film[],
  watches: readonly WatchEvent[] = [],
  ratings: readonly [FilmId, number][] = [],
): Library {
  return {
    films,
    watches,
    ratings: new Map(ratings),
    reviews: new Map(),
    likes: new Set(),
  };
}

const seen = (id: string, watchedOn: string | null, rewatch = false): WatchEvent => ({
  filmId: id,
  watchedOn,
  rewatch,
});

/**
 * Who each film hangs from, by node id.
 *
 * Derived from the edges rather than from anything the builder exposes, because
 * "this is a tree" is a claim about the edges: every node reachable from one root
 * by following exactly one parent each. A test that read a parent field would be
 * asserting the builder's intent, not its output.
 */
function parents(graph: Graph): ReadonlyMap<string, string> {
  const parent = new Map<string, string>();
  for (const edge of graph.edges) parent.set(edge.target, edge.source);
  return parent;
}

/** The one node with no parent, or null if the graph does not have exactly one. */
function root(graph: Graph): string | null {
  const parent = parents(graph);
  const roots = graph.nodes
    .filter((node) => node.when !== null && !parent.has(node.id))
    .map((node) => node.id);
  return roots.length === 1 ? roots[0] : null;
}

test("the tree costs one edge per film after the root, never a clique", () => {
  /*
    The property the topology rule turns on, and the whole reason a film-to-film
    map is allowed at all. Six films sharing a decade would be fifteen edges as a
    clique; hung off each other they are five.
  */
  const films = Array.from({ length: 6 }, (_, i) => film(`f${i}`, 1990 + i));
  const graph = buildTree(
    library(
      films,
      films.map((f, i) => seen(f.id, `2024-01-0${i + 1}`)),
    ),
  );

  assert.equal(graph.edges.length, films.length - 1);
  assert.equal(graph.shape, "tree");
});

test("the tree is all films and all branches, with no hub anywhere", () => {
  /*
    A tree that grew a hub would be two topologies at once — the case the axes are
    mutually exclusive to prevent. Asserted on the output because that is the only
    place the mistake would show.
  */
  const films = [film("a", 1970), film("b", 1985), film("c", 2001)];
  const graph = buildTree(
    library(films, [seen("a", "2024-03-01"), seen("b", "2024-03-05"), seen("c", "2024-03-09")]),
  );

  assert.ok(graph.nodes.length > 0);
  for (const node of graph.nodes) assert.equal(node.kind, "film");
  for (const edge of graph.edges) assert.equal(edge.kind, "branch");
  assert.equal(graph.groupKind, TREE_GROUP_KIND);
});

test("the root is the first film logged, and hangs from nothing", () => {
  /*
    Deliberately given to the builder out of watch order, because the root is a fact
    about the dates and not about the order the rows arrived in. An importer that
    changed its sort would otherwise silently re-root the map.
  */
  const graph = buildTree(
    library(
      [film("late", 1995), film("first", 1962), film("middle", 1988)],
      [
        seen("middle", "2023-06-01"),
        seen("late", "2024-01-01"),
        seen("first", "2022-02-02"),
      ],
    ),
  );

  assert.equal(root(graph), "film:first");
});

test("every branch points backward in time", () => {
  /*
    The direction the map claims: a film grew out of one already seen. A parent
    watched *after* its child would make the drawing read right-to-left in places
    while the axis ran left-to-right, which is the one lie this geometry cannot
    survive.
  */
  const dates = new Map([
    ["a", "2020-01-01"],
    ["b", "2020-06-15"],
    ["c", "2021-02-02"],
    ["d", "2021-02-02"], // same day as c, so the id tie-break is exercised
    ["e", "2023-11-30"],
  ]);
  const graph = buildTree(
    library(
      [film("a", 1950), film("b", 1999), film("c", 1952), film("d", 2010), film("e", 1998)],
      [...dates].map(([id, on]) => seen(id, on)),
    ),
  );

  const on = (nodeId: string) => dates.get(nodeId.replace("film:", "")) ?? "";
  for (const edge of graph.edges) {
    assert.ok(
      on(edge.source) <= on(edge.target),
      `${edge.source} (${on(edge.source)}) should not be later than ${edge.target}`,
    );
  }
});

test("walking parents from any film reaches the root", () => {
  /*
    Connected and acyclic in one assertion, which is what "tree" means and is not
    implied by the edge count alone: five edges over six films could equally be a
    four-cycle with a tail. Bounded by the node count so a cycle fails the test
    rather than hanging it.
  */
  const films = Array.from({ length: 12 }, (_, i) => film(`f${i}`, 1960 + i * 4));
  const graph = buildTree(
    library(
      films,
      films.map((f, i) => seen(f.id, `2024-${String(i + 1).padStart(2, "0")}-10`)),
      films.map((f, i) => [f.id, ((i % 9) + 1) / 2] as [FilmId, number]),
    ),
  );

  const parent = parents(graph);
  const top = root(graph);
  assert.ok(top !== null);

  for (const node of graph.nodes) {
    let at = node.id;
    let steps = 0;
    while (at !== top) {
      const next = parent.get(at);
      assert.ok(next !== undefined, `${node.id} walks off the tree at ${at}`);
      at = next;
      steps += 1;
      assert.ok(steps <= graph.nodes.length, `${node.id} is in a cycle`);
    }
  }
});

test("a film hangs from the nearest release year already seen, not the previous film", () => {
  /*
    The rule itself, on the smallest library that can tell the two apart. Watched
    1962, then 1996, then 1965: the third film is adjacent in time to the second and
    adjacent in *history* to the first, and it is the first it must hang from. Get
    this wrong and the tree is the diary chain with extra steps.
  */
  const graph = buildTree(
    library(
      [film("old", 1962), film("new", 1996), film("older", 1965)],
      [seen("old", "2024-01-01"), seen("new", "2024-01-02"), seen("older", "2024-01-03")],
    ),
  );

  assert.equal(parents(graph).get("film:older"), "film:old");
});

test("rating separates two films the release year cannot", () => {
  /*
    Why the rating term exists. Three 1999 films score zero against each other on
    year alone, so the tie-break would hand the third to the second and the tree
    would be a chain — measured at depth 299 on a synthetic all-one-year library.
    Rated 1, 5 and 4½, the third belongs to the 5.
  */
  const graph = buildTree(
    library(
      [film("low", 1999), film("high", 1999), film("near", 1999)],
      [seen("low", "2024-01-01"), seen("high", "2024-01-02"), seen("near", "2024-01-03")],
      [
        ["low", 1],
        ["high", 5],
        ["near", 4.5],
      ],
    ),
  );

  assert.equal(parents(graph).get("film:near"), "film:high");
});

test("the same library always builds the same tree", () => {
  /*
    Not a nicety: a re-sort animates films from where they were to where they now
    belong, so a builder that reordered its own output would send every film on a
    journey to its own position. Two same-day films make it a real risk.
  */
  const source = library(
    [film("a", 1975), film("b", 1975), film("c", 2004), film("d", 1980)],
    [
      seen("a", "2024-05-05"),
      seen("b", "2024-05-05"),
      seen("c", "2024-05-06"),
      seen("d", "2024-05-07"),
    ],
    [["c", 3]],
  );

  assert.deepEqual(buildTree(source), buildTree(source));
});

test("a film with no readable date stays on the map and joins nothing", () => {
  /*
    Dropping it would understate the library, and attaching it would put it at a
    date it was never watched on. So it is a node with a null `order`, which is the
    shape-neutral mark `unplaced` reads and the layout parks on.
  */
  const graph = buildTree(
    library(
      [film("dated", 1990), film("also", 1994), film("undated", 1991)],
      [seen("dated", "2024-02-01"), seen("also", "2024-02-02"), seen("undated", null)],
    ),
  );

  const stray = graph.nodes.find((node) => node.id === "film:undated");
  assert.ok(stray !== undefined);
  assert.equal(stray.order, null);
  assert.equal(stray.when, null);
  assert.equal(stray.degree, 0);
  assert.deepEqual(
    unplaced(graph).map((node) => node.id),
    ["film:undated"],
  );
});

test("a film with no release year is parked too, rather than given an era it never claimed", () => {
  /*
    A departure from the first draft of this rule, which attached such a film to the
    most recently watched one. Rows are release decades, so that would have drawn it
    on a row labelled 1990s while the export makes no claim about when it was made —
    and it has nothing to be *near*, so the branching metric cannot place it either.
  */
  const graph = buildTree(
    library(
      [film("known", 1990), film("other", 1994), film("yearless", null)],
      [
        seen("known", "2024-02-01"),
        seen("other", "2024-02-02"),
        seen("yearless", "2024-02-03"),
      ],
    ),
  );

  const stray = graph.nodes.find((node) => node.id === "film:yearless");
  assert.ok(stray !== undefined);
  assert.equal(stray.order, null);
  assert.equal(stray.when, null, "no position along time, because it has no row to sit on");
  assert.equal(stray.degree, 0);
  assert.equal(graph.edges.length, 1, "two placeable films, so one branch");
});

test("a rewatch is not a second film", () => {
  /*
    One film is one dot, placed at its earliest viewing — a film cannot hang from
    two parents without ceasing to be a tree. The later date is the one a naive
    pass would keep, so it is given last.
  */
  const graph = buildTree(
    library(
      [film("a", 1980), film("b", 1990)],
      [seen("a", "2021-01-01"), seen("b", "2022-01-01"), seen("a", "2023-01-01", true)],
    ),
  );

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(root(graph), "film:a", "the earliest viewing roots the tree, not the latest");
});

test("the rows run from the oldest release decade to the newest with no gap", () => {
  /*
    Gaps are filled for the reason the timeline fills dormant years: rows reading
    1950s then 1980s would claim the library spans two decades of cinema when it
    spans four. Only placeable films count toward the span — a parked film is not on
    a row, so it cannot stretch the graticule.
  */
  const graph = buildTree(
    library(
      [film("a", 1958), film("b", 1989), film("c", 2003), film("d", 1930)],
      [seen("a", "2024-01-01"), seen("b", "2024-01-02"), seen("c", "2024-01-03"), seen("d", null)],
    ),
  );

  assert.deepEqual([...graph.rows], [1950, 1960, 1970, 1980, 1990, 2000]);
});

test("the status line counts forks, not branches", () => {
  /*
    `groupCount` on a tree answers "how many times did this split", which is the
    number that says something about a viewing life. A pure chain of five films has
    four branches and no forks, and reporting four would describe the diary thread.
  */
  const chain = buildTree(
    library(
      Array.from({ length: 5 }, (_, i) => film(`f${i}`, 1990 + i)),
      Array.from({ length: 5 }, (_, i) => seen(`f${i}`, `2024-01-0${i + 1}`)),
    ),
  );
  assert.equal(chain.edges.length, 4);
  assert.equal(groupCount(chain), 0);

  /*
    Two limbs from one root: a 1960s film, then a 1990s film, then a second of each.
    The root takes two children, so it is one fork.
  */
  const forked = buildTree(
    library(
      [film("a", 1962), film("b", 1996), film("c", 1963), film("d", 1997)],
      [
        seen("a", "2024-01-01"),
        seen("b", "2024-01-02"),
        seen("c", "2024-01-03"),
        seen("d", "2024-01-04"),
      ],
    ),
  );
  assert.equal(groupCount(forked), 1);
});

test("an empty library builds an empty tree instead of throwing", () => {
  const graph = buildTree(library([]));

  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual([...graph.rows], []);
  assert.equal(graph.shape, "tree");
  assert.equal(root(graph), null, "nothing to root");
});

test("placeableFilms counts what the tree can actually draw", () => {
  /*
    The number `axesFor` gates on, so it has to agree with `buildTree` exactly: one
    film is a root with nothing hanging off it, and a tree with no fork is the diary
    thread under another name. Every way a film can fail to be placeable is here.
  */
  const mixed = library(
    [film("ok", 1990), film("undated", 1991), film("yearless", null), film("unwatched", 1992)],
    [seen("ok", "2024-01-01"), seen("undated", null), seen("yearless", "2024-01-02")],
  );

  assert.equal(placeableFilms(mixed), 1);
  assert.equal(buildTree(mixed).edges.length, 0, "one placeable film cannot branch");

  assert.equal(placeableFilms(library([])), 0);
  assert.equal(
    placeableFilms(library([film("a", 1990)], [seen("ghost", "2024-01-01")])),
    0,
    "a watch naming a film the library does not hold places nothing",
  );
  assert.equal(
    placeableFilms(library([film("a", 1990)], [seen("a", "not-a-date")])),
    0,
    "an unreadable date is not a date",
  );
});

test("a malformed date does not take a film off the map", () => {
  /*
    Bad dates are dropped per watch rather than per film, so a film logged once with
    a broken date and once properly is placed on the good one. Filtering afterwards
    would let the malformed string win the comparison and park the film.
  */
  const graph = buildTree(
    library(
      [film("a", 1990), film("b", 1994)],
      [seen("a", "2024-01-01"), seen("b", "banana"), seen("b", "2024-01-02")],
    ),
  );

  assert.equal(graph.edges.length, 1);
  assert.deepEqual(unplaced(graph), []);
});

test("a large library stays shallow enough to read", () => {
  /*
    The failure mode this rule was chosen against: degenerating into the diary chain
    it exists to improve on. Deterministic pseudo-random years and ratings rather
    than a fixture, because the property should hold for any library, and a hand-made
    one would only prove it for the shape it was made in.

    The thresholds are the measured figures with headroom — 500 films came out at
    depth 15 and 6 children, against depth 32 for the chain over the same films.
  */
  let state = 20240101;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const count = 500;
  const films = Array.from({ length: count }, (_, i) =>
    film(`f${String(i).padStart(3, "0")}`, 1930 + Math.floor(next() * 95)),
  );
  const graph = buildTree(
    library(
      films,
      films.map((f, i) => {
        const day = 1 + (i % 28);
        const month = 1 + (Math.floor(i / 28) % 12);
        const year = 2015 + Math.floor(i / 336);
        return seen(f.id, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
      }),
      films.map((f) => [f.id, (Math.floor(next() * 10) + 1) / 2] as [FilmId, number]),
    ),
  );

  const depth = Math.max(...graph.nodes.map((node) => node.order ?? 0));
  const children = new Map<string, number>();
  for (const edge of graph.edges) {
    children.set(edge.source, (children.get(edge.source) ?? 0) + 1);
  }
  const widest = Math.max(...children.values());

  assert.equal(graph.edges.length, count - 1);
  assert.ok(depth < count / 10, `depth ${depth} over ${count} films is chain-like`);
  assert.ok(widest <= 20, `one film took ${widest} children, which is a star and not a tree`);
  assert.ok(groupCount(graph) > count / 20, `only ${groupCount(graph)} forks is barely a tree`);
});
