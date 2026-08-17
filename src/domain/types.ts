/**
 * EIGA domain model.
 *
 * This is the boundary between a messy external export and the rest of the
 * application. Nothing here imports React or D3, and no raw CSV row ever
 * escapes the import layer as-is.
 *
 * Deliberately absent: `Person` and `Genre` entities. A Letterboxd export
 * contains no director, cast, genre, or runtime data, so modelling those now
 * would be inventing structure the importer cannot fill. They arrive with
 * optional metadata enrichment, not before.
 */

/**
 * Stable film identity.
 *
 * Derived from the Letterboxd short link (`https://boxd.it/XXXX`) — the same
 * code appears across `watched.csv`, `ratings.csv`, `diary.csv`, and
 * `reviews.csv`, which makes it a reliable join key. It is also opaque: unlike
 * a title slug it leaks nothing about what was watched.
 */
export type FilmId = string;

export interface Film {
  readonly id: FilmId;
  readonly title: string;
  /** Release year, or null when the export omitted or malformed it. */
  readonly year: number | null;
  /** Original Letterboxd short link, preserved for future enrichment joins. */
  readonly uri: string | null;
  /**
   * Always present, empty when unknown.
   *
   * Letterboxd exports never supply directors, so this is empty for every
   * imported library. It is populated only by authored datasets (the bundled
   * demo) and, later, by optional enrichment.
   */
  readonly directors: readonly string[];
}

export interface WatchEvent {
  readonly filmId: FilmId;
  /** ISO `YYYY-MM-DD`, or null when the export had no usable date. */
  readonly watchedOn: string | null;
  readonly rewatch: boolean;
}

/** Ratings are stored as a single internal representation: 0.5–5 in 0.5 steps. */
export const RATING_MIN = 0.5;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

export interface Library {
  readonly films: readonly Film[];
  readonly watches: readonly WatchEvent[];
  readonly ratings: ReadonlyMap<FilmId, number>;
  /**
   * The user's own review text. Highest-sensitivity content in the export:
   * never logged, never sent anywhere, always rendered as escaped text.
   */
  readonly reviews: ReadonlyMap<FilmId, string>;
}

export type DiagnosticSeverity = "warning" | "error";

/**
 * A structured, content-free import complaint.
 *
 * `message` must describe the *shape* of the problem and never quote the row,
 * because rows contain titles and reviews.
 */
export interface ImportDiagnostic {
  readonly file: string;
  /** 1-based data row (header excluded), or null for whole-file problems. */
  readonly row: number | null;
  readonly field: string | null;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

/** Everything the detail surface needs about one film, joined. */
export interface FilmDetail {
  readonly film: Film;
  readonly rating: number | null;
  readonly review: string | null;
  /** Most recent watch date, if any is known. */
  readonly watchedOn: string | null;
  readonly rewatchCount: number;
}

export function emptyLibrary(): Library {
  return { films: [], watches: [], ratings: new Map(), reviews: new Map() };
}

/** The decade a film belongs to, e.g. 1994 -> 1990. Null when the year is unknown. */
export function decadeOf(film: Film): number | null {
  if (film.year === null) return null;
  return Math.floor(film.year / 10) * 10;
}

export function decadeLabel(decade: number): string {
  return `${decade}s`;
}

export function isRating(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX &&
    Math.abs(value / RATING_STEP - Math.round(value / RATING_STEP)) < 1e-9
  );
}

/** Joins the per-film records scattered across a library into one view. */
export function describeFilm(library: Library, id: FilmId): FilmDetail | null {
  const film = library.films.find((candidate) => candidate.id === id);
  if (!film) return null;

  const watches = library.watches.filter((watch) => watch.filmId === id);
  const dated = watches
    .map((watch) => watch.watchedOn)
    .filter((date): date is string => date !== null)
    .sort();

  return {
    film,
    rating: library.ratings.get(id) ?? null,
    review: library.reviews.get(id) ?? null,
    watchedOn: dated.length > 0 ? dated[dated.length - 1] : null,
    rewatchCount: watches.filter((watch) => watch.rewatch).length,
  };
}
