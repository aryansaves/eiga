import test from "node:test";
import assert from "node:assert/strict";

import type { Film, FilmId, Library, WatchEvent } from "../domain/types.ts";
import {
  buildGraph,
  byDecade,
  byDirector,
  byRating,
  byWatchYear,
  neighboursOf,
  orderedHubs,
  SESSION_MAX_FILMS,
  type Graph,
  type HubStrategy,
} from "./build.ts";

function film(
  id: string,
  year: number | null,
  directors: readonly string[] = [],
): Film {
  return { id, title: `Film ${id}`, year, uri: null, directors };
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

/** Films seen on one day, as the diary would record them. */
function sameDay(date: string | null, ids: readonly string[]): WatchEvent[] {
  return ids.map((id) => ({ filmId: id, watchedOn: date, rewatch: false }));
}

/**
 * How many disconnected pieces the graph is in.
 *
 * This is the measurement the suite was missing. Every assertion passed while
 * the map was in seven pieces, because nothing ever asked whether the clusters
 * were actually joined — they merely looked joined once the layout had placed
 * them in a row.
 */
function componentCount(graph: Graph): number {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const seen = new Set<string>();
  let components = 0;

  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    components += 1;
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return components;
}

/** A library with no session or rating overlap to accidentally join anything. */
function scattered(): Library {
  return library(
    [
      film("a", 1954, ["Akira Kurosawa"]),
      film("b", 1975, ["Chantal Akerman"]),
      film("c", 1988, ["Krzysztof Kieślowski"]),
      film("d", 2001, ["Hayao Miyazaki"]),
      film("e", 2019, ["Bong Joon-ho"]),
    ],
    [
      { filmId: "a", watchedOn: "2022-04-01", rewatch: false },
      { filmId: "b", watchedOn: "2023-07-14", rewatch: false },
      { filmId: "c", watchedOn: "2024-01-09", rewatch: false },
      { filmId: "d", watchedOn: "2024-11-30", rewatch: false },
      { filmId: "e", watchedOn: "2025-02-02", rewatch: false },
    ],
    [
      ["a", 5],
      ["b", 4.5],
      ["c", 3],
      ["d", 4.5],
      ["e", 2],
    ],
  );
}

const ORDINAL: readonly [string, HubStrategy][] = [
  ["decade", byDecade],
  ["rating", byRating],
  ["watch year", byWatchYear],
];

test("films attach to hubs, never to each other", () => {
  const graph = buildGraph(
    library([film("a", 1975), film("b", 1978), film("c", 1972)]),
    byDecade,
  );

  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ["film:a", "film:b", "film:c", "hub:decade:1970"],
  );
  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.every((edge) => edge.target === "hub:decade:1970"));
  assert.equal(graph.groupKind, "decade");
});

test("edge count stays linear where a clique would explode", () => {
  const films = Array.from({ length: 20 }, (_, i) => film(`f${i}`, 2015));
  const graph = buildGraph(library(films), byDecade);

  // A shared-attribute clique would be 20 * 19 / 2 = 190 edges.
  assert.equal(graph.edges.length, 20);
  assert.equal(graph.nodes.length, 21);
  assert.equal(
    graph.nodes.find((node) => node.kind === "hub")?.degree,
    20,
  );
});

test("decades are floored and labelled", () => {
  const graph = buildGraph(
    library([film("a", 1999), film("b", 2000), film("c", 2009)]),
    byDecade,
  );

  const hubs = graph.nodes
    .filter((node) => node.kind === "hub")
    .map((node) => node.label);
  assert.deepEqual(hubs, ["1990s", "2000s"]);
});

test("a film the axis cannot place joins a named bucket, not nothing", () => {
  /*
    This test previously asserted the opposite — that an undated film joined no
    hub and sat at degree 0. That was the behaviour, and it was wrong: the film
    had no anchor, so the layout let it drift off wherever the forces pushed it.
    "Year unknown" is an answer the map should be able to show.

    Two films, two hubs (unplaced + 1980s), so: 2 membership edges + 1 spine.
  */
  const graph = buildGraph(library([film("a", null), film("b", 1985)]), byDecade);

  const unplaceable = graph.nodes.find((node) => node.id === "film:a");
  assert.ok(unplaceable);
  assert.equal(unplaceable.degree, 1);

  const bucket = graph.nodes.find((node) => node.id === "hub:unplaced");
  assert.equal(bucket?.label, "Year unknown");
  assert.equal(bucket?.degree, 1);
  assert.equal(bucket?.order, null);

  assert.equal(graph.edges.filter((edge) => edge.kind === "membership").length, 2);
  assert.equal(graph.edges.filter((edge) => edge.kind === "spine").length, 1);
});

