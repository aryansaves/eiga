import assert from "node:assert/strict";
import test from "node:test";
import { demoLibrary } from "./demo.ts";
import { libraryFromSnapshot, snapshotFromLibrary } from "./snapshot.ts";

test("snapshot round trip preserves normalized maps, reviews, and likes", () => {
  const source = demoLibrary();
  const result = libraryFromSnapshot(
    JSON.parse(JSON.stringify(snapshotFromLibrary(source))),
  );
  assert.deepEqual(result.films, source.films);
  assert.deepEqual(result.watches, source.watches);
  assert.deepEqual([...result.ratings], [...source.ratings]);
  assert.deepEqual([...result.reviews], [...source.reviews]);
  assert.deepEqual([...result.likes], [...source.likes]);
});

test("snapshot rejects unknown versions and invalid references", () => {
  assert.throws(() => libraryFromSnapshot({ version: 2 }));
  const snapshot = snapshotFromLibrary(demoLibrary());
  assert.throws(() => libraryFromSnapshot({ ...snapshot, ratings: [["missing", 5]] }));
  assert.throws(() => libraryFromSnapshot({ ...snapshot, extra: "private metadata" }));
  assert.throws(() =>
    libraryFromSnapshot({ ...snapshot, ratings: [[snapshot.films[0].id, 5.25]] }),
  );
});
