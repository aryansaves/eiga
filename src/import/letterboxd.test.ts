import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyFile,
  filmIdFrom,
  importNamedCsvs,
  type NamedCsv,
} from "./letterboxd.ts";

/*
  Fixture URIs mirror a real export, which is subtler than it looks: `watched`
  and `ratings` link the film, while `diary` links the diary *entry* and so uses
  a completely disjoint set of codes. An earlier version of these fixtures gave
  diary rows film URIs, which hid a bug that duplicated every logged film.
*/
const WATCHED = `Date,Name,Year,Letterboxd URI
2024-01-04,Stalker,1979,https://boxd.it/2bTa
2024-02-11,"Dune, Part Two",2024,https://boxd.it/qW26
2024-03-02,Paprika,2006,https://boxd.it/1Z4a
`;

const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2024-01-04,Stalker,1979,https://boxd.it/2bTa,4.5
2024-02-11,"Dune, Part Two",2024,https://boxd.it/qW26,4
`;

const DIARY = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-04,Stalker,1979,https://boxd.it/eNtRy1,4.5,,,2024-01-03
2024-02-11,"Dune, Part Two",2024,https://boxd.it/eNtRy2,4,,,2024-02-10
2024-03-02,Paprika,2006,https://boxd.it/eNtRy3,5,Yes,,2024-02-10
`;

const STALKER = "title:stalker:1979";
const DUNE = "title:dune-part-two:2024";
const PAPRIKA = "title:paprika:2006";

/** Header verified against a real export. Solaris is liked but never watched. */
const LIKES = `Date,Name,Year,Letterboxd URI
2024-06-01,Stalker,1979,https://boxd.it/2bTa
2024-06-02,Solaris,1972,https://boxd.it/2aaa
`;

test("classifies export files by name, never by header shape", () => {
  // These three share the identical header `Date,Name,Year,Letterboxd URI`.
  assert.equal(classifyFile("watched.csv"), "watched");
  assert.equal(classifyFile("watchlist.csv"), "watchlist");
  assert.equal(classifyFile("likes/films.csv"), "likes");

  assert.equal(classifyFile("diary.csv"), "diary");
  assert.equal(classifyFile("profile.csv"), "profile");
  assert.equal(classifyFile("Ratings.CSV"), "ratings");
  assert.equal(classifyFile("something-else.csv"), "unknown");
});

test("nesting demotes a watch-history name, but likes belong nested", () => {
  /*
    Reachable only now that archives are read, and load-bearing: a real export
    ships the *full diary schema* — `Watched Date` and all — under `deleted/` and
    `orphaned/`. Classifying on the basename alone would import entries the user
    deleted, and entries whose film Letterboxd lost, as viewings that happened.
  */
  assert.equal(classifyFile("deleted/diary.csv"), "unknown");
  assert.equal(classifyFile("orphaned/diary.csv"), "unknown");
  assert.equal(classifyFile("deleted/reviews.csv"), "unknown");
  assert.equal(classifyFile("deleted/lists/peak-run.csv"), "unknown");

  /*
    `likes/reviews.csv` is *other people's* reviews you liked. Its columns are
    `Date,Content` — it has no `Name` at all — so read as your own reviews it
    produces a spurious "not a recognised Letterboxd export" error on every
    archive import.
  */
  assert.equal(classifyFile("likes/reviews.csv"), "unknown");

  // Likes are not watch history, so nesting is exactly where they belong.
  assert.equal(classifyFile("likes/films.csv"), "likes");
  // The top level is untouched.
  assert.equal(classifyFile("diary.csv"), "diary");
  assert.equal(classifyFile("reviews.csv"), "reviews");
});

