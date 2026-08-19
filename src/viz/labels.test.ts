import test from "node:test";
import assert from "node:assert/strict";

import { demoLibrary } from "../domain/demo.ts";
import {
  RATING_MIN,
  RATING_STEP,
  type Film,
  type FilmId,
  type Library,
  type WatchEvent,
} from "../domain/types.ts";
import { buildGraph, byDecade } from "../graph/build.ts";
import { buildThread } from "../graph/thread.ts";
import { createLayout, settle } from "./layout.ts";
import { labelBox, yearLabelBox, visibleLabels, LABEL_FLOOR, type Box } from "./labels.ts";

/*
  The label choice is pure, so it is measured here rather than in a browser — and
  it has to be: whether two titles overlap is a question about boxes, and a
  screenshot can only be looked at, not asserted on.
*/

const WIDTH = 1280;
const HEIGHT = 860;

/**
 * A library shaped like the reported one: 124 films over 102 watch days.
 *
 * The size matters. The bug was reported at 124 films and is invisible at the
 * demo's 37 — a map that small has room for every title, so a test built on the
 * demo would pass with no thinning at all.
 */
function crowded(count = 124): Library {
  const films: Film[] = [];
  const watches: WatchEvent[] = [];
  const ratings = new Map<FilmId, number>();

  /* Real titles run long, and length is the whole variable here: a box is
     `length × font × factor` wide, so fixtures with short ids would make every
     label fit and assert nothing. */
  const words = ["Portrait", "of", "a", "Lady", "on", "Fire", "The", "Long", "Farewell"];

  for (let i = 0; i < count; i += 1) {
    const id = `f${String(i).padStart(4, "0")}`;
    const title = words.slice(0, 3 + (i % 6)).join(" ");
    films.push({ id, title, year: 1970 + (i % 50), uri: null, directors: [] });
    ratings.set(id, RATING_MIN + (i % 10) * RATING_STEP);
    // Every fourth film shares the previous day, which is what makes knots.
    const day = 1 + Math.floor(i * 0.82);
    watches.push({
      filmId: id,
      watchedOn: new Date(Date.UTC(2023, 0, day)).toISOString().slice(0, 10),
      rewatch: false,
    });
  }

  return { films, watches, ratings, reviews: new Map(), likes: new Set() };
}

/** Every film node of a settled map, with the labels chosen for it at `scale`. */
function chosen(library: Library, scale: number, lit: ReadonlySet<string> | null = null) {
  const graph = buildThread(library);
  const layout = createLayout(graph, WIDTH, HEIGHT);
  settle(layout.simulation);

  const named = visibleLabels({ nodes: layout.nodes, rows: layout.rows, lit, scale });
  return { layout, named };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/*
  The assertion the old mechanism could never have passed.

  `data-detail="near"` showed every title at once above 1.6× zoom, so at 124 films
  the map printed a hundred names over each other and there was no code path that
  could have said no. This is that bug expressed as a property.
*/
test("no two titles the map shows overlap, at any zoom", () => {
  for (const scale of [0.5, 0.8, 1, 1.6, 3, 6]) {
    const { layout, named } = chosen(crowded(), scale);

    const boxes = layout.nodes
      .filter((node) => named.has(node.id))
      .map((node) => ({ id: node.id, box: labelBox(node, scale) }));

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        assert.ok(
          !overlaps(boxes[i].box, boxes[j].box),
          `at ${scale}× the titles of ${boxes[i].id} and ${boxes[j].id} overlap`,
        );
      }
    }
  }
});

test("a hub's name and a year label are never printed over", () => {
  /*
    Structure is seeded into the occupied list before any film, so this is the
    same invariant as above but across the two kinds of label the map draws
    unconditionally. Checked on both topologies, since a hub map has hub labels
    and no year rows and the timeline has the reverse — and both are in the
    guarded set, or the timeline half of this test would assert nothing.
  */
  for (const graph of [buildThread(crowded()), buildGraph(crowded(), byDecade)]) {
    const layout = createLayout(graph, WIDTH, HEIGHT);
    settle(layout.simulation);

    const scale = 1.6;
    const named = visibleLabels({ nodes: layout.nodes, rows: layout.rows, lit: null, scale });
    const structure = layout.nodes
      .filter((node) => node.kind === "hub")
      .map((node) => ({ what: "a hub label", box: labelBox(node, scale) }));
    for (const row of layout.rows) {
      structure.push({ what: `the ${row.year} label`, box: yearLabelBox(row, scale) });
    }
    assert.ok(structure.length > 0, "nothing structural to guard");

    for (const node of layout.nodes) {
      if (!named.has(node.id)) continue;
      const box = labelBox(node, scale);
      for (const other of structure) {
        assert.ok(!overlaps(other.box, box), `${node.id} is named over ${other.what}`);
      }
    }
  }
});

