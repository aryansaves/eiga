"use client";

/**
 * The search field.
 *
 * A rule with words on it — no box, no icon, no rounded input. It sits under the
 * axis row because the two are the same kind of act: the axis decides what the
 * map means, the search decides what you are looking for in it, and neither is a
 * setting worth a panel.
 *
 * Searching dims rather than filters, so the field has to say what it found. A
 * map at 8% opacity with nothing lit is indistinguishable from a broken one, and
 * "no films" is the sentence that tells you it is working and you are wrong.
 */

export interface SearchControlProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** How many films matched, or null when not searching. */
  readonly found: number | null;
}

export function SearchControl({ query, onQuery, found }: SearchControlProps) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <label className="eiga-annotation" htmlFor="eiga-search">
        Find
      </label>
      <span className="bg-rule h-px w-4 shrink-0" aria-hidden="true" />

      <input
        id="eiga-search"
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        // Escape clears without reaching for the mouse, matching the graph's own
        // click-away-to-release. The browser's own search reset does the same.
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onQuery("");
        }}
        placeholder="Title"
        autoComplete="off"
        spellCheck={false}
        className="eiga-annotation text-paper placeholder:text-paper-dim/60 border-rule focus:border-signal w-36 border-b bg-transparent pb-0.5 outline-hidden transition-colors duration-200"
      />

      {/*
        Announced politely rather than left as decoration: the count is the only
        feedback a search gives, and it must reach someone who cannot see the map
        dim. Empty while idle, so it says nothing until there is something to say.
      */}
      <span role="status" aria-live="polite" className="eiga-annotation text-signal">
        {found === null ? "" : found === 1 ? "1 film" : `${found} films`}
      </span>
    </div>
  );
}
