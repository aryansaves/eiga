/**
 * Derived statistics.
 *
 * One honest observation beats a dashboard, so this module's job is to find the
 * single most notable thing about a library and say it in EIGA's voice. Every
 * candidate is scored, and ties break deterministically — the same library must
 * always produce the same sentence.
 *
 * Candidates also declare which axis they speak to, and one that matches what is
 * currently on screen is scored up. The alternative was a sentence per axis,
 * which would have meant four times the prose to maintain and four chances to
 * say something untrue; this way the observation stays a single set of facts and
 * only the choice between them follows the view.
 */

import {
  decadeLabel,
  decadeOf,
  watchYearOf,
  type AxisId,
  type Library,
} from "./types.ts";

interface Candidate {
  readonly score: number;
  readonly text: string;
  /**
   * The axis this observation is about, if any.
   *
   * Left off where an observation is about the library as a whole rather than
   * about one way of grouping it — claiming a false alignment would promote a
   * line for a view it has nothing to do with.
   */
  readonly axis?: AxisId;
}

/**
 * Added to a candidate that speaks to the axis being looked at.
 *
 * Sized to reorder comparable candidates without overruling a genuinely stronger
 * one: enough for the rating line to beat the decade lean while the rating axis is
 * on screen, not enough to reach the director line, which is remarkable no matter
 * what you happen to be looking at.
 */
const AXIS_BONUS = 25;

/** Counts values, returning entries sorted by count desc then key asc. */
function tally<T extends string | number>(
  values: readonly T[],
): readonly [T, number][] {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : String(a[0]).localeCompare(String(b[0])),
  );
}

function directorConcentration(library: Library): Candidate | null {
  const credits = library.films.flatMap((film) => film.directors);
  const ranked = tally(credits);
  if (ranked.length === 0) return null;

  const [name, count] = ranked[0];
  if (count < 3) return null;

  // The strongest observation EIGA can make, so it outranks the rest.
  return {
    score: 100 + count,
    text: `You have a strange amount of ${name}.`,
    axis: "director",
  };
}

function decadeConcentration(library: Library): Candidate | null {
  const decades = library.films
    .map(decadeOf)
    .filter((decade): decade is number => decade !== null);
  if (decades.length < 10) return null;

  const ranked = tally(decades);
  const [decade, count] = ranked[0];
  const share = count / decades.length;

  /*
    A lean is only notable relative to an even spread. Across three decades an
    even split is already 33% each, so a flat threshold would announce a
    preference that does not exist. Require half again the even share — and
    never less than 30%, so a library spanning many decades still needs a real
    concentration to earn the line.
  */
  const evenShare = 1 / ranked.length;
  if (share < Math.max(0.3, evenShare * 1.5)) return null;

  return {
    score: 40 + Math.round(share * 20),
    text: `${count} of your ${decades.length} films come from the ${decadeLabel(decade)}.`,
    axis: "decade",
  };
}

function ratingGenerosity(library: Library): Candidate | null {
  const values = [...library.ratings.values()];
  if (values.length < 10) return null;

  const high = values.filter((value) => value >= 4).length;
  const share = high / values.length;
  if (share < 0.5) return null;

  return {
    score: 30 + Math.round(share * 10),
    text: `You are generous: ${Math.round(share * 100)}% of what you rate lands at four stars or better.`,
    axis: "rating",
  };
}

function rewatchHabit(library: Library): Candidate | null {
  const total = library.watches.length;
  if (total < 20) return null;

  const rewatches = library.watches.filter((watch) => watch.rewatch).length;
  const share = rewatches / total;
  if (share > 0.1) return null;

  return {
    score: 20,
    text: `You rarely return — ${rewatches} rewatches across ${total} viewings.`,
  };
}

function decadeRange(library: Library): Candidate | null {
  const decades = new Set(
    library.films
      .map(decadeOf)
      .filter((decade): decade is number => decade !== null),
  );
  if (decades.size < 3) return null;

  return { score: 10, text: `Your cinema spans ${decades.size} decades.`, axis: "decade" };
}

/**
 * The year the user watched the most.
 *
 * A superlative rather than a lean, which is why it needs no share threshold: the
 * busiest year is the busiest year even when the spread is flat. It does need
 * something to be busiest *than*, though. With one year there is no comparison to
 * make, and with two years tied "busiest" claims something the data does not
 * support — so both cases say nothing rather than dress a technicality up as an
 * observation.
 */
function watchYearPeak(library: Library): Candidate | null {
  const years = library.watches
    .map((watch) => watchYearOf(watch.watchedOn))
    .filter((year): year is number => year !== null);
  if (years.length < 10) return null;

  const ranked = tally(years);
  if (ranked.length < 2) return null;
  const [year, count] = ranked[0];
  if (count === ranked[1][1]) return null;

  return {
    score: 25,
    text: `${year} was your busiest year — ${count} of ${years.length} viewings.`,
    axis: "watchYear",
  };
}

/**
 * The one line EIGA says about a library, or null when there is nothing
 * honest to say yet.
 *
 * `axis` is what the map is currently grouped by, or null for no view in
 * particular. It only ever reorders candidates — nothing becomes sayable because
 * of it, so no axis can make EIGA claim something it would not otherwise claim.
 */
export function observe(library: Library, axis: AxisId | null): string | null {
  const candidates = [
    directorConcentration(library),
    decadeConcentration(library),
    ratingGenerosity(library),
    watchYearPeak(library),
    rewatchHabit(library),
    decadeRange(library),
  ].filter((candidate): candidate is Candidate => candidate !== null);

  if (candidates.length === 0) return null;

  const scored = candidates.map((candidate) => ({
    text: candidate.text,
    score: candidate.score + (axis !== null && candidate.axis === axis ? AXIS_BONUS : 0),
  }));

  return scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.text.localeCompare(b.text),
  )[0].text;
}