test("zooming in reveals more names, and never fewer", () => {
  const library = crowded();
  const ladder = [LABEL_FLOOR, 0.8, 1, 1.4, 2, 3, 4.5, 6];

  let previous = -1;
  const counts: number[] = [];
  for (const scale of ladder) {
    const { named } = chosen(library, scale);
    counts.push(named.size);
    assert.ok(
      named.size >= previous,
      `${scale}× shows ${named.size} names, fewer than the ${previous} at the step before`,
    );
    previous = named.size;
  }

  // And the range has to actually do something, or the mechanism is decorative.
  assert.ok(
    counts[counts.length - 1] > counts[0] * 2,
    `names barely change across the zoom range: ${counts.join(" → ")}`,
  );

  /*
    Gradually, which is the whole complaint. A single zoom threshold — the
    mechanism this replaces — is also monotone: it reads 0,0,0,0,124,124,124,124
    and satisfies everything above. Counting *distinct* steps is what separates a
    hierarchy from a switch, and a switch can only ever produce two.
  */
  assert.ok(
    new Set(counts).size >= ladder.length - 1,
    `names arrive in ${new Set(counts).size} jumps, not gradually: ${counts.join(" → ")}`,
  );
});

test("below the floor the map carries no titles", () => {
  const { named } = chosen(crowded(), LABEL_FLOOR - 0.01);
  assert.equal(named.size, 0);

  // And the floor itself is inclusive, so there is no scale with nothing at all.
  const { named: at } = chosen(crowded(), LABEL_FLOOR);
  assert.ok(at.size > 0);
});

test("a film the user searched for is named before one they did not", () => {
  const library = crowded();
  /*
    Taken from the crowded middle of the thread rather than the sparse rim: a
    film out at the edge would be named anyway and the test would pass without
    the priority it exists to check.
  */
  const graph = buildThread(library);
  const dense = graph.nodes.filter((node) => node.kind === "film" && node.order !== null);
  const target = dense[Math.floor(dense.length / 2)];
  assert.ok(target.filmId);

  const scale = 1;
  const { named: quiet } = chosen(library, scale);
  const { named: searched } = chosen(library, scale, new Set([target.filmId]));

  assert.equal(quiet.has(target.id), false, "the fixture film was already named");
  assert.equal(searched.has(target.id), true, "a searched film went unnamed");
});

test("the same map always names the same films", () => {
  const library = demoLibrary();
  const first = chosen(library, 1.6).named;
  const second = chosen(library, 1.6).named;
  assert.deepEqual([...first].sort(), [...second].sort());
});

test("names thin out as the library grows, rather than piling up", () => {
  /*
    The property that makes this a fix and not a cap: a bigger library does not
    get more titles printed on the same disc, it gets a similar number spread over
    a larger one. Without the collision test the count would track the film count.
  */
  const scale = 1;
  const small = chosen(crowded(37), scale).named.size;
  const large = chosen(crowded(300), scale).named.size;

  assert.ok(small > 0 && large > 0);
  assert.ok(
    large < 300 * 0.5,
    `a 300-film map named ${large} films, which is not thinning`,
  );
});

test("a label hangs off the correct side of its own dot", () => {
  /*
    Cheap, and it pins the offsets duplicated out of globals.css: a box is placed
    from the node's radius and a `dy` this module cannot see. If the renderer's
    offset and this one ever part company, labels drift onto their own dots and
    every collision assertion above still passes.

    Asserted on the box's centre rather than its top edge, because the padding is
    deliberately allowed to overlap the dot — it is clear space for *other*
    labels, and demanding the dot sit outside it too would be asserting a number
    this test cannot see. Where the centre falls is the claim: films read below
    their dot, hubs above theirs.
  */
  for (const graph of [buildThread(crowded()), buildGraph(crowded(), byDecade)]) {
    const layout = createLayout(graph, WIDTH, HEIGHT);
    settle(layout.simulation);

    for (const node of layout.nodes) {
      const box = labelBox(node, 1);
      const middle = (box.top + box.bottom) / 2;
      if (node.kind === "film") {
        assert.ok(
          middle > node.y + node.radius,
          `${node.id}'s title does not hang below its dot`,
        );
      } else {
        assert.ok(
          middle < node.y - node.radius,
          `${node.id}'s name does not sit above its dot`,
        );
      }
    }
  }
});
