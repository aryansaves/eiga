/**
 * The bundled demo library.
 *
 * Two jobs. First, it answers "I want to see mine" before anyone has imported
 * anything — the landing state is a real map, not an empty stage with a file
 * input on it. Second, it is the only dataset in the app with director credits,
 * which makes it the proof that `byDirector` drops into the graph layer with no
 * change anywhere downstream.
 *
 * Since the diary thread became the default view, the *dates* here carry as much
 * weight as the credits: the first map anyone sees is this catalogue's viewing
 * order, so it has to read as somebody's year and a half of watching rather than a
 * handful of dots. Hence a full diary, three multi-film days, three rewatches, a
 * few likes, and four films deliberately left undated so the outer band that holds
 * them is something the landing state explains rather than something an import
 * springs on you.
 *
 * Everything here is authored: real films by real directors, with invented
 * ratings and viewing dates. It contains no imported data and no personal data,
 * so unlike a real library it is safe to commit.
 */

import type { Film, FilmId, Library, WatchEvent } from "./types.ts";

interface Entry {
  readonly title: string;
  readonly year: number;
  readonly by: readonly string[];
  readonly rating?: number;
  /**
   * ISO date of the first viewing, and the film's place on the diary thread.
   * Shared dates put films on the same step, which is what draws a knot.
   * Omitted for a film logged without one — those join no step.
   */
  readonly seen?: string;
  /** ISO date of a later viewing, marking the film as a rewatch. */
  readonly again?: string;
  /** A heart rather than a rating: the handful this viewer would press. */
  readonly liked?: true;
  readonly note?: string;
}

const TARKOVSKY = ["Andrei Tarkovsky"];
const KUROSAWA = ["Akira Kurosawa"];
const VARDA = ["Agnès Varda"];
const WONG = ["Wong Kar-wai"];
const RAMSAY = ["Lynne Ramsay"];
const DENIS = ["Claire Denis"];
const JOEL = ["Joel Coen"];
const COENS = ["Joel Coen", "Ethan Coen"];

