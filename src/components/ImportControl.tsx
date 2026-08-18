"use client";

/**
 * Import affordances.
 *
 * The control is a label wrapping a real file input: no drag-and-drop-only
 * dead ends, no fake button, and the native picker does the work. The whole
 * export `.zip` is accepted alongside loose CSVs — `importLetterboxdFiles`
 * sniffs the bytes rather than trusting the extension, so the two mix freely and
 * a user who already unzipped is not punished for it.
 *
 * The report next to it exists because a silent import is untrustworthy — if
 * EIGA ignored part of your export, it says so, and says which part.
 *
 * Diagnostics are structured and content-free by construction (see
 * src/import/letterboxd.ts), so displaying every one of them cannot leak a
 * title or a review.
 */

import type { ImportResult } from "@/import/letterboxd.ts";

/** Long reports are truncated, but never silently — the remainder is counted. */
const MAX_LISTED = 40;

export function ImportControl({
  onFiles,
}: {
  readonly onFiles: (files: readonly File[]) => void;
}) {
  return (
    <label className="group focus-within:outline-signal block cursor-pointer text-right focus-within:outline-1 focus-within:outline-offset-8">
      <span className="eiga-mark text-paper group-hover:text-signal text-xs transition-colors">
        Map mine
      </span>
      <span className="eiga-annotation mt-1.5 block">
        your export .zip · or the CSVs inside it
      </span>
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
    errors.length > 0 ? `${errors.length} problems` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div className="text-right">
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

      <button
        type="button"
        onClick={onReset}
        className="eiga-annotation hover:text-paper-mid mt-3 transition-colors"
      >
        Show the demo again
      </button>
    </div>
  );
}
