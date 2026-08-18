/**
 * Letterboxd export ingestion.
 *
 * Everything here is deliberately boring and deterministic: raw rows in,
 * validated domain records plus structured diagnostics out. The impure part
 * (reading a `File`) is confined to `importLetterboxdFiles`; the logic that
 * matters is testable with plain strings.
 *
 * Two rules govern this module:
 *
 *  1. A diagnostic never quotes a row. Rows contain titles and reviews, so
 *     messages describe the *shape* of a problem and nothing else.
 *  2. `profile.csv` is never read. It carries email, legal name, location and
 *     bio, none of which EIGA has any use for.
 *
 * V1 reads either the export `.zip` or loose CSVs. The archive is expanded by
 * `src/import/zip.ts` and its entries are fed through the same deterministic core,
 * so nothing below knows which of the two it was handed.
 */

import Papa from "papaparse";
import {
  isRating,
  type Film,
  type FilmId,
  type ImportDiagnostic,
  type Library,
  type WatchEvent,
} from "../domain/types.ts";
import { readZip } from "./zip.ts";

export type LetterboxdFileKind =
  | "watched"
  | "ratings"
  | "diary"
  | "reviews"
  | "watchlist"
  | "likes"
  | "profile"
  | "unknown";

export interface ImportResult {
  readonly library: Library;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly accepted: readonly string[];
  readonly skipped: readonly string[];
}

const YEAR_MIN = 1870;
const YEAR_MAX = 2100;

/**
 * Files are classified by name, never by header shape.
 *
 * This matters: `watched.csv`, `watchlist.csv` and `likes/films.csv` have
 * byte-identical headers (`Date,Name,Year,Letterboxd URI`). Guessing from the
 * header would silently import 85 films you have never seen as films you have.
 * An unrecognised name is skipped and reported rather than guessed at.
 *
 * Nesting is part of the name. An export contains `deleted/diary.csv`,
 * `orphaned/diary.csv` and `likes/reviews.csv` — respectively entries you
 * removed, entries whose film Letterboxd lost, and *other people's* reviews that
 * you liked. All three share a basename with real watch history, so a watch-history
 * kind is only ever returned for a file at the top level. `likes/films.csv` is
 * unaffected because likes are not watch history and are expected to be nested.
 */
export function classifyFile(fileName: string): LetterboxdFileKind {
  const path = fileName.trim().toLowerCase();
  const base = path.split("/").pop() ?? "";
  const nested = path.includes("/");

  const kind = kindOfBasename(base);
  return nested && WATCH_HISTORY.has(kind) ? "unknown" : kind;
}

function kindOfBasename(base: string): LetterboxdFileKind {
  switch (base) {
    case "watched.csv":
      return "watched";
    case "ratings.csv":
      return "ratings";
    case "diary.csv":
      return "diary";
    case "reviews.csv":
      return "reviews";
    case "watchlist.csv":
      return "watchlist";
    case "films.csv":
      return "likes";
    case "profile.csv":
      return "profile";
    default:
      return "unknown";
  }
}

/** Kinds that describe films actually watched. The rest are not watch history. */
const WATCH_HISTORY: ReadonlySet<LetterboxdFileKind> = new Set([
  "watched",
  "ratings",
  "diary",
  "reviews",
]);

/**
 * Everything EIGA opens at all.
 *
 * Likes are read but are not watch history: they annotate films the rest of the
 * export establishes. `watchlist` and `profile` are absent deliberately — the
 * first is films never seen, the second is account identity.
 */
const READABLE: ReadonlySet<LetterboxdFileKind> = new Set([
  ...WATCH_HISTORY,
  "likes",
]);

/**
 * Files whose `Letterboxd URI` column addresses a film.
 *
 * `diary.csv` and `reviews.csv` are deliberately absent: their URI addresses the
 * diary entry instead. See {@link filmIdFrom}.
 */