test("deleted and orphaned diary entries contribute no viewings", () => {
  const removed = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2023-01-01,Removed Film,1999,https://boxd.it/eNtRy9,4,,,2023-01-01
`;
  const result = importNamedCsvs([
    { name: "diary.csv", text: DIARY },
    { name: "deleted/diary.csv", text: removed },
    { name: "orphaned/diary.csv", text: removed },
  ]);

  assert.ok(!result.library.films.some((film) => film.title === "Removed Film"));
  assert.equal(result.library.watches.length, 3);
  assert.deepEqual(
    [...result.skipped].sort(),
    ["deleted/diary.csv", "orphaned/diary.csv"],
  );
});

test("a like annotates a film and never conjures one", () => {
  const result = importNamedCsvs([
    { name: "watched.csv", text: WATCHED },
    { name: "likes/films.csv", text: LIKES },
  ]);

  // Solaris is liked but appears in no watch history, so it is not a film here.
  assert.equal(result.library.films.length, 3);
  assert.deepEqual([...result.library.likes], [STALKER]);

  /*
    `likes/films.csv` has a `Date` column, but it records when the heart was
    clicked. Read as a viewing it would invent watch dates that never happened —
    and on the diary thread those dates decide where a film sits.
  */
  assert.equal(result.library.watches.length, 0);
  assert.equal(result.library.ratings.size, 0);

  const dropped = result.diagnostics.find((note) =>
    note.message.includes("not in your watch history"),
  );
  assert.equal(dropped?.severity, "warning");
  assert.ok(
    !JSON.stringify(result.diagnostics).includes("Solaris"),
    "the diagnostic named the film it dropped",
  );
});

test("likes do not depend on the order files were selected", () => {
  /*
    `likes/films.csv` sorts before `watched.csv`, so at the moment a like is read
    the film it names does not exist yet. Resolving in `finalize` is what makes
    "a like never conjures a film" true by construction rather than by luck.
  */
  const files: NamedCsv[] = [
    { name: "likes/films.csv", text: LIKES },
    { name: "watched.csv", text: WATCHED },
  ];

  const forward = importNamedCsvs(files);
  const reverse = importNamedCsvs([...files].reverse());

  assert.deepEqual([...forward.library.likes], [STALKER]);
  assert.deepEqual([...forward.library.likes], [...reverse.library.likes]);
});

test("likes alone are not a library", () => {
  // Readable, but they establish nothing. Without this the import reports
  // success and draws an empty map.
  const result = importNamedCsvs([{ name: "likes/films.csv", text: LIKES }]);

  assert.equal(result.library.films.length, 0);
  assert.equal(result.library.likes.size, 0);
  assert.ok(result.diagnostics.some((note) => note.severity === "error"));
});

test("watchlist is never imported as watch history", () => {
  const result = importNamedCsvs([
    { name: "watched.csv", text: WATCHED },
    {
      name: "watchlist.csv",
      text: `Date,Name,Year,Letterboxd URI\n2024-05-01,Solaris,1972,https://boxd.it/2aaa\n`,
    },
  ]);

  assert.equal(result.library.films.length, 3);
  assert.ok(!result.library.films.some((film) => film.title === "Solaris"));
  assert.deepEqual(result.skipped, ["watchlist.csv"]);
});

test("profile.csv is skipped deliberately and contributes nothing", () => {
  const result = importNamedCsvs([
    { name: "watched.csv", text: WATCHED },
    {
      name: "profile.csv",
      text: `Date Joined,Username,Given Name,Family Name,Email Address,Location,Website,Bio,Pronoun,Favorite Films
2019-03-02,someone,Given,Family,person@example.com,Somewhere,,A bio,they,
`,
    },
  ]);

  assert.deepEqual(result.skipped, ["profile.csv"]);

  // No identity value may reach the library or the diagnostics.
  const serialized = JSON.stringify({
    films: result.library.films,
    diagnostics: result.diagnostics,
  });
  for (const secret of ["person@example.com", "Somewhere", "A bio", "Family"]) {
    assert.ok(!serialized.includes(secret), `leaked ${secret}`);
  }
});

test("identity comes from title and year, never from the URI column", () => {
  assert.equal(filmIdFrom("Dune, Part Two", 2024), DUNE);
  assert.equal(filmIdFrom("Stalker", 1979), STALKER);
  assert.equal(filmIdFrom("!!!", null), "title:untitled:unknown");
  // Punctuation and case must not split one film into two.
  assert.equal(filmIdFrom("WALL·E", 2008), filmIdFrom("Wall E", 2008));
});

test("a diary entry URI does not fork the film it records", () => {
  /*
    The regression this file exists for. `diary.csv` addresses entries, not
    films, so keying on the URI produced one node per file instead of one per
    film — on a real 124-film export that meant 242 films and a map with every
    logged title drawn twice.
  */
  const result = importNamedCsvs([
    { name: "watched.csv", text: WATCHED },
    { name: "ratings.csv", text: RATINGS },
    { name: "diary.csv", text: DIARY },
  ]);

  assert.equal(result.library.films.length, 3);
  assert.deepEqual([...new Set(result.library.watches.map((w) => w.filmId))].sort(), [
    DUNE,
    PAPRIKA,
    STALKER,
  ]);

  // The film keeps the film link; the entry code is never mistaken for one.
  assert.equal(result.library.films.find((f) => f.id === STALKER)?.uri, "https://boxd.it/2bTa");
  assert.ok(
    result.library.films.every((film) => !film.uri?.includes("eNtRy")),
    "an entry URI was stored as a film link",
  );
});

test("titles containing commas survive parsing", () => {
  const result = importNamedCsvs([{ name: "watched.csv", text: WATCHED }]);
  const titles = result.library.films.map((film) => film.title).sort();
  assert.deepEqual(titles, ["Dune, Part Two", "Paprika", "Stalker"]);
});

