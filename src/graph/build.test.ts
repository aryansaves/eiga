import test from "node:test";
import assert from "node:assert/strict";

import type { Film, FilmId, Library, WatchEvent } from "../domain/types.ts";
import {
  buildGraph,
  byDecade,
  byDirector,
  neighboursOf,
  SESSION_MAX_FILMS,
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
  };
}

/** Films seen on one day, as the diary would record them. */
function sameDay(date: string | null, ids: readonly string[]): WatchEvent[] {
  return ids.map((id) => ({ filmId: id, watchedOn: date, rewatch: false }));
}

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
  assert.equal(graph.hubKind, "decade");
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

test("a film with an unknown year is kept but joins no hub", () => {
  const graph = buildGraph(library([film("a", null), film("b", 1985)]), byDecade);

  const orphan = graph.nodes.find((node) => node.id === "film:a");
  assert.ok(orphan);
  assert.equal(orphan.degree, 0);
  assert.equal(graph.edges.length, 1);
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

  assert.equal(graph.hubKind, "director");
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

test("rating rides on the film node and is never a hub", () => {
  const graph = buildGraph(
    library([film("a", 1975), film("b", 1978)], [], [["a", 4.5]]),
    byDecade,
  );

  assert.equal(graph.nodes.find((node) => node.id === "film:a")?.rating, 4.5);
  assert.equal(graph.nodes.find((node) => node.id === "film:b")?.rating, null);
  assert.ok(!graph.nodes.some((node) => node.id.startsWith("hub:rating")));
  assert.ok(graph.nodes.filter((node) => node.kind === "hub").every((h) => h.rating === null));
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
