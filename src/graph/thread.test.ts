import test from "node:test";
import assert from "node:assert/strict";

import type { Film, FilmId, Library, WatchEvent } from "../domain/types.ts";
import { groupCount, type Graph } from "./build.ts";
import { buildThread, unthreaded } from "./thread.ts";

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

/** The chain as a walk from its one end, which is what "a thread" has to mean. */
function walk(graph: Graph): readonly string[] {
  const links = new Map<string, string[]>();
  const join = (from: string, to: string) => {
    const next = links.get(from);
    if (next) next.push(to);
    else links.set(from, [to]);
  };

  for (const edge of graph.edges) {
    if (edge.kind !== "chain") continue;
    join(edge.source, edge.target);
    join(edge.target, edge.source);
  }

  const ends = [...links.entries()]
    .filter(([, next]) => next.length === 1)
    .map(([id]) => id)
    .sort();
  if (ends.length !== 2) return [];

  const order = [ends[0]];
  const visited = new Set(order);
  for (;;) {
    const next = (links.get(order[order.length - 1]) ?? []).find(
      (id) => !visited.has(id),
    );
    if (next === undefined) break;
    visited.add(next);
    order.push(next);
  }
  return order;
}

test("the thread costs one edge per gap, never a clique", () => {
  /*
    The whole justification for joining films to films at all. Five films sharing
    an attribute would be ten edges as a clique; as a chain they are four.
  */
  const films = Array.from({ length: 5 }, (_, i) => film(`f${i}`));
  const graph = buildThread(
    library(
      films,
      films.map((f, i) => seen(f.id, `2024-01-0${i + 1}`)),
    ),
  );

  assert.equal(graph.shape, "thread");
  assert.equal(graph.edges.length, 4);
  assert.ok(graph.edges.every((edge) => edge.kind === "chain"));
  // No hubs at all: the thread is not a grouping.
  assert.ok(graph.nodes.every((node) => node.kind === "film"));
});

test("the chain is one path in watch order, not a set of pieces", () => {
  const graph = buildThread(
    library(
      [film("c"), film("a"), film("b")],
      [seen("b", "2024-02-01"), seen("c", "2024-03-01"), seen("a", "2024-01-01")],
    ),
  );

  assert.deepEqual(walk(graph), ["film:a", "film:b", "film:c"]);
  // Every film touches at most two links: a thread, not a mesh.
  for (const node of graph.nodes) {
    assert.ok(node.degree <= 2, `${node.id} has degree ${node.degree}`);
  }
});

test("films seen on the same day share one step and knot", () => {
  /*
    102 distinct days for 124 films in a real export, so this is the common case
    rather than an edge one. A step per film would stretch a binge into a straight
    run and lose the fact that it was one sitting.
  */
  const graph = buildThread(
    library(
      [film("a"), film("b"), film("c")],
      [seen("a", "2024-01-01"), seen("b", "2024-01-01"), seen("c", "2024-01-05")],
    ),
  );

  const step = (id: string) => graph.nodes.find((node) => node.id === id)?.order;
  assert.equal(step("film:a"), 0);
  assert.equal(step("film:b"), 0);
  assert.equal(step("film:c"), 1);
  assert.equal(groupCount(graph), 2);

  // The chain still runs through the knot, so the order inside a day survives.
  assert.deepEqual(walk(graph), ["film:a", "film:b", "film:c"]);
});

test("a film watched twice appears once, at its earliest date", () => {
  const graph = buildThread(
    library(
      [film("a"), film("b")],
      [
        seen("a", "2024-06-01", true),
        seen("a", "2022-01-01"),
        seen("b", "2023-01-01"),
      ],
    ),
  );

  assert.equal(graph.nodes.filter((node) => node.filmId === "a").length, 1);
  // Earliest, so the rewatch does not move the film forward past b.
  assert.deepEqual(walk(graph), ["film:a", "film:b"]);
  assert.equal(graph.nodes.find((node) => node.id === "film:a")?.order, 0);
});

test("an undated film is on the map but not on the thread", () => {
  const graph = buildThread(
    library(
      [film("a"), film("b"), film("ghost")],
      [seen("a", "2024-01-01"), seen("b", "2024-01-02"), seen("ghost", null)],
    ),
  );

  // Present — dropping it would understate the size of the library.
  assert.equal(graph.nodes.length, 3);

  const ghost = graph.nodes.find((node) => node.id === "film:ghost");
  assert.equal(ghost?.order, null);
  assert.equal(ghost?.degree, 0);
  assert.ok(
    graph.edges.every(
      (edge) => edge.source !== "film:ghost" && edge.target !== "film:ghost",
    ),
    "an undated film was given a position in time",
  );

  assert.deepEqual(
    unthreaded(graph).map((node) => node.id),
    ["film:ghost"],
  );
});

test("a film with no watch record at all is treated the same way", () => {
  // `watched.csv` establishes films with no viewing date whatsoever, which is a
  // different absence from a dated-but-null event and must behave identically.
  const graph = buildThread(
    library([film("a"), film("never")], [seen("a", "2024-01-01")]),
  );

  assert.equal(graph.nodes.find((node) => node.id === "film:never")?.order, null);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(unthreaded(graph).map((node) => node.id), ["film:never"]);
});

test("a viewing of a film the library does not hold places no step", () => {
  const graph = buildThread(
    library([film("a")], [seen("a", "2024-01-01"), seen("phantom", "2024-01-02")]),
  );

  assert.equal(graph.nodes.length, 1);
  assert.equal(groupCount(graph), 1);
  assert.equal(graph.edges.length, 0);
});

test("the film's rating rides along for the renderer to encode", () => {
  const graph = buildThread(
    library([film("a"), film("b")], [seen("a", "2024-01-01")], [["a", 4.5]]),
  );

  assert.equal(graph.nodes.find((node) => node.id === "film:a")?.rating, 4.5);
  assert.equal(graph.nodes.find((node) => node.id === "film:b")?.rating, null);
});

test("the same library always yields the same thread", () => {
  const films = [film("c"), film("a"), film("b")];
  const watches = [
    seen("b", "2024-01-01"),
    seen("a", "2024-01-01"),
    seen("c", "2024-02-01"),
  ];

  const forward = buildThread(library(films, watches));
  const reverse = buildThread(library([...films].reverse(), [...watches].reverse()));

  assert.deepEqual(forward, reverse);
  const ids = forward.nodes.map((node) => node.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("an empty library produces an empty thread rather than throwing", () => {
  const graph = buildThread(library([]));
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.shape, "thread");
  assert.equal(groupCount(graph), 0);
});

test("a real library's shape: n-1 edges over the films that have a date", () => {
  /*
    Sized and dated like the export this feature was built against: 124 films,
    114 of them dated, spread over 102 days with 15 days holding more than one.
  */
  const films = Array.from({ length: 124 }, (_, i) => film(`f${i}`));
  const watches: WatchEvent[] = [];
  let day = 0;
  for (let i = 0; i < 114; i += 1) {
    // Every eighth film shares the previous film's day, giving repeated knots.
    if (i > 0 && i % 8 !== 0) day += 1;
    watches.push(seen(`f${i}`, `2024-${String(1 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`));
  }

  const graph = buildThread(library(films, watches));
  const dated = graph.nodes.filter((node) => node.order !== null).length;

  assert.equal(dated, 114);
  assert.equal(graph.edges.length, 113);
  assert.equal(walk(graph).length, 114);
  assert.equal(unthreaded(graph).length, 10);
  assert.ok(groupCount(graph) < dated, "no day was shared");
});