test("merges the same film across every file it appears in", () => {
  const result = importNamedCsvs([
    { name: "watched.csv", text: WATCHED },
    { name: "ratings.csv", text: RATINGS },
    { name: "diary.csv", text: DIARY },
  ]);

  assert.equal(result.library.films.length, 3);
  assert.equal(result.library.ratings.size, 3);
  assert.equal(result.library.ratings.get(STALKER), 4.5);
  // Paprika is rated only in diary.csv, so this fails if diary is keyed apart.
  assert.equal(result.library.ratings.get(PAPRIKA), 5);
});

test("only real Watched Date columns produce viewings", () => {
  // watched.csv has a `Date` column, but that is when the row was logged.
  const loggedOnly = importNamedCsvs([{ name: "watched.csv", text: WATCHED }]);
  assert.equal(loggedOnly.library.watches.length, 0);

  const diary = importNamedCsvs([{ name: "diary.csv", text: DIARY }]);
  assert.deepEqual(
    diary.library.watches.map((watch) => watch.watchedOn).sort(),
    ["2024-01-03", "2024-02-10", "2024-02-10"],
  );
  assert.equal(diary.library.watches.filter((watch) => watch.rewatch).length, 1);
});

test("overlapping diary and reviews rows do not double-count viewings", () => {
  // reviews.csv shares diary's entry-URI space: a review belongs to an entry.
  const reviews = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date
2024-01-04,Stalker,1979,https://boxd.it/eNtRy1,4.5,,A quiet miracle.,,2024-01-03
`;
  const result = importNamedCsvs([
    { name: "diary.csv", text: DIARY },
    { name: "reviews.csv", text: reviews },
  ]);

  const stalker = result.library.watches.filter((w) => w.filmId === STALKER);
  assert.equal(stalker.length, 1);
  assert.equal(result.library.reviews.get(STALKER), "A quiet miracle.");
});

test("malformed fields degrade to warnings without dropping the film", () => {
  const messy = `Date,Name,Year,Letterboxd URI,Rating
2024-01-01,Fine Film,1999,https://boxd.it/aaaa,4
2024-01-02,Bad Year,19x9,https://boxd.it/bbbb,3
2024-01-03,Bad Rating,2001,https://boxd.it/cccc,11
`;
  const result = importNamedCsvs([{ name: "ratings.csv", text: messy }]);

  assert.equal(result.library.films.length, 3);
  assert.equal(result.library.films.find((f) => f.title === "Bad Year")?.year, null);
  assert.equal(result.library.ratings.has("title:bad-rating:2001"), false);

  const fields = result.diagnostics.map((d) => d.field).sort();
  assert.deepEqual(fields, ["Rating", "Year"]);
  assert.ok(result.diagnostics.every((d) => d.severity === "warning"));
});

test("a row with no title is an error and is skipped", () => {
  const result = importNamedCsvs([
    {
      name: "watched.csv",
      text: `Date,Name,Year,Letterboxd URI\n2024-01-01,,1999,https://boxd.it/aaaa\n`,
    },
  ]);

  assert.equal(result.library.films.length, 0);
  assert.equal(result.diagnostics[0].severity, "error");
  assert.equal(result.diagnostics[0].row, 1);
});

test("diagnostics never quote row content", () => {
  const sensitive = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date
2024-01-01,A Very Distinctive Title,not-a-year,https://boxd.it/aaaa,99,,I felt seen and it wrecked me.,,not-a-date
`;
  const result = importNamedCsvs([{ name: "reviews.csv", text: sensitive }]);

  assert.ok(result.diagnostics.length >= 3);
  const messages = result.diagnostics.map((d) => d.message).join(" ");
  for (const fragment of [
    "A Very Distinctive Title",
    "I felt seen and it wrecked me.",
    "not-a-year",
    "not-a-date",
    "99",
  ]) {
    assert.ok(!messages.includes(fragment), `diagnostic leaked: ${fragment}`);
  }

  // The review itself is still kept for display.
  assert.equal(
    result.library.reviews.get("title:a-very-distinctive-title:unknown"),
    "I felt seen and it wrecked me.",
  );
});

test("an unusable selection reports an actionable error", () => {
  const result = importNamedCsvs([{ name: "notes.txt", text: "hello" }]);
  assert.equal(result.library.films.length, 0);
  assert.ok(result.diagnostics.some((d) => d.severity === "error"));
});

test("result does not depend on the order files were selected", () => {
  const files: NamedCsv[] = [
    { name: "watched.csv", text: WATCHED },
    { name: "ratings.csv", text: RATINGS },
    { name: "diary.csv", text: DIARY },
  ];
  const forward = importNamedCsvs(files);
  const reverse = importNamedCsvs([...files].reverse());

  assert.deepEqual(forward.library.films, reverse.library.films);
  assert.deepEqual(forward.library.watches, reverse.library.watches);
  assert.deepEqual([...forward.library.ratings], [...reverse.library.ratings]);
});
