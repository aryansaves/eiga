import test from "node:test";
import assert from "node:assert/strict";

import { observe } from "./stats.ts";
import type { Film, FilmId, Library, WatchEvent } from "./types.ts";

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
  return { films, watches, ratings: new Map(ratings), reviews: new Map() };
}

const spread = (count: number, year: number, directors: readonly string[] = []) =>
  Array.from({ length: count }, (_, i) => film(`${year}-${i}`, year, directors));

test("says nothing when there is nothing honest to say", () => {
  assert.equal(observe(library([])), null);
  assert.equal(observe(library([film("a", 1975), film("b", 1978)])), null);
});

test("a repeated director outranks every other observation", () => {
  const result = observe(
    library([...spread(3, 2015, ["Lynne Ramsay"]), ...spread(9, 2015)]),
  );
  assert.equal(result, "You have a strange amount of Lynne Ramsay.");
});

test("reports a decade the library leans on", () => {
  const result = observe(
    library([...spread(8, 2015), ...spread(2, 1975), ...spread(2, 1995)]),
  );
  assert.equal(result, "8 of your 12 films come from the 2010s.");
});

test("an even spread is a range, not a preference", () => {
  const result = observe(
    library([
      ...spread(4, 1975),
      ...spread(4, 1985),
      ...spread(4, 1995),
    ]),
  );
  assert.equal(result, "Your cinema spans 3 decades.");
});

test("the same library always produces the same sentence", () => {
  // Several candidates qualify here; reordering the input must not change which
  // one the user is shown.
  const films = [
    ...spread(3, 2015, ["Lynne Ramsay"]),
    ...spread(6, 2015),
    ...spread(3, 1975),
  ];
  const ratings = films.map((film, i): [string, number] => [film.id, i % 2 ? 4 : 5]);

  const forward = observe(library(films, [], ratings));
  const reverse = observe(library([...films].reverse(), [], [...ratings].reverse()));

  assert.notEqual(forward, null);
  assert.equal(forward, reverse);
  assert.equal(forward, observe(library(films, [], ratings)));
});
