/**
 * The bundled demo library.
 *
 * Two jobs. First, it answers "I want to see mine" before anyone has imported
 * anything — the landing state is a real map, not an empty stage with a file
 * input on it. Second, it is the only dataset in the app with director credits,
 * which makes it the proof that `byDirector` drops into the graph layer with no
 * change anywhere downstream.
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
  /** ISO date. Shared dates become session edges in the graph. */
  readonly seen?: string;
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

const CATALOGUE: readonly Entry[] = [
  { title: "Ivan's Childhood", year: 1962, by: TARKOVSKY, rating: 4 },
  { title: "Andrei Rublev", year: 1966, by: TARKOVSKY, rating: 4.5 },
  { title: "Solaris", year: 1972, by: TARKOVSKY, rating: 4.5, seen: "2024-02-17" },
  { title: "Mirror", year: 1975, by: TARKOVSKY },
  {
    title: "Stalker",
    year: 1979,
    by: TARKOVSKY,
    rating: 5,
    seen: "2024-02-17",
    note: "Three men walk into a room and the room is the film.",
  },
  { title: "The Sacrifice", year: 1986, by: TARKOVSKY, rating: 3.5 },

  { title: "Rashomon", year: 1950, by: KUROSAWA, rating: 4.5, seen: "2024-09-21" },
  { title: "Ikiru", year: 1952, by: KUROSAWA, rating: 4.5, seen: "2024-09-21" },
  {
    title: "Seven Samurai",
    year: 1954,
    by: KUROSAWA,
    rating: 5,
    seen: "2024-09-21",
    note: "Still the blueprint. Everything since is a footnote to the rain.",
  },
  { title: "Throne of Blood", year: 1957, by: KUROSAWA, rating: 4 },
  { title: "Yojimbo", year: 1961, by: KUROSAWA, rating: 4 },
  { title: "High and Low", year: 1963, by: KUROSAWA, rating: 4.5 },
  { title: "Ran", year: 1985, by: KUROSAWA, rating: 4 },

  { title: "Cléo from 5 to 7", year: 1962, by: VARDA, rating: 5 },
  { title: "Le Bonheur", year: 1965, by: VARDA, rating: 3.5 },
  { title: "Vagabond", year: 1985, by: VARDA, rating: 4 },
  { title: "The Gleaners and I", year: 2000, by: VARDA, rating: 4.5 },
  { title: "The Beaches of Agnès", year: 2008, by: VARDA },
  { title: "Faces Places", year: 2017, by: VARDA, rating: 4.5 },

  { title: "Chungking Express", year: 1994, by: WONG, rating: 4.5, seen: "2024-05-04" },
  { title: "Fallen Angels", year: 1995, by: WONG, rating: 4, seen: "2024-05-04" },
  { title: "Happy Together", year: 1997, by: WONG, rating: 4 },
  { title: "In the Mood for Love", year: 2000, by: WONG, rating: 5 },
  { title: "2046", year: 2004, by: WONG, rating: 3.5 },

  { title: "Ratcatcher", year: 1999, by: RAMSAY, rating: 4.5 },
  { title: "Morvern Callar", year: 2002, by: RAMSAY },
  { title: "We Need to Talk About Kevin", year: 2011, by: RAMSAY, rating: 4 },
  { title: "You Were Never Really Here", year: 2017, by: RAMSAY, rating: 4 },

  { title: "Beau Travail", year: 1999, by: DENIS, rating: 4.5 },
  { title: "Trouble Every Day", year: 2001, by: DENIS },
  { title: "35 Shots of Rum", year: 2008, by: DENIS, rating: 4 },
  { title: "High Life", year: 2018, by: DENIS, rating: 3.5 },

  { title: "Fargo", year: 1996, by: JOEL, rating: 4.5 },
  { title: "The Big Lebowski", year: 1998, by: JOEL, rating: 4 },
  // Credited to both brothers, so these films bridge two hubs.
  { title: "No Country for Old Men", year: 2007, by: COENS, rating: 4.5 },
  { title: "Burn After Reading", year: 2008, by: COENS },
  { title: "Inside Llewyn Davis", year: 2013, by: COENS, rating: 4 },
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
    if (entry.seen !== undefined) {
      watches.push({ filmId: id, watchedOn: entry.seen, rewatch: false });
    }
  }

  // Sorted to match what the importer produces, so nothing downstream can come
  // to depend on demo data being ordered differently from a real import.
  return {
    films: films.sort((a, b) => a.id.localeCompare(b.id)),
    watches: watches.sort((a, b) => a.filmId.localeCompare(b.filmId)),
    ratings,
    reviews,
    likes: new Set(),
  };
}
