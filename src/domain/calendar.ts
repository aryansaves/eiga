/**
 * Calendar arithmetic for the diary timeline.
 *
 * Small and pure on purpose. Two layers need the same answers and must not be
 * allowed to disagree: `graph/thread.ts` turns a watch date into a position
 * inside its year, and `viz/layout.ts` draws the month graticule that position is
 * read against. A February tick placed at an even twelfth while the films are
 * placed at the true boundary would put every winter film on the wrong side of
 * its own mark — a map that is subtly lying is worse than one with no marks.
 *
 * `Date.UTC` is used only as a leap-year table. It is the one piece of calendar
 * knowledge not worth reimplementing, and it is a pure function of its arguments.
 * Deliberately no `new Date()` and no local timezone anywhere here: a watch date
 * is a calendar day, not an instant, and reading it through the user's zone can
 * move it by one.
 */

/** `YYYY-MM-DD`, the only shape Letterboxd writes and the only one accepted. */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/*
  Watch years outside this range are reported unreadable rather than plotted.

  Not paranoia: the timeline draws one row per year, so a single corrupt
  `0001-01-01` in an imported file would otherwise ask the layout for two
  thousand rows. Wide enough to hold any real diary — Letterboxd launched in 2011
  and people back-log decades of viewing — and narrow enough that a malformed
  file cannot turn the map into a ledger.
*/
const YEAR_MIN = 1900;
const YEAR_MAX = 2200;

/** Where a day falls inside its own calendar year. */
export interface CalendarPoint {
  readonly year: number;
  /**
   * Fraction through the year: 0 on January 1st, just under 1 on December 31st.
   *
   * Leap-year aware, so a given date lands under the same month tick in 2024 as
   * in 2023 — which is the entire reason the years are stacked as rows.
   */
  readonly through: number;
}

/**
 * A watch date as a point on its year, or null if it cannot be read as one.
 *
 * Null is a real answer and callers must handle it: a film whose date is
 * unreadable has no honest place on a timeline, and the thread treats it exactly
 * like a film with no date at all.
 */
export function calendarPointOf(watchedOn: string): CalendarPoint | null {
  const parts = ISO_DAY.exec(watchedOn);
  if (parts === null) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < YEAR_MIN || year > YEAR_MAX) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const start = Date.UTC(year, 0, 1);
  const length = Date.UTC(year + 1, 0, 1) - start;

  /*
    `Date.UTC` rolls a day past the end of its month into the next one, so a
    nonsense `2023-02-30` resolves to March 2nd rather than being rejected. That
    is deliberate: the alternative is dropping a film off the map over a typo in
    a field the user never sees, and two days of drift along a twelve-month row
    is a smaller error than the dot drawn on it.
  */
  return { year, through: (Date.UTC(year, month - 1, day) - start) / length };
}

/**
 * The fraction of the year at which each month begins, January first.
 *
 * Twelve computed numbers rather than even twelfths: February is 28/365 of a
 * year, so March begins at 0.162 and not at 0.167. Five pixels on a thousand-pixel
 * row — invisible on its own, and glaring the moment a film sits on the wrong side
 * of a tick.
 */
export function monthStarts(year: number): readonly number[] {
  const start = Date.UTC(year, 0, 1);
  const length = Date.UTC(year + 1, 0, 1) - start;
  return Array.from(
    { length: 12 },
    (_, month) => (Date.UTC(year, month, 1) - start) / length,
  );
}