const FILM_URI_FILES: ReadonlySet<LetterboxdFileKind> = new Set([
  "watched",
  "ratings",
  "watchlist",
]);

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/**
 * Stable identity for a film.
 *
 * Deliberately derived from title and year, and NOT from the `Letterboxd URI`
 * column, even though a `https://boxd.it/XXXX` code looks like the obvious join
 * key. An export contains two disjoint URI spaces:
 *
 *  - `watched.csv`, `ratings.csv` and `watchlist.csv` link the *film*.
 *  - `diary.csv` and `reviews.csv` link the *diary entry* — a different object
 *    with its own code, one per viewing rather than one per film.
 *
 * Keying on the URI therefore merges nothing between those two groups: a real
 * export produced 124 film-keyed records plus 118 entry-keyed records and called
 * them 242 distinct films, duplicating every film that had been logged. Title
 * and year are present in all four files and agree across them.
 *
 * The cost is that two genuinely different films sharing a title and a release
 * year collapse into one. That is rare, and vastly preferable to splitting one
 * film into two on every import.
 */
export function filmIdFrom(title: string, year: number | null): FilmId {
  return `title:${slugify(title)}:${year ?? "unknown"}`;
}

function readYear(
  raw: string | undefined,
  file: string,
  row: number,
  into: ImportDiagnostic[],
): number | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;

  const year = Number(value);
  if (!/^\d{4}$/.test(value) || year < YEAR_MIN || year > YEAR_MAX) {
    into.push({
      file,
      row,
      field: "Year",
      severity: "warning",
      message: "year is not a plausible four-digit year; treated as unknown",
    });
    return null;
  }
  return year;
}

function readRating(
  raw: string | undefined,
  file: string,
  row: number,
  into: ImportDiagnostic[],
): number | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;

  const rating = Number(value);
  if (!Number.isFinite(rating) || !isRating(rating)) {
    into.push({
      file,
      row,
      field: "Rating",
      severity: "warning",
      message: "rating is not a 0.5-5 value in half-star steps; discarded",
    });
    return null;
  }
  return rating;
}

function readIsoDate(
  raw: string | undefined,
  field: string,
  file: string,
  row: number,
  into: ImportDiagnostic[],
): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    into.push({
      file,
      row,
      field,
      severity: "warning",
      message: "date is not a valid ISO YYYY-MM-DD value; treated as unknown",
    });
    return null;
  }
  return value;
}

interface Accumulator {
  readonly films: Map<FilmId, Film>;
  readonly watches: Map<string, WatchEvent>;
  readonly ratings: Map<FilmId, number>;
  readonly reviews: Map<FilmId, string>;
  /**
   * Candidate liked films, intersected with `films` in {@link finalize}.
   *
   * Held as candidates rather than resolved on the spot because files are read in
   * name order, which puts `likes/films.csv` before `watched.csv` — at the moment
   * a like is read, the film it names usually does not exist yet. Deferring makes
   * the rule "a like never conjures a film" true by construction rather than by
   * depending on the order the user selected files in.
   */
  readonly liked: Set<FilmId>;
  readonly diagnostics: ImportDiagnostic[];
}

function createAccumulator(): Accumulator {
  return {
    films: new Map(),
    watches: new Map(),
    ratings: new Map(),
    reviews: new Map(),
    liked: new Set(),
    diagnostics: [],
  };
}

/** Merges a film into the accumulator, preferring the record that knows more. */
function mergeFilm(into: Accumulator, film: Film): void {
  const existing = into.films.get(film.id);
  if (!existing) {
    into.films.set(film.id, film);
    return;
  }

  into.films.set(film.id, {
    id: existing.id,
    title: existing.title || film.title,
    year: existing.year ?? film.year,
    uri: existing.uri ?? film.uri,
    directors:
      existing.directors.length > 0 ? existing.directors : film.directors,
  });
}

/**
 * Ingests one classified CSV's text into the accumulator.
 *
 * Pure apart from mutating the accumulator it is handed, so it can be driven
 * directly from string fixtures in tests.
 */
