import { isRating, type Library, type Film, type WatchEvent } from "./types.ts";

export interface Snapshot {
  readonly version: 1;
  readonly films: readonly Film[];
  readonly watches: readonly WatchEvent[];
  readonly ratings: readonly (readonly [string, number])[];
  readonly reviews: readonly (readonly [string, string])[];
  readonly likes: readonly string[];
}

export const MAX_SNAPSHOT_BYTES = 1_500_000;

export function snapshotFromLibrary(library: Library): Snapshot {
  const snapshot: Snapshot = {
    version: 1,
    films: library.films.map((film) => ({ ...film, directors: [...film.directors] })),
    watches: library.watches.map((watch) => ({ ...watch })),
    ratings: [...library.ratings],
    reviews: [...library.reviews],
    likes: [...library.likes],
  };
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES
  ) {
    throw new Error("This atlas exceeds the save size limit");
  }
  return snapshot;
}

export function libraryFromSnapshot(value: unknown): Library {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !onlyKeys(value, ["version", "films", "watches", "ratings", "reviews", "likes"])
  )
    throw new Error("Unsupported library snapshot");
  if (
    !Array.isArray(value.films) ||
    !Array.isArray(value.watches) ||
    !Array.isArray(value.ratings) ||
    !Array.isArray(value.reviews) ||
    !Array.isArray(value.likes)
  ) {
    throw new Error("Invalid library snapshot");
  }
  const films: Film[] = value.films.map((item) => {
    if (
      !isRecord(item) ||
      !onlyKeys(item, ["id", "title", "year", "uri", "directors"]) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      !(item.year === null || Number.isInteger(item.year)) ||
      !(item.uri === null || typeof item.uri === "string") ||
      !Array.isArray(item.directors) ||
      !item.directors.every((entry) => typeof entry === "string")
    ) {
      throw new Error("Invalid film in library snapshot");
    }
    return {
      id: item.id,
      title: item.title,
      year: item.year as number | null,
      uri: item.uri as string | null,
      directors: item.directors as string[],
    };
  });
  const filmIds = new Set(films.map((film) => film.id));
  if (filmIds.size !== films.length)
    throw new Error("Duplicate film in library snapshot");
  const watches: WatchEvent[] = value.watches.map((item) => {
    if (
      !isRecord(item) ||
      !onlyKeys(item, ["filmId", "watchedOn", "rewatch"]) ||
      typeof item.filmId !== "string" ||
      !filmIds.has(item.filmId) ||
      !(item.watchedOn === null || typeof item.watchedOn === "string") ||
      typeof item.rewatch !== "boolean"
    ) {
      throw new Error("Invalid watch in library snapshot");
    }
    return {
      filmId: item.filmId,
      watchedOn: item.watchedOn as string | null,
      rewatch: item.rewatch,
    };
  });
  const ratings = entries(
    value.ratings,
    filmIds,
    (entry): entry is number => typeof entry === "number" && isRating(entry),
  );
  const reviews = entries(
    value.reviews,
    filmIds,
    (entry): entry is string => typeof entry === "string",
  );
  if (
    !value.likes.every((id) => typeof id === "string" && filmIds.has(id)) ||
    new Set(value.likes).size !== value.likes.length
  ) {
    throw new Error("Invalid likes in library snapshot");
  }
  const library = {
    films,
    watches,
    ratings,
    reviews,
    likes: new Set(value.likes as string[]),
  };
  if (
    new TextEncoder().encode(JSON.stringify(snapshotFromLibrary(library))).byteLength >
    MAX_SNAPSHOT_BYTES
  ) {
    throw new Error("Library snapshot exceeds the size limit");
  }
  return library;
}

export function parseSnapshot(text: string): Library {
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error("Library snapshot exceeds the size limit");
  try {
    return libraryFromSnapshot(JSON.parse(text));
  } catch {
    throw new Error("Invalid library snapshot");
  }
}

function entries<T>(
  value: unknown[],
  ids: ReadonlySet<string>,
  valid: (entry: unknown) => entry is T,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const pair of value) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      !ids.has(pair[0]) ||
      !valid(pair[1]) ||
      result.has(pair[0])
    ) {
      throw new Error("Invalid library snapshot entries");
    }
    result.set(pair[0], pair[1]);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
