"use client";

/**
 * The front door.
 *
 * EIGA used to open onto the demo library, which meant the first thing a visitor
 * saw was a finished map of somebody else's taste. That is a good advertisement
 * and a bad invitation: the promise is *your* cinema, and answering it with
 * thirty-seven films nobody in the room has watched puts the product one step
 * further from the thing it exists to do. So the map starts empty and the visitor
 * fills it.
 *
 * An empty map is a real risk, though — a blank screen with a button on it is how
 * most tools waste a first visit — so the emptiness is doing work here. The
 * graticule is already drawn behind this block, which is what makes the surface
 * read as an atlas waiting for its subject rather than as a page that failed to
 * load. There is no illustration, no placeholder chart and no fake data: the only
 * marks on screen are the grid and this column of type.
 *
 * Composed as a column on the left rather than a centred hero, because a centred
 * block would be a card in all but name and the brief asks for asymmetry. It sits
 * in the same left gutter as the loaded map's chrome, so the wordmark stays put
 * horizontally when the map arrives and only changes size.
 *
 * The order of the block is the order of the visitor's objections: what is this,
 * what will it cost me, what do I hand over, and — for anyone who has no export
 * to hand — is there anything to look at. The privacy line comes *before* the
 * upload deliberately. It is the question that has to be answered before someone
 * gives up a file, not after.
 */

import { ImportControl, ImportReport } from "@/components/ImportControl.tsx";
import type { ImportResult } from "@/import/letterboxd.ts";

export interface LandingProps {
  readonly onFiles: (files: readonly File[]) => void;
  /** Switches to the authored demo, for a visitor with no export to hand. */
  readonly onDemo: () => void;
  /**
   * The last import, when it produced nothing usable.
   *
   * Shown here rather than in the corner it occupies on a loaded map: an import
   * that failed leaves the visitor exactly where they were, and the explanation
   * belongs next to the control they are about to try again rather than diagonally
   * across an empty screen from it.
   */
  readonly report: ImportResult | null;
  readonly onReset: () => void;
}

export function Landing({ onFiles, onDemo, report, onReset }: LandingProps) {
  return (
    /*
      The wash is the same device the loaded map uses behind its top and bottom
      chrome, turned on its side to match a column instead of a band. It matters
      more here than there: on a loaded map the graticule sits under a graph and
      recedes, but on an empty one it is the only thing drawn, and at full strength
      it runs its 64px lines straight through the paragraphs. Fading it out to the
      right leaves the prose on near-solid graphite, keeps the grid visible where
      there is nothing to read, and gives the empty surface some depth.
    */
    <div className="from-void via-void/85 pointer-events-none absolute inset-0 flex items-center bg-linear-to-r to-transparent px-7 sm:px-12">
      <div className="pointer-events-auto max-w-xl">
        <h1 className="eiga-mark text-paper text-2xl sm:text-3xl">EIGA</h1>
        <p className="eiga-annotation mt-4">Your cinema, mapped.</p>

        <p className="font-display text-paper mt-9 text-xl leading-snug text-balance sm:text-2xl">
          Your Letterboxd export becomes a map: every film you have seen, placed on
          the day you saw it — and redrawn by decade, by rating, by the year you
          watched it.
        </p>

        {/*
          Lower case and in the body face, unlike every other annotation in the
          app. The uppercase mono treatment is for labels on an instrument, and
          this is a sentence making a promise — set as a label it would read as
          fine print, which is the opposite of what it is for.
        */}
        <p className="text-paper-mid mt-6 text-sm leading-relaxed">
          Read here, in this browser. Nothing is uploaded, there is no account, and
          closing the tab is the delete button.
        </p>

        <div className="mt-9">
          <ImportControl onFiles={onFiles} />
        </div>

        {report && (
          <div className="border-rule mt-6 border-t pt-5">
            <ImportReport result={report} onReset={onReset} />
          </div>
        )}

        {/*
          A link, not a second box. Looking at the demo and importing a library are
          not two equal choices — one is the reason the page exists and the other
          is a courtesy for someone who has not exported yet — and two hairline
          boxes side by side would say they were. The rule under it goes citron on
          hover, which is the same hairline-to-accent move the buttons make, so it
          still reads as part of the same set of controls.

          Underlined in `paper-dim` rather than in `rule` like every other hairline
          in the app. `--color-rule` is a mark on the map and is meant to be nearly
          invisible against the void — which is right for a graticule and wrong for
          the one thing on this screen that has to look pressable. Matching the
          text's own colour makes it an underlined word instead of a word with a
          faint smudge beneath it.
        */}
        <p className="mt-10">
          <button
            type="button"
            onClick={onDemo}
            className="eiga-annotation border-paper-dim hover:text-paper-mid hover:border-signal border-b pb-0.5 transition-colors duration-200"
          >
            Or see a demo library
          </button>
        </p>
      </div>
    </div>
  );
}
