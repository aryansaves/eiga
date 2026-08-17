import test from "node:test";
import assert from "node:assert/strict";

import type { Film } from "./types.ts";
import { fold, searchFilms } from "./search.ts";

function film(id: string, title: string): Film {
  return { id, title, year: null, uri: null, directors: [] };
}

const LIBRARY: readonly Film[] = [
  film("a", "Amélie"),
  film("b", "The Third Man"),
  film("c", "Man with a Movie Camera"),
  film("d", "羅生門"),
  film("e", "WALL·E"),
];

test("folding removes case and accents but leaves other scripts alone", () => {
  assert.equal(fold("Amélie"), "amelie");
  assert.equal(fold("ÀÉÎÕÜ"), "aeiou");
  assert.equal(fold("羅生門"), "羅生門");
});

test("a query matches titles case- and accent-insensitively", () => {
  assert.deepEqual(searchFilms(LIBRARY, "amelie"), new Set(["a"]));
  assert.deepEqual(searchFilms(LIBRARY, "AMÉLIE"), new Set(["a"]));
});

test("a query matches anywhere in the title, not just the start", () => {
  assert.deepEqual(searchFilms(LIBRARY, "man"), new Set(["b", "c"]));
});

test("a non-Latin query finds a non-Latin title", () => {
  assert.deepEqual(searchFilms(LIBRARY, "羅生"), new Set(["d"]));
});

/*
  The distinction the whole search interaction rests on. GraphView dims the map
  when it is given a set and leaves it alone when it is given null, so an empty
  query and a query nothing matched must not produce the same value — otherwise a
  failed search silently looks like no search.
*/
test("no query is null, while a query with no matches is an empty set", () => {
  assert.equal(searchFilms(LIBRARY, ""), null);
  assert.equal(searchFilms(LIBRARY, "   "), null);
  assert.deepEqual(searchFilms(LIBRARY, "zzzz"), new Set());
});

test("a query is treated as text, never as a pattern", () => {
  // A regex-flavoured query matches literally or not at all; it must not throw
  // and must not match everything.
  assert.deepEqual(searchFilms(LIBRARY, ".*"), new Set());
  assert.deepEqual(searchFilms(LIBRARY, "[a-z]"), new Set());
});

/*
  Unicode classes a fair amount of punctuation as diacritic, including the
  interpunct in "WALL·E". Folding it off both sides is the point — it is what
  lets the plain spelling reach the film — but it also means a query can fold
  away to nothing, and that has to read as "not searching" rather than as a
  search that dims the entire map.
*/
test("punctuation folds out of titles, and a query of only punctuation is no query", () => {
  assert.deepEqual(searchFilms(LIBRARY, "walle"), new Set(["e"]));
  assert.equal(searchFilms(LIBRARY, "·"), null);
});
