import test from "node:test";
import assert from "node:assert/strict";

import { demoLibrary } from "../domain/demo.ts";
import { emptyLibrary, type Film, type Library, type WatchEvent } from "../domain/types.ts";
import { AXES, axesFor, resolveAxis } from "./axes.ts";

function library(films: readonly Film[], watches: readonly WatchEvent[] = []): Library {
  return { films, watches, ratings: new Map(), reviews: new Map(), likes: new Set() };
}

const film = (id: string, year: number | null = 1999): Film => ({
  id,
  title: `Film ${id}`,
  year,
  uri: null,
  directors: [],
});

test("the offered views stay in the order the row declares them", () => {
  /*
    `axesFor` filters and never sorts, which is what makes the array literal in
    `axes.ts` the single statement of display order. A control that reordered itself
    per library would move under the user's cursor when they swapped the demo for
    their own import.
  */
  const declared = AXES.map((axis) => axis.id);
  const offered = axesFor(demoLibrary()).map((axis) => axis.id);

  assert.deepEqual(
    offered,
    declared.filter((id) => offered.includes(id)),
  );
});

test("Watch dates comes first, because the first offered view is the default", () => {
  /*
    Load-bearing rather than cosmetic. `resolveAxis` falls back to `options[0]`, so
    the order of this array *is* the defaulting rule — there is no separate default
    anywhere. Reordering it would silently change what a first-time visitor sees,
    which is the one view the product's promise rests on.
  */
  assert.equal(axesFor(demoLibrary())[0].id, "diary");
});

test("a view that can say nothing about a library is not offered at all", () => {
  /*
    An import of `watched.csv` alone: titles and years, no dates, no ratings. Decade
    is the floor and the only thing it can honestly draw — anything else here would
    be a button that produces an empty or single-blob map, and a dead control is
    worse than an absent one.
  */
  const undated = library([film("a", 1994), film("b", 2001)]);

  assert.deepEqual(
    axesFor(undated).map((axis) => axis.id),
    ["decade"],
  );
  assert.equal(resolveAxis(undated, "diary").id, "decade", "an impossible choice resolves");
});

test("one dated viewing is enough to offer the timeline", () => {
  const dated = library(
    [film("a", 1994), film("b", 2001)],
    [{ filmId: "a", watchedOn: "2024-01-01", rewatch: false }],
  );

  assert.equal(resolveAxis(dated, "diary").id, "diary");
});

test("an empty library is still offered somewhere to be drawn", () => {
  // `axesFor` must never return an empty list: `resolveAxis` indexes `options[0]`,
  // and a library with nothing in it is a state the app passes through on every load.
  const offered = axesFor(emptyLibrary());

  assert.ok(offered.length > 0);
  assert.equal(resolveAxis(emptyLibrary(), "diary").id, "decade");
});