test("each axis names its own unplaceable bucket", () => {
  const one = [film("a", null)];
  assert.equal(
    buildGraph(library(one), byRating).nodes.find((n) => n.id === "hub:unplaced")
      ?.label,
    "Unrated",
  );
  assert.equal(
    buildGraph(library(one), byWatchYear).nodes.find(
      (n) => n.id === "hub:unplaced",
    )?.label,
    "Never logged",
  );
  assert.equal(
    buildGraph(library(one), byDirector).nodes.find(
      (n) => n.id === "hub:unplaced",
    )?.label,
    "Director unknown",
  );
});

test("the bucket appears only when something needs it", () => {
  const graph = buildGraph(library([film("a", 1985)]), byDecade);
  assert.ok(!graph.nodes.some((node) => node.id === "hub:unplaced"));
});

test("director hubs drop in without changing the topology", () => {
  const graph = buildGraph(
    library([
      film("a", 1975, ["Andrei Tarkovsky"]),
      film("b", 1979, ["Andrei Tarkovsky"]),
      film("c", 2001, ["Joel Coen", "Ethan Coen"]),
    ]),
    byDirector,
  );

  assert.equal(graph.groupKind, "director");
  assert.equal(graph.edges.length, 4); // c belongs to two hubs
  assert.equal(
    graph.nodes.find((node) => node.id === "film:c")?.degree,
    2,
  );
  assert.equal(
    graph.nodes.find((node) => node.label === "Andrei Tarkovsky")?.degree,
    2,
  );
});

test("director hubs merge across capitalisation but keep a readable label", () => {
  const graph = buildGraph(
    library([film("a", 1975, ["Agnès Varda"]), film("b", 1985, ["AGNÈS VARDA"])]),
    byDirector,
  );

  const hubs = graph.nodes.filter((node) => node.kind === "hub");
  assert.equal(hubs.length, 1);
  assert.equal(hubs[0].label, "Agnès Varda");
  assert.equal(hubs[0].degree, 2);
});

test("rating rides on the film node on every axis, and axes never mix", () => {
  /*
    Rating is now a hub the user can switch *to*, so the old claim — "never a
    hub" — is no longer the property worth testing. What must hold is that axes
    stay mutually exclusive: on the decade axis a film has exactly one
    membership, and no rating hub exists to give it a second one. Two
    simultaneous memberships per film is the density the hub topology exists to
    avoid.
  */
  const lib = library([film("a", 1975), film("b", 1978)], [], [["a", 4.5]]);
  const graph = buildGraph(lib, byDecade);

  assert.equal(graph.nodes.find((node) => node.id === "film:a")?.rating, 4.5);
  assert.equal(graph.nodes.find((node) => node.id === "film:b")?.rating, null);
  assert.ok(!graph.nodes.some((node) => node.id.startsWith("hub:rating")));
  assert.ok(graph.nodes.filter((node) => node.kind === "hub").every((h) => h.rating === null));

  // The rating still travels for the renderer to encode, on the rating axis too.
  const byBand = buildGraph(lib, byRating);
  assert.equal(byBand.nodes.find((node) => node.id === "film:a")?.rating, 4.5);
  assert.equal(
    byBand.edges.filter(
      (edge) => edge.kind === "membership" && edge.source === "film:a",
    ).length,
    1,
  );
});

test("films seen on the same day gain session edges", () => {
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978), film("c", 1999)],
      sameDay("2024-03-01", ["a", "b", "c"]),
    ),
    byDecade,
  );

  const sessions = graph.edges.filter((edge) => edge.kind === "session");
  assert.deepEqual(sessions.map((edge) => edge.id), [
    "session:film:a:film:b",
    "session:film:a:film:c",
    "session:film:b:film:c",
  ]);
});