/*
  The catalogue, and with it a diary.

  Grouped by director for reading here, but the *dates* run in a different order
  on purpose: this viewer works through one filmography at a time, so the thread
  shows a Tarkovsky run in early 2024, five Wong films in the spring and a
  Kurosawa autumn. That is what makes switching from Watch order to Director worth
  watching — the arcs of the spiral are already the clusters, and the films travel
  from one reading of themselves to the other.

  Four entries carry no `seen` date. A real export has around ten, and they are the
  one thing on the map that has to be explained rather than discovered.
*/
const CATALOGUE: readonly Entry[] = [
  { title: "Ivan's Childhood", year: 1962, by: TARKOVSKY, rating: 4, seen: "2024-01-06" },
  { title: "Andrei Rublev", year: 1966, by: TARKOVSKY, rating: 4.5, seen: "2024-01-20" },
  { title: "Solaris", year: 1972, by: TARKOVSKY, rating: 4.5, seen: "2024-02-17" },
  { title: "Mirror", year: 1975, by: TARKOVSKY, seen: "2024-03-02" },
  {
    title: "Stalker",
    year: 1979,
    by: TARKOVSKY,
    rating: 5,
    seen: "2024-02-17",
    again: "2025-02-22",
    liked: true,
    note: "Three men walk into a room and the room is the film.",
  },
  { title: "The Sacrifice", year: 1986, by: TARKOVSKY, rating: 3.5, seen: "2024-03-16" },

  { title: "Rashomon", year: 1950, by: KUROSAWA, rating: 4.5, seen: "2024-09-21" },
  { title: "Ikiru", year: 1952, by: KUROSAWA, rating: 4.5, seen: "2024-09-21", liked: true },
  {
    title: "Seven Samurai",
    year: 1954,
    by: KUROSAWA,
    rating: 5,
    seen: "2024-09-21",
    again: "2025-06-14",
    liked: true,
    note: "Still the blueprint. Everything since is a footnote to the rain.",
  },
  { title: "Throne of Blood", year: 1957, by: KUROSAWA, rating: 4, seen: "2024-10-12" },
  { title: "Yojimbo", year: 1961, by: KUROSAWA, rating: 4, seen: "2024-10-26" },
  { title: "High and Low", year: 1963, by: KUROSAWA, rating: 4.5, seen: "2024-11-16" },
  { title: "Ran", year: 1985, by: KUROSAWA, rating: 4, seen: "2024-12-07" },

  {
    title: "Cléo from 5 to 7",
    year: 1962,
    by: VARDA,
    rating: 5,
    seen: "2023-11-12",
    liked: true,
  },
  // Logged, never dated: the four of these scatter beyond the last turn.
  { title: "Le Bonheur", year: 1965, by: VARDA, rating: 3.5 },
  { title: "Vagabond", year: 1985, by: VARDA, rating: 4, seen: "2024-06-22" },
  { title: "The Gleaners and I", year: 2000, by: VARDA, rating: 4.5, seen: "2024-07-13" },
  { title: "The Beaches of Agnès", year: 2008, by: VARDA },
  { title: "Faces Places", year: 2017, by: VARDA, rating: 4.5, seen: "2025-05-31" },

  {
    title: "Chungking Express",
    year: 1994,
    by: WONG,
    rating: 4.5,
    seen: "2024-05-04",
    liked: true,
  },
  { title: "Fallen Angels", year: 1995, by: WONG, rating: 4, seen: "2024-05-04" },
  { title: "Happy Together", year: 1997, by: WONG, rating: 4, seen: "2024-05-18" },
  {
    title: "In the Mood for Love",
    year: 2000,
    by: WONG,
    rating: 5,
    seen: "2024-04-13",
    again: "2025-01-25",
    liked: true,
  },
  { title: "2046", year: 2004, by: WONG, rating: 3.5, seen: "2024-06-01" },

  { title: "Ratcatcher", year: 1999, by: RAMSAY, rating: 4.5, seen: "2023-12-27" },
  // Liked but never rated — the map should not imply a heart is five stars.
  { title: "Morvern Callar", year: 2002, by: RAMSAY, seen: "2024-08-03", liked: true },
  {
    title: "We Need to Talk About Kevin",
    year: 2011,
    by: RAMSAY,
    rating: 4,
    seen: "2024-08-24",
  },
  {
    title: "You Were Never Really Here",
    year: 2017,
    by: RAMSAY,
    rating: 4,
    seen: "2025-03-22",
  },

  { title: "Beau Travail", year: 1999, by: DENIS, rating: 4.5, seen: "2024-03-30" },
  { title: "Trouble Every Day", year: 2001, by: DENIS },
  { title: "35 Shots of Rum", year: 2008, by: DENIS, rating: 4, seen: "2025-01-11" },
  { title: "High Life", year: 2018, by: DENIS, rating: 3.5, seen: "2025-03-01" },

  { title: "Fargo", year: 1996, by: JOEL, rating: 4.5, seen: "2023-12-09" },
  { title: "The Big Lebowski", year: 1998, by: JOEL, rating: 4, seen: "2023-12-10" },
  // Credited to both brothers, so these films bridge two hubs.
  {
    title: "No Country for Old Men",
    year: 2007,
    by: COENS,
    rating: 4.5,
    seen: "2025-04-12",
  },
  { title: "Burn After Reading", year: 2008, by: COENS },
  { title: "Inside Llewyn Davis", year: 2013, by: COENS, rating: 4, seen: "2025-05-03" },
];

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Namespaced so a demo id can never be mistaken for an imported one. */
function demoId(entry: Entry): FilmId {
  return `demo:${slug(entry.title)}-${entry.year}`;
}

export function demoLibrary(): Library {
  const films: Film[] = [];
  const watches: WatchEvent[] = [];
  const ratings = new Map<FilmId, number>();
  const reviews = new Map<FilmId, string>();
  const likes = new Set<FilmId>();

  for (const entry of CATALOGUE) {
    const id = demoId(entry);
    films.push({
      id,
      title: entry.title,
      year: entry.year,
      uri: null,
      directors: entry.by,
    });
    if (entry.rating !== undefined) ratings.set(id, entry.rating);
    if (entry.note !== undefined) reviews.set(id, entry.note);
    if (entry.liked) likes.add(id);
    if (entry.seen !== undefined) {
      watches.push({ filmId: id, watchedOn: entry.seen, rewatch: false });
    }
    /*
      A rewatch is a second viewing of something already logged, so it is only
      recorded alongside a first — an `again` with no `seen` would assert a return
      to a film never watched, which the importer could not produce either.
    */
    if (entry.again !== undefined && entry.seen !== undefined) {
      watches.push({ filmId: id, watchedOn: entry.again, rewatch: true });
    }
  }

  // Sorted to match what the importer produces, so nothing downstream can come
  // to depend on demo data being ordered differently from a real import. The
  // date tie-break is what keeps a film's two viewings in a fixed order.
  return {
    films: films.sort((a, b) => a.id.localeCompare(b.id)),
    watches: watches.sort((a, b) =>
      a.filmId === b.filmId
        ? (a.watchedOn ?? "").localeCompare(b.watchedOn ?? "")
        : a.filmId.localeCompare(b.filmId),
    ),
    ratings,
    reviews,
    likes,
  };
}
