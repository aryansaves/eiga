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
  return {
    films,
    watches,
    ratings: new Map(ratings),
    reviews: new Map(),
    likes: new Set(),
  };
}

const spread = (count: number, year: number, directors: readonly string[] = []) =>
  Array.from({ length: count }, (_, i) => film(`${year}-${i}`, year, directors));

/** Viewings on a given date, as the diary would record them. */
const viewings = (count: number, date: string, from = 0): WatchEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    filmId: `w${from + i}`,
    watchedOn: date,
    rewatch: false,
  }));

test("says nothing when there is nothing honest to say", () => {
  assert.equal(observe(library([]), null), null);
  assert.equal(observe(library([film("a", 1975), film("b", 1978)]), null), null);
});

test("a repeated director outranks every other observation", () => {
  const result = observe(
    library([...spread(3, 2015, ["Lynne Ramsay"]), ...spread(9, 2015)]),
    null,
  );
  assert.equal(result, "You have a strange amount of Lynne Ramsay.");
});

test("reports a decade the library leans on", () => {
  const result = observe(
    library([...spread(8, 2015), ...spread(2, 1975), ...spread(2, 1995)]),
    null,
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
    null,
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

  const forward = observe(library(films, [], ratings), null);
  const reverse = observe(
    library([...films].reverse(), [], [...ratings].reverse()),
    null,
  );

  assert.notEqual(forward, null);
  assert.equal(forward, reverse);
  assert.equal(forward, observe(library(films, [], ratings), null));
});

test("names the busiest year, but only when one year is clearly busiest", () => {
  const films = spread(12, 2015);
  const clear = library(films, [...viewings(8, "2024-03-01"), ...viewings(4, "2023-03-01", 8)]);
  assert.equal(
    observe(clear, "watchYear"),
    "2024 was your busiest year — 8 of 12 viewings.",
  );

  /*
    The same viewings split evenly. "Busiest" would be a claim the data does not
    support, so the candidate withdraws — and since nothing else about this
    library clears a threshold, the honest result is silence.
  */
  const tied = library(films, [...viewings(6, "2024-03-01"), ...viewings(6, "2023-03-01", 6)]);
  assert.equal(observe(tied, "watchYear"), null);
});

/*
  The axis only ever changes which true thing is said, never whether something is
  said. These two libraries are identical; only the view differs.
*/
test("the axis on screen decides which observation is preferred", () => {
  const films = [...spread(8, 2015), ...spread(2, 1975), ...spread(2, 1995)];
  const ratings = films.map((film): [string, number] => [film.id, 5]);
  const shelf = library(films, [], ratings);

  assert.equal(observe(shelf, "decade"), "8 of your 12 films come from the 2010s.");
  assert.equal(
    observe(shelf, "rating"),
    "You are generous: 100% of what you rate lands at four stars or better.",
  );
});

test("no axis can make EIGA say something it would otherwise not", () => {
  // Nothing here clears any threshold, so every axis must still say nothing.
  const thin = library([film("a", 1975), film("b", 1978)]);
  for (const axis of ["decade", "rating", "watchYear", "director"] as const) {
    assert.equal(observe(thin, axis), null, `axis ${axis} invented an observation`);
  }
});

test("a remarkable director outranks the axis being looked at", () => {
  const films = [...spread(4, 2015, ["Lynne Ramsay"]), ...spread(8, 2015)];
  const ratings = films.map((film): [string, number] => [film.id, 5]);

  // The rating line gets the bonus here and still loses, which is the intent:
  // the director fact is worth saying whatever the map is grouped by.
  assert.equal(
    observe(library(films, [], ratings), "rating"),
    "You have a strange amount of Lynne Ramsay.",
  );
});