export function ingestCsv(
  kind: LetterboxdFileKind,
  fileName: string,
  text: string,
  into: Accumulator,
): void {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  // Papa reports malformed rows by index; we surface the position only.
  for (const error of parsed.errors) {
    into.diagnostics.push({
      file: fileName,
      row: typeof error.row === "number" ? error.row + 1 : null,
      field: null,
      severity: "warning",
      message: `row could not be parsed as CSV (${error.code})`,
    });
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    into.diagnostics.push({
      file: fileName,
      row: null,
      field: null,
      severity: "warning",
      message: "file contained no data rows",
    });
    return;
  }

  if (!("Name" in rows[0])) {
    into.diagnostics.push({
      file: fileName,
      row: null,
      field: "Name",
      severity: "error",
      message: "file has no Name column; not a recognised Letterboxd export",
    });
    return;
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const title = row.Name?.trim() ?? "";

    if (title === "") {
      into.diagnostics.push({
        file: fileName,
        row: rowNumber,
        field: "Name",
        severity: "error",
        message: "row has no film title; skipped",
      });
      return;
    }

    const year = readYear(row.Year, fileName, rowNumber, into.diagnostics);
    const id = filmIdFrom(title, year);

    /*
      A like is an annotation, not evidence of a viewing. It records the id and
      stops: no film, no rating, no watch event. `likes/films.csv` has a `Date`
      column, but that is when the heart was clicked — reading it as a viewing
      would invent 27 watch dates that never happened.
    */
    if (kind === "likes") {
      into.liked.add(id);
      return;
    }

    /*
      Only the film-linking files contribute a URI. In `diary.csv` and
      `reviews.csv` this column addresses the entry, not the film, and storing
      that as the film's link would poison the field for later enrichment —
      files are merged in name order, so `diary` would otherwise win it.
    */
    const uri = FILM_URI_FILES.has(kind)
      ? row["Letterboxd URI"]?.trim() || null
      : null;

    mergeFilm(into, { id, title, year, uri, directors: [] });

    const rating = readRating(row.Rating, fileName, rowNumber, into.diagnostics);
    if (rating !== null && !into.ratings.has(id)) {
      into.ratings.set(id, rating);
    }

    const review = row.Review?.trim();
    if (review && !into.reviews.has(id)) {
      into.reviews.set(id, review);
    }

    /*
      Only `diary.csv` and `reviews.csv` carry a real "Watched Date". The `Date`
      column elsewhere is when the row was logged, which is not when the film
      was seen — using it would put false dates on the detail panel and invent
      co-viewing sessions that never happened.

      Both files describe overlapping viewings, so events are keyed and deduped.
    */
    if (kind === "diary" || kind === "reviews") {
      const watchedOn = readIsoDate(
        row["Watched Date"],
        "Watched Date",
        fileName,
        rowNumber,
        into.diagnostics,
      );
      const rewatch = row.Rewatch?.trim().toLowerCase() === "yes";
      into.watches.set(`${id}|${watchedOn ?? ""}|${rewatch}`, {
        filmId: id,
        watchedOn,
        rewatch,
      });
    }
  });
}

function finalize(acc: Accumulator): Library {
  /*
    Likes are intersected with the films the watch history established. A like
    naming a film nothing else mentions is dropped rather than promoted into a
    film EIGA would then draw as watched. On a real export none of the 27 were
    dropped, which is a fact worth checking rather than relying on.
  */
  const likes = new Set<FilmId>();
  let unmatched = 0;
  for (const id of acc.liked) {
    if (acc.films.has(id)) likes.add(id);
    else unmatched += 1;
  }

  if (unmatched > 0) {
    acc.diagnostics.push({
      file: "likes/films.csv",
      row: null,
      field: null,
      severity: "warning",
      message: `${unmatched} liked ${unmatched === 1 ? "film is" : "films are"} not in your watch history; ${unmatched === 1 ? "it was" : "they were"} not added to the map`,
    });
  }

  return {
    // Sorted so the library — and therefore the graph — is deterministic.
    films: [...acc.films.values()].sort((a, b) => a.id.localeCompare(b.id)),
    watches: [...acc.watches.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, watch]) => watch),
    ratings: acc.ratings,
    reviews: acc.reviews,
    likes,
  };
}

/** A named blob of CSV text — the testable shape behind a browser `File`. */
export interface NamedCsv {
  readonly name: string;
  readonly text: string;
}

/**
 * Ingests a set of named CSVs into one library.
 *
 * Inputs are sorted by name first so the result never depends on the order the
 * user happened to select files in.
 */
