/**
 * Finding a film in the map.
 *
 * Pure and deterministic, and deliberately not clever. There is no ranking, no
 * fuzzy distance, no tokenising — a substring test on the title, folded so that
 * accents and case do not stand between someone and a film they can see on
 * screen. Anything more would need a relevance model, and a map has nowhere to
 * put a relevance model: every match is lit equally because every match is
 * equally *there*.
 *
 * Imported titles are untrusted text, so nothing here interpolates them into a
 * pattern. `includes` on folded strings has no metacharacters to escape.
 */

import type { Film, FilmId } from "./types.ts";

/**
 * Normalises a string for comparison.
 *
 * Decomposed, stripped of combining marks, lowercased: "Amélie" and "amelie"
 * become the same string, so a keyboard without accents still reaches the film.
 * Scripts that do not decompose are simply lowercased and left alone, which is
 * correct — folding Japanese to Latin is not something a search box should
 * invent.
 */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * The films whose titles contain the query, or null when there is no query.
 *
 * Null and empty are different answers and both matter: null means the user is
 * not searching, so the map stays at full strength, while an empty set means they
 * are searching and nothing matched, so the map dims and says so. Collapsing the
 * two would make a failed search look like a cleared one.
 *
 * A query that folds away to nothing counts as no query. Unicode marks a good
 * deal of punctuation as diacritic — the interpunct in "WALL·E" among it — which
 * is what lets someone type `walle` and find that film, and means a query of
 * nothing but such marks has no letters left to discriminate on. Dimming the
 * whole map in response to that would be a worse answer than not searching.
 */
export function searchFilms(
  films: readonly Film[],
  query: string,
): ReadonlySet<FilmId> | null {
  const needle = fold(query.trim());
  if (needle.length === 0) return null;

  const matches = new Set<FilmId>();
  for (const film of films) {
    if (fold(film.title).includes(needle)) matches.add(film.id);
  }
  return matches;
}
