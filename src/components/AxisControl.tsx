"use client";

/**
 * The axis control.
 *
 * The one place the user changes what the map means, so it sits directly under
 * the tagline where it answers "what am I looking at?" before the graph has to.
 * A row of words and a tick — no segmented control, no pills, no dropdown.
 *
 * These are `aria-pressed` buttons in a labelled group rather than a
 * `radiogroup`, which would be the more literal reading of "choose one". A radio
 * group owes the user arrow-key navigation and a roving tabindex; three toggle
 * buttons owe nothing beyond being buttons, and every one stays reachable by tab.
 * The simpler mechanism is also the one that cannot be half-implemented.
 */

import type { Axis, AxisId } from "@/graph/axes.ts";

export interface AxisControlProps {
  readonly options: readonly Axis[];
  readonly active: AxisId;
  readonly onSelect: (id: AxisId) => void;
}

export function AxisControl({ options, active, onSelect }: AxisControlProps) {
  // `axesFor` guarantees at least Decade, so this is a guard, not a case.
  if (options.length === 0) return null;
  const sole = options.length === 1 ? options[0] : null;

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <span className="eiga-annotation">Axis</span>
      <span className="bg-rule h-px w-4 shrink-0" aria-hidden="true" />

      {sole ? (
        /*
          One choice is not a control, so it is not offered as one — but it used to
          answer that by deleting the question, and the map went silent about its
          own structure. A library imported from `watched.csv` alone has no dates,
          no ratings and no directors, so Decade is the only axis it can be drawn
          on: the row vanished and nothing on screen said what the clusters were.

          Stated as text instead. Not a disabled button and not a one-item group —
          there is nothing to press and nothing to choose between, and offering
          either would be a control that lies about what it can do.
        */
        <p className="eiga-annotation text-paper-mid">{sole.label}</p>
      ) : (
        <div
          role="group"
          aria-label="Group films by"
          /*
            Wraps rather than overflows. Five axes and a phone-width screen do not
            fit on one line, and the band this sits in is `overflow-hidden`, so the
            row did not scroll — the last axis was simply cut in half. `gap-3`
            already supplies the row gap, so wrapping costs no extra rule.

            `min-w-0 flex-1` is what makes it wrap *well*. Left at its automatic
            basis the group is as wide as all five labels laid end to end, which no
            narrow screen can hold — so the outer flex moved the whole group onto a
            line of its own beneath the legend, and then wrapped it again inside.
            Three lines to say five words, one of which was "Axis". Allowed to
            shrink, the group starts on the legend's line and takes two. Above `sm`
            everything fits on one line and this changes nothing.
          */
          className="flex min-w-0 flex-1 flex-wrap items-center gap-3"
        >
          {options.map((axis) => {
            const selected = axis.id === active;
            return (
              <button
                key={axis.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(axis.id)}
                /*
                  The tick under the active axis is a second, non-colour cue — the
                  citron alone would make selection legible only to people who can
                  see it. Both states carry the border so the row never reflows.
                */
                className={`eiga-annotation border-b pb-0.5 transition-colors duration-200 ${
                  selected
                    ? "text-signal border-signal"
                    : "hover:text-paper-mid border-transparent"
                }`}
              >
                {axis.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
