"use client";

/**
 * The highlight control.
 *
 * A row of words under the search field, mirroring `AxisControl` — same
 * annotation label, same rule, same underline for the active state — because from
 * the user's side these are the same *kind* of act as choosing an axis. What
 * differs is arity: an axis is one of several, a highlight is any of several, and
 * the only thing that says so is that more than one can be underlined at once.
 *
 * Deliberately not a dropdown, not pills, not a segmented control. Two toggles do
 * not earn a menu, and a boxed row here would read as a form field on a map.
 *
 * Each chip carries its count. That is what makes the control explain itself
 * without a legend: "Liked 27" says both what the highlight means and how much of
 * your library it is about to light, so pressing it is never a guess. The count
 * comes from the same set the map lights, so the two cannot disagree.
 *
 * Renders nothing when the library has nothing to highlight — a demo or a thin
 * import shows fewer chips rather than dead ones.
 */

import type { FilterId, FilterOption } from "@/domain/filters.ts";

export interface FilterControlProps {
  readonly options: readonly FilterOption[];
  readonly active: readonly FilterId[];
  readonly onToggle: (id: FilterId) => void;
}

export function FilterControl({ options, active, onToggle }: FilterControlProps) {
  if (options.length === 0) return null;

  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="eiga-annotation">Highlight</span>
      <span className="bg-rule h-px w-4 shrink-0" aria-hidden="true" />

      <div role="group" aria-label="Highlight films that are" className="flex items-center gap-3">
        {options.map((option) => {
          const on = active.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(option.id)}
              className={`eiga-annotation border-b pb-0.5 transition-colors duration-200 ${
                on ? "text-signal border-signal" : "hover:text-paper-mid border-transparent"
              }`}
            >
              {/*
                The count is inside the button's accessible name rather than
                beside it, because "Liked, 27 films" is the whole label — a
                separate node would announce the number as unrelated text.
              */}
              {option.label} {option.films.size}
            </button>
          );
        })}
      </div>
    </div>
  );
}
