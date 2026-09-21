import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, byDecade, type GraphNode } from "../graph/build.ts";
import { buildThread } from "../graph/thread.ts";
import { filtersFor, narrow, type FilterId } from "./filters.ts";
import { searchFilms } from "./search.ts";
import type { Film, FilmId, Library, WatchEvent } from "./types.ts";

function film(id: string, title: string): Film {
  return { id, title, year: 1999, uri: null, directors: [] };
}

function library(options: {
  films?: readonly Film[];
  watches?: readonly WatchEvent[];
  likes?: readonly FilmId[];
}): Library {
  return {
    films: options.films ?? [],
    watches: options.watches ?? [],
    ratings: new Map(),
    reviews: new Map(),
    likes: new Set(options.likes ?? []),
  };
}

const watch = (filmId: FilmId, rewatch = false): WatchEvent => ({
  filmId,
  watchedOn: "2024-03-01",
  rewatch,
});

/** Three films, one liked, one rewatched, one neither. */
function mixed(): Library {
  return library({
    films: [film("a", "Stalker"), film("b", "Solaris"), film("c", "Mirror")],
    watches: [watch("a"), watch("b"), watch("b", true)],
    likes: ["a"],
  });
}

const ids = (found: ReadonlySet<FilmId> | null) => [...(found ?? [])].sort();

test("a filter offers itself only when it would light something", () => {
  const offered = filtersFor(mixed()).map((option) => option.id);
  assert.deepEqual(offered, ["liked", "rewatched"]);

  // No likes and no rewatches is not a thin control, it is no control at all.
  const bare = library({ films: [film("a", "Stalker")], watches: [watch("a")] });
  assert.deepEqual(filtersFor(bare), []);

  const likedOnly = library({ films: [film("a", "Stalker")], likes: ["a"] });
  assert.deepEqual(
    filtersFor(likedOnly).map((option) => option.id),
    ["liked"],
  );
});

test("a chip's count is the number of dots it lights", () => {
  const found = filtersFor(mixed());
  const liked = found.find((option) => option.id === "liked");
  const rewatched = found.find((option) => option.id === "rewatched");

  assert.deepEqual(ids(liked?.films ?? null), ["a"]);
  assert.deepEqual(ids(rewatched?.films ?? null), ["b"]);
});

test("a film returned to four times is one entry, not four", () => {
  const many = library({
    films: [film("a", "Stalker")],
    watches: [watch("a"), watch("a", true), watch("a", true), watch("a", true)],
  });
  const rewatched = filtersFor(many).find((option) => option.id === "rewatched");
  assert.equal(rewatched?.films.size, 1);
});

test("a like or a rewatch naming no known film counts for nothing", () => {
  const ghosts = library({
    films: [film("a", "Stalker")],
    watches: [watch("a"), watch("gone", true)],
    likes: ["a", "vanished"],
  });

  const found = filtersFor(ghosts);
  assert.deepEqual(ids(found.find((option) => option.id === "liked")?.films ?? null), ["a"]);
  // The only rewatch names a film the library does not hold, so the chip is withheld.
  assert.equal(
    found.some((option) => option.id === "rewatched"),
    false,
  );
});

test("neither a filter nor a query means the map is not narrowed", () => {
  assert.equal(narrow(mixed(), [], ""), null);
  // A query of nothing but punctuation folds away to no query at all.
  assert.equal(narrow(mixed(), [], "  "), null);
});

test("filters union with each other rather than intersecting", () => {
  const both: readonly FilterId[] = ["liked", "rewatched"];
  // Liked is {a}, rewatched is {b}: anding them would light nothing and make
  // both counts lies the moment the second chip was pressed.
  assert.deepEqual(ids(narrow(mixed(), both, "")), ["a", "b"]);
  assert.deepEqual(ids(narrow(mixed(), ["liked"], "")), ["a"]);
});

test("a query narrows the filter rather than widening it", () => {
  const both: readonly FilterId[] = ["liked", "rewatched"];
  assert.deepEqual(ids(narrow(mixed(), both, "sol")), ["b"]);
  // Mirror matches the query but is neither liked nor rewatched.
  assert.deepEqual(ids(narrow(mixed(), both, "mirror")), []);
  // And with no filter pressed the query stands alone.
  assert.deepEqual(ids(narrow(mixed(), [], "mirror")), ["c"]);
});

test("a filter the library cannot offer does not empty the map", () => {
  const bare = library({ films: [film("a", "Stalker")], watches: [watch("a")] });
  /*
    The state a real import reaches: Liked was pressed on a library that had
    likes, and the next import has none. Resolving the id against what is on
    offer is what stops that from dimming every film and lighting none.
  */
  assert.equal(narrow(bare, ["liked"], ""), null);
  assert.deepEqual(ids(narrow(bare, ["liked"], "stalker")), ["a"]);
});

/*
  The seam that shipped broken.

  `searchFilms` answers in `FilmId`s and the graph names its nodes `film:${id}`, so
  testing a match against `node.id` finds nothing — every film reads as unmatched,
  the map dims to 8% and lights nothing, while the count beside the search box
  stays correct and makes the failure look cosmetic. `node.filmId` is the field
  that joins them, on both topologies, and nothing asserted that until now.
*/
test("what the search returns is what a film node carries", () => {
  const source = mixed();
  const found = searchFilms(source.films, "stalker");
  assert.ok(found);
  assert.equal(found.size, 1);

  for (const graph of [buildGraph(source, byDecade), buildThread(source)]) {
    /*
      Annotated, not inferred: line below tests `found.has(lit[0].id)`, and
      leaving the type to inference makes `lit` depend on the narrowing of `found`
      which depends on this block — a circularity, not a real ambiguity.
    */
    const lit: readonly GraphNode[] = graph.nodes.filter(
      (node) => node.filmId !== null && found.has(node.filmId),
    );
    assert.equal(lit.length, 1, `one film lit on the ${graph.shape} map`);
    assert.equal(lit[0].label, "Stalker");
    // The id is deliberately *not* what search answers in — this is the trap.
    assert.equal(found.has(lit[0].id), false);
  }
});

test("what narrow returns is what a film node carries", () => {
  const source = mixed();
  const graph = buildThread(source);
  const lit = narrow(source, ["rewatched"], "");
  assert.ok(lit);

  const named = [...new Set(graph.nodes
    .filter((node) => node.filmId !== null && lit.has(node.filmId))
    .map((node) => node.label))];
  assert.deepEqual(named, ["Solaris"]);
});
