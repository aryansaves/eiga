"use client";

/**
 * Import affordances.
 *
 * The control is a real file input inside a label: no drag-and-drop-only dead
 * ends, no button that opens a picker by script, and the native control does the
 * work — which is also what makes it keyboard-reachable and what lets the OS
 * remember where the user keeps their downloads. The whole export `.zip` is
 * accepted alongside loose CSVs — `importLetterboxdFiles` sniffs the bytes rather
 * than trusting the extension, so the two mix freely and a user who already
 * unzipped is not punished for it.
 *
 * The report next to it exists because a silent import is untrustworthy — if
 * EIGA ignored part of your export, it says so, and says which part.
 *
 * Diagnostics are structured and content-free by construction (see
 * src/import/letterboxd.ts), so displaying every one of them cannot leak a
 * title or a review.
 *
 * Neither export sets its own text alignment. Both are used twice — in the
 * top-right corner of a loaded map, where everything is flush right, and in the
 * landing block, where everything is flush left — and a component that pinned
 * `text-right` internally would have to be told which context it was in. The
 * caller already knows, because the caller is the one that positioned it.
 *
 * `hintClassName` is the same principle applied to whether the subtitle is shown
 * at all. On the landing it always is: that screen exists to explain what to hand
 * over, and it has a full column to do it in. In the corner of a loaded map on a
 * phone the control is 78px wide in a shared row, and a five-word line under it
 * wraps to four — so the caller that put it there hides it, and the caller that
 * gave it a column does not. A boolean could not express this, because the same
 * instance needs it at one width and not at another.
 */

import type { ImportResult } from "@/import/letterboxd.ts";

/** Long reports are truncated, but never silently — the remainder is counted. */
const MAX_LISTED = 40;

export function ImportControl({
  onFiles,
  hintClassName = "",
}: {
  readonly onFiles: (files: readonly File[]) => void;
  readonly hintClassName?: string;
}) {
  return (
    <div>
      {/*
        The label wraps the button and nothing else.

        It used to wrap the subtitle as well, which made a line of explanatory text
        into a click target: reading "your export .zip" and clicking it opened a
        file picker, and the entire right-hand block behaved as one large invisible
        button with no edge to say where it began or ended. The subtitle is a
        sibling now — it says what the button takes, it is not part of pressing it.
      */}
      <label className="eiga-button">
        Upload
        <input
          type="file"
          multiple
          accept=".zip,application/zip,.csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Cleared so re-selecting the same files still fires a change.
            event.target.value = "";
            if (files.length > 0) onFiles(files);
          }}
        />
      </label>
      <p className={`eiga-annotation mt-2.5 ${hintClassName}`}>
        your export .zip · or the CSVs inside it
      </p>
    </div>
  );
}

export function ImportReport({
  result,
  onReset,
}: {
  readonly result: ImportResult;
  readonly onReset: () => void;
}) {
  const errors = result.diagnostics.filter((note) => note.severity === "error");
  const listed = result.diagnostics.slice(0, MAX_LISTED);
  const hidden = result.diagnostics.length - listed.length;

  const summary = [
    `${result.accepted.length} read`,
    result.skipped.length > 0 ? `${result.skipped.length} skipped` : null,
    // "1 problems" is the sort of thing that makes a careful tool look careless.
    errors.length > 0 ? `${errors.length} problem${errors.length === 1 ? "" : "s"}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div>
      {result.diagnostics.length > 0 ? (
        <details className="group/report">
          <summary className="eiga-annotation hover:text-paper-mid cursor-pointer list-none transition-colors">
            {summary} <span className="group-open/report:hidden">— why?</span>
          </summary>

          <ul className="border-rule mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t pt-3 text-left">
            {listed.map((note, index) => (
              <li
                key={`${note.file}-${note.row ?? "file"}-${note.field ?? "any"}-${index}`}
                className="text-xs leading-relaxed"
              >
                <span
                  className={
                    note.severity === "error" ? "text-signal" : "text-paper-dim"
                  }
                >
                  {note.file || "selection"}
                  {note.row !== null && ` · row ${note.row}`}
                  {note.field !== null && ` · ${note.field}`}
                </span>
                <span className="text-paper-dim"> — {note.message}</span>
              </li>
            ))}
            {hidden > 0 && (
              <li className="eiga-annotation">and {hidden} more not shown</li>
            )}
          </ul>
        </details>
      ) : (
        <p className="eiga-annotation">{summary}</p>
      )}

      {/*
        "Start over", not "Show the demo again". It used to mean the latter
        because the demo was what the app fell back to, so clearing an import
        landed you on someone else's map. The fallback is now an empty canvas and
        the front door, which is a different act and needs a different word — and
        this is the only way back to that door once a library is loaded.
      */}
      <button type="button" onClick={onReset} className="eiga-button mt-3">
        Start over
      </button>
    </div>
  );
}
