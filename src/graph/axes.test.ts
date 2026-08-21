import test from "node:test";
import assert from "node:assert/strict";

import { demoLibrary } from "../domain/demo.ts";
import { emptyLibrary, type Film, type FilmId, type Library, type WatchEvent } from "../domain/types.ts";
import { AXES, axesFor, resolveAxis } from "./axes.ts";

function library(
  films: readonly Film[],
  watches: readonly WatchEvent[] = [],
  ratings: readonly [FilmId, number][] = [],
): Library {
  return { films, watches, ratings: new Map(ratings), reviews: new Map(), likes: new Set() };
}

const film = (id: string, year: number | null = 1999): Film => ({
  id,
  title: `Film ${id}`,
  year,
  uri: null,
  directors: [],
});

const seen = (id: string, watchedOn: string | null): WatchEvent => ({
  filmId: id,
  watchedOn,
  rewatch: false,
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

test("Watch dates comes first and Discovery second, because the first is the default", () => {
  /*
    Load-bearing rather than cosmetic. `resolveAxis` falls back to `options[0]`, so
    the order of this array *is* the defaulting rule — there is no separate default
    anywhere. Putting Discovery first would silently change what a first-time visitor
    sees, which is the one view the product's promise rests on.
  */
  const offered = axesFor(demoLibrary()).map((axis) => axis.id);

  assert.equal(offered[0], "diary");
  assert.equal(offered[1], "discovery");
});

test("a view that can say nothing about a library is not offered at all", () => {
  /*
    An import of `watched.csv` alone: titles and years, no dates, no ratings. Decade
    is the floor and the only thing it can honestly draw — a Discovery control here
    would be a button that produces an empty map, and a dead control is worse than an
    absent one.
  */
  const undated = library([film("a", 1994), film("b", 2001)]);

  assert.deepEqual(
    axesFor(undated).map((axis) => axis.id),
    ["decade"],
  );
  assert.equal(resolveAxis(undated, "discovery").id, "decade", "an impossible choice resolves");
});

test("Discovery is withheld from a library with only one film it could place", () => {
  /*
    One film is a root with nothing hanging off it, and the thread already draws that
    perfectly well. So the axis appears at two, not at one — matching `buildTree`,
    which is why both ask `placeableFilms` rather than each keeping a rule.
  */
  const one = library([film("a", 1994), film("b", 2001)], [seen("a", "2024-01-01")]);
  assert.ok(!axesFor(one).some((axis) => axis.id === "discovery"));

  const two = library(
    [film("a", 1994), film("b", 2001)],
    [seen("a", "2024-01-01"), seen("b", "2024-01-02")],
  );
  assert.ok(axesFor(two).some((axis) => axis.id === "discovery"));
});

test("Discovery needs release years, not just dates", () => {
  /*
    The thread can place a film knowing only when it was watched; the tree also needs
    to know when it was made, because that is what puts it on a row and what the
    branching rule compares. Two dated films with no years between them make a diary
    and not a tree.
  */
  const yearless = library(
    [film("a", null), film("b", null)],
    [seen("a", "2024-01-01"), seen("b", "2024-01-02")],
  );
  const offered = axesFor(yearless).map((axis) => axis.id);

  assert.ok(offered.includes("diary"), "the thread can still be drawn");
  assert.ok(!offered.includes("discovery"), "the tree has no rows to draw");
});

test("an empty library is still offered somewhere to be drawn", () => {
  // `axesFor` must never return an empty list: `resolveAxis` indexes `options[0]`,
  // and a library with nothing in it is a state the app passes through on every load.
  const offered = axesFor(emptyLibrary());

  assert.ok(offered.length > 0);
  assert.equal(resolveAxis(emptyLibrary(), "diary").id, "decade");
});