test("a day past the session cap is treated as a backfill, not a marathon", () => {
  const ids = Array.from({ length: SESSION_MAX_FILMS + 1 }, (_, i) => `f${i}`);
  const graph = buildGraph(
    library(
      ids.map((id) => film(id, 1990)),
      sameDay("2024-03-01", ids),
    ),
    byDecade,
  );

  assert.equal(graph.edges.filter((edge) => edge.kind === "session").length, 0);
});

test("a pair watched together twice still shares one edge", () => {
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978)],
      [...sameDay("2024-03-01", ["a", "b"]), ...sameDay("2024-06-02", ["a", "b"])],
    ),
    byDecade,
  );

  assert.equal(graph.edges.filter((edge) => edge.kind === "session").length, 1);
});

test("viewings with no date and films outside the library are ignored", () => {
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978)],
      [
        ...sameDay(null, ["a", "b"]),
        ...sameDay("2024-03-01", ["a", "ghost"]),
      ],
    ),
    byDecade,
  );

  assert.equal(graph.edges.filter((edge) => edge.kind === "session").length, 0);
});

test("the same library always yields the same graph", () => {
  const build = () =>
    buildGraph(
      library(
        [film("c", 1999), film("a", 1975), film("b", 1978)],
        sameDay("2024-03-01", ["c", "a"]),
        [["a", 3]],
      ),
      byDecade,
    );

  assert.deepEqual(build(), build());

  const ids = build().nodes.map((node) => node.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("neighbours resolve in both directions", () => {
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978)],
      sameDay("2024-03-01", ["a", "b"]),
    ),
    byDecade,
  );

  assert.deepEqual(
    [...neighboursOf(graph, "film:a")].sort(),
    ["film:b", "hub:decade:1970"],
  );
  assert.deepEqual([...neighboursOf(graph, "hub:decade:1970")].sort(), [
    "film:a",
    "film:b",
  ]);
  assert.equal(neighboursOf(graph, "film:missing").size, 0);
});

test("an empty library produces an empty graph rather than throwing", () => {
  const graph = buildGraph(library([]), byDecade);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});

/* ── The spine: what makes the map one object instead of a row of islands ── */

test("every ordinal axis produces exactly one connected component", () => {
  /*
    The regression this file exists for from here on. The demo library grouped by
    director was in seven pieces and the whole suite passed, because the map only
    *looked* sequential — the layout anchors hubs in a row, which reads as a
    spine without any edge being there.
  */
  for (const [name, strategy] of ORDINAL) {
    const graph = buildGraph(scattered(), strategy);
    assert.equal(componentCount(graph), 1, `${name} axis is not connected`);
  }
});

test("a nominal axis is allowed to be in pieces", () => {
  /*
    Directors have no order, so there is nothing honest to chain them along.
    Five films by five directors really are five islands, and inventing a link
    between them would be drawing a relationship the data does not contain.
  */
  const graph = buildGraph(scattered(), byDirector);
  assert.equal(componentCount(graph), 5);
  assert.equal(graph.edges.filter((edge) => edge.kind === "spine").length, 0);
});

test("the spine costs one edge per gap, never a clique", () => {
  const graph = buildGraph(scattered(), byDecade);
  const hubs = graph.nodes.filter((node) => node.kind === "hub").length;
  const spine = graph.edges.filter((edge) => edge.kind === "spine");

  assert.equal(hubs, 5);
  assert.equal(spine.length, hubs - 1);
  // A chained scale, not a mesh: every hub touches at most two spine edges.
  for (const hub of graph.nodes.filter((node) => node.kind === "hub")) {
    const touching = spine.filter(
      (edge) => edge.source === hub.id || edge.target === hub.id,
    );
    assert.ok(touching.length <= 2, `${hub.id} has ${touching.length} spine edges`);
  }
});

test("the spine does not inflate a hub's film count", () => {
  /*
    A hub's degree is how many films it holds — it sizes the node and it is what
    the accessible label announces. If structural links counted, every interior
    decade would claim two films it does not have.
  */
  const graph = buildGraph(scattered(), byDecade);
  for (const hub of graph.nodes.filter((node) => node.kind === "hub")) {
    assert.equal(hub.degree, 1, `${hub.id} counted a spine edge`);
  }
});