export function importNamedCsvs(files: readonly NamedCsv[]): ImportResult {
  const acc = createAccumulator();
  const accepted: string[] = [];
  const skipped: string[] = [];
  let sawWatchHistory = false;

  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name));

  for (const file of ordered) {
    const kind = classifyFile(file.name);

    if (kind === "profile") {
      skipped.push(file.name);
      acc.diagnostics.push({
        file: file.name,
        row: null,
        field: null,
        severity: "warning",
        message:
          "skipped deliberately: this file holds account identity details EIGA does not read",
      });
      continue;
    }

    if (!READABLE.has(kind)) {
      skipped.push(file.name);
      acc.diagnostics.push({
        file: file.name,
        row: null,
        field: null,
        severity: "warning",
        message:
          kind === "unknown"
            ? "skipped: not a recognised Letterboxd export file"
            : "skipped: this file is not watch history",
      });
      continue;
    }

    if (WATCH_HISTORY.has(kind)) sawWatchHistory = true;
    accepted.push(file.name);
    ingestCsv(kind, file.name, file.text, acc);
  }

  /*
    Keyed on watch history rather than on `accepted`, because likes alone are
    readable but establish nothing: an import of `likes/films.csv` by itself
    would otherwise report success and draw an empty map.
  */
  if (!sawWatchHistory) {
    acc.diagnostics.push({
      file: "",
      row: null,
      field: null,
      severity: "error",
      message:
        "no watch history found. Select your export .zip, or watched.csv, ratings.csv, diary.csv or reviews.csv from it",
    });
  }

  return {
    library: finalize(acc),
    diagnostics: acc.diagnostics,
    accepted,
    skipped,
  };
}

/**
 * Whether a blob begins with a zip signature.
 *
 * Sniffed rather than trusting the extension: a `.zip` renamed by a mail client,
 * or a CSV named `export.zip`, should both do the sensible thing. Both the local
 * header and empty-archive signatures are accepted so an export containing
 * nothing still reaches the archive path and gets the archive's error message.
 */
async function looksLikeArchive(file: Blob): Promise<boolean> {
  if (file.size < 4) return false;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return false;
  return (
    (head[2] === 0x03 && head[3] === 0x04) ||
    (head[2] === 0x05 && head[3] === 0x06)
  );
}

/**
 * Browser entry point. The only impure function in this module: it reads the
 * files, then hands plain text to the deterministic core above.
 *
 * An export `.zip` is expanded here and its entries join any loose CSVs in the
 * same list — `importNamedCsvs` already sorts and dedupes by name, so mixing the
 * two needs no special case. An archive that cannot be read becomes one error
 * and does not stop the other files from importing.
 *
 * File contents never leave the browser.
 */
export async function importLetterboxdFiles(
  files: readonly File[],
): Promise<ImportResult> {
  const named: NamedCsv[] = [];
  const notes: ImportDiagnostic[] = [];

  for (const file of files) {
    if (!(await looksLikeArchive(file))) {
      named.push({ name: file.name, text: await file.text() });
      continue;
    }

    /*
      `include` decides what is decompressed at all, so files EIGA has promised
      not to read are never expanded — not read and discarded, never opened. It
      also records what it saw, which is how the archive can still report the
      deliberate `profile.csv` skip without that file being touched.
    */
    const seen = new Set<LetterboxdFileKind>();
    const include = (path: string): boolean => {
      const kind = classifyFile(path);
      seen.add(kind);
      return READABLE.has(kind);
    };

    try {
      const archive = await readZip(file, include);
      for (const entry of archive.entries) {
        named.push({ name: entry.path, text: entry.text });
      }

      const total = archive.entries.length + archive.ignored;
      notes.push({
        file: file.name,
        row: null,
        field: null,
        severity: "warning",
        message: `expanded archive: read ${archive.entries.length} of ${total} files; the rest were not opened`,
      });

      if (seen.has("profile")) {
        notes.push({
          file: file.name,
          row: null,
          field: null,
          severity: "warning",
          message:
            "the export's account identity file was never opened: EIGA does not read it",
        });
      }
    } catch (error) {
      notes.push({
        file: file.name,
        row: null,
        field: null,
        severity: "error",
        message:
          error instanceof Error
            ? error.message
            : "this archive could not be read",
      });
    }
  }

  const result = importNamedCsvs(named);
  return { ...result, diagnostics: [...notes, ...result.diagnostics] };
}

export type { Accumulator };
export { createAccumulator };
