import test from "node:test";
import assert from "node:assert/strict";

import { calendarPointOf, monthStarts } from "./calendar.ts";

/*
  Two layers read these answers — `graph/thread.ts` places the films, `viz/layout.ts`
  places the ticks they are read against — so a disagreement here does not show up as
  a crash. It shows up as winter films drawn on the wrong side of the February mark,
  which nobody would think to look for. Hence a test file for ninety lines of
  arithmetic.
*/

test("a date is a fraction of its own year", () => {
  assert.deepEqual(calendarPointOf("2023-01-01"), { year: 2023, through: 0 });

  const end = calendarPointOf("2023-12-31");
  assert.equal(end?.year, 2023);
  assert.equal(end?.through, 364 / 365);
  assert.ok(end !== null && end.through < 1, "December 31st is inside its own year");
});

test("the same calendar day lands at the same fraction in a leap year, near enough", () => {
  /*
    The property the row stack rests on: February under February in every row. It
    cannot be exact — a leap year has an extra day to fit in — so the honest claim is
    that the drift is under one day's width, which is about three pixels on a 1,040px
    row and invisible.
  */
  const day = 1 / 365;
  for (const date of ["03-01", "06-15", "09-30", "12-31"]) {
    const plain = calendarPointOf(`2023-${date}`);
    const leap = calendarPointOf(`2024-${date}`);
    assert.ok(plain !== null && leap !== null);
    assert.ok(
      Math.abs(plain.through - leap.through) < day,
      `${date} drifts ${(Math.abs(plain.through - leap.through) / day).toFixed(2)} days between 2023 and 2024`,
    );
  }

  // And 2024 really is the longer year, or the test above is comparing two of the same.
  assert.equal(calendarPointOf("2024-03-01")?.through, 60 / 366);
  assert.equal(calendarPointOf("2023-03-01")?.through, 59 / 365);
});

test("anything that is not an ISO day is unreadable", () => {
  for (const bad of [
    "",
    "2023",
    "2023-06",
    "06/15/2023",
    "2023-6-5",
    "2023-06-15T12:00:00Z",
    " 2023-06-15",
    "not a date",
    "2023-13-01",
    "2023-00-01",
    "2023-06-00",
    "2023-06-32",
  ]) {
    assert.equal(calendarPointOf(bad), null, `${JSON.stringify(bad)} was read as a date`);
  }
});

test("a year outside the range a diary could have is unreadable", () => {
  /*
    Not pedantry about the calendar. The timeline draws one row per year, so a single
    corrupt `0001-01-01` in an imported file would ask the layout for two thousand
    rows — the map would be a ledger, and the film that caused it would be the only
    one on screen.
  */
  assert.equal(calendarPointOf("0001-01-01"), null);
  assert.equal(calendarPointOf("1899-12-31"), null);
  assert.equal(calendarPointOf("2201-01-01"), null);

  // The range itself is wide enough for any real diary, both ends inclusive.
  assert.equal(calendarPointOf("1900-01-01")?.year, 1900);
  assert.equal(calendarPointOf("2200-01-01")?.year, 2200);
});

test("an impossible day rolls forward rather than dropping the film", () => {
  /*
    Deliberate, and the one place this module chooses drift over rejection. A
    nonsense `2023-02-30` resolves to March 2nd: two days out of place on a
    twelve-month row is a smaller error than the dot not being drawn at all, and the
    user never sees the field that caused it.
  */
  assert.equal(
    calendarPointOf("2023-02-30")?.through,
    calendarPointOf("2023-03-02")?.through,
  );
});

test("the months are where the months actually are, not even twelfths", () => {
  const starts = monthStarts(2023);
  assert.equal(starts.length, 12);
  assert.equal(starts[0], 0);

  // January is 31 days, so February begins at 31/365 — and March at 59/365, which
  // is 0.1616 where an even twelfth would say 0.1667. Five pixels on a 1,040px row.
  assert.equal(starts[1], 31 / 365);
  assert.equal(starts[2], 59 / 365);
  assert.ok(Math.abs(starts[2] - 2 / 12) > 0.004, "the ticks collapsed to even twelfths");

  for (let i = 1; i < starts.length; i += 1) {
    assert.ok(starts[i] > starts[i - 1], `month ${i + 1} does not follow month ${i}`);
  }
  assert.ok(starts[11] < 1);
});

test("a month tick and a film on its first day agree exactly", () => {
  /*
    The reason this module exists rather than each caller doing its own arithmetic.
    A tick placed at an even twelfth while the films are placed at the true boundary
    puts every winter film on the wrong side of its own mark — a map that is subtly
    lying is worse than one with no marks at all.
  */
  for (const year of [2023, 2024]) {
    const starts = monthStarts(year);
    for (let month = 0; month < 12; month += 1) {
      const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      assert.equal(
        calendarPointOf(first)?.through,
        starts[month],
        `${first} does not sit on its own month tick`,
      );
    }
  }
});