test("hubs chain in axis order, not in string order", () => {
  /*
    The reason `order` is carried on the node at all. Half a star keys as
    `hub:rating:5`, which sorts *after* `hub:rating:45` as a string — so a map
    ordered by id would put the worst film in the library between four and a half
    stars and five.
  */
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978), film("c", 1999)],
      [],
      [
        ["a", 4.5],
        ["b", 5],
        ["c", 0.5],
      ],
    ),
    byRating,
  );

  assert.deepEqual(
    orderedHubs(graph).map((hub) => hub.label),
    ["½", "4½", "5"],
  );
  assert.deepEqual(
    orderedHubs(graph).map((hub) => hub.id),
    ["hub:rating:5", "hub:rating:45", "hub:rating:50"],
  );

  // Named outright: sorting the same hubs by id gets the scale wrong.
  assert.deepEqual(
    [...orderedHubs(graph)].sort((x, y) => x.id.localeCompare(y.id)).map((h) => h.label),
    ["4½", "½", "5"],
  );

  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.kind === "spine")
      .map((edge) => `${edge.source}->${edge.target}`)
      .sort(),
    ["hub:rating:45->hub:rating:50", "hub:rating:5->hub:rating:45"],
  );
});

test("the unplaceable bucket sits at the low end of the spine", () => {
  const graph = buildGraph(
    library([film("a", 1975), film("b", 1978)], [], [["a", 3]]),
    byRating,
  );

  assert.deepEqual(
    orderedHubs(graph).map((hub) => hub.label),
    ["Unrated", "3"],
  );
  assert.equal(componentCount(graph), 1);
});

/* ── The axes themselves ── */

test("rating hubs are half-star bands, labelled as ticks", () => {
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978), film("c", 1999), film("d", 2004)],
      [],
      [
        ["a", 0.5],
        ["b", 3],
        ["c", 3],
        ["d", 5],
      ],
    ),
    byRating,
  );

  assert.equal(graph.groupKind, "rating");
  assert.deepEqual(orderedHubs(graph).map((hub) => hub.label), ["½", "3", "5"]);
  // b and c share one band rather than each getting their own.
  assert.equal(
    graph.nodes.find((node) => node.id === "hub:rating:30")?.degree,
    2,
  );
});

test("watch years come from the diary, and a rewatch bridges two of them", () => {
  const graph = buildGraph(
    library(
      [film("a", 1975), film("b", 1978)],
      [
        { filmId: "a", watchedOn: "2022-06-01", rewatch: false },
        { filmId: "a", watchedOn: "2024-01-15", rewatch: true },
        { filmId: "b", watchedOn: "2024-03-02", rewatch: false },
      ],
    ),
    byWatchYear,
  );

  assert.equal(graph.groupKind, "watch year");
  assert.deepEqual(orderedHubs(graph).map((hub) => hub.label), ["2022", "2024"]);

  /*
    The one axis where multiple membership is meaningful: film a was seen in both
    years, so it spans the gap itself rather than being duplicated.
  */
  assert.equal(graph.nodes.find((node) => node.id === "film:a")?.degree, 2);
  assert.equal(graph.nodes.filter((node) => node.kind === "film").length, 2);
});

test("an undated viewing places the film in the never-logged bucket", () => {
  const graph = buildGraph(
    library([film("a", 1975)], [{ filmId: "a", watchedOn: null, rewatch: false }]),
    byWatchYear,
  );

  assert.deepEqual(
    graph.nodes.filter((node) => node.kind === "hub").map((hub) => hub.label),
    ["Never logged"],
  );
});

test("every axis is deterministic and leaves no film unattached", () => {
  for (const [name, strategy] of [...ORDINAL, ["director", byDirector] as const]) {
    const build = () => buildGraph(scattered(), strategy);
    assert.deepEqual(build(), build(), `${name} axis is not deterministic`);

    for (const node of build().nodes) {
      if (node.kind !== "film") continue;
      assert.ok(node.degree >= 1, `${node.id} floats on the ${name} axis`);
    }
  }
});
