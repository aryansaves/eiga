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
  // A control with one choice is not a control. Nothing to offer, so nothing drawn.
  if (options.length < 2) return null;

  return (
    <div className="mt-5 flex items-center gap-3">
      <span className="eiga-annotation">Axis</span>
      <span className="bg-rule h-px w-4 shrink-0" aria-hidden="true" />

      <div role="group" aria-label="Group films by" className="flex items-center gap-3">
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
    </div>
  );
}
