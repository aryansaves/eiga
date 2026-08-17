"use client";

/**
 * The atlas — EIGA's one screen.
 *
 * The map is full-bleed and everything else is a caption over it: a wordmark, an
 * import affordance, a museum label. Nothing is a card, nothing is a rail, and
 * no chrome exists that does not answer a question the user is currently asking.
 *
 * All state lives here: which library is loaded, and what is focused. The graph
 * layer below is a pure function of the library, so switching between the demo
 * and a real import is a single state change and nothing needs to be reset by
 * hand.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { AxisControl } from "@/components/AxisControl.tsx";
import { GraphView } from "@/components/GraphView.tsx";
import { ImportControl, ImportReport } from "@/components/ImportControl.tsx";
import { Inspector } from "@/components/Inspector.tsx";
import { SearchControl } from "@/components/SearchControl.tsx";
import { demoLibrary } from "@/domain/demo.ts";
import { searchFilms } from "@/domain/search.ts";
import { observe } from "@/domain/stats.ts";
import { axesFor, resolveAxis, type AxisId } from "@/graph/axes.ts";
import { buildGraph } from "@/graph/build.ts";
import { download, exportMapPng } from "@/viz/exportImage.ts";
import { importLetterboxdFiles, type ImportResult } from "@/import/letterboxd.ts";

/** Whether a save is idle, in flight, or has just failed. */
type SaveState = "idle" | "working" | "failed";

export function Atlas() {
  const demo = useMemo(() => demoLibrary(), []);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [axis, setAxis] = useState<AxisId>("decade");
  const [query, setQuery] = useState("");
  const [dropping, setDropping] = useState(false);
  const [saving, setSaving] = useState<SaveState>("idle");
  /** The drawn map, handed up by GraphView so it can be exported as it appears. */
  const surfaceRef = useRef<SVGSVGElement | null>(null);

  /*
    An import that produced nothing usable leaves the demo on screen rather than
    replacing a working map with an empty one. The report explains why.
  */
  const usable = imported !== null && imported.library.films.length > 0;
  const library = usable && imported ? imported.library : demo;

  /*
    Which axes this library can be drawn on, and which of them is actually in
    use. Both derived rather than stored: swapping the demo for a real import can
    take the chosen axis away — a Letterboxd export has no director credits — and
    deriving the answer means there is never a render where the control and the
    map disagree about what is being shown.
  */
  const options = useMemo(() => axesFor(library), [library]);
  const active = useMemo(() => resolveAxis(library, axis), [library, axis]);

  const graph = useMemo(() => buildGraph(library, active.strategy), [library, active]);
  /*
    The observation follows the axis: the same set of facts, but the one that
    speaks to what is on screen is preferred. Nothing new becomes sayable, so
    switching axes cannot make EIGA assert something it would not otherwise.
  */
  const observation = useMemo(() => observe(library, active.id), [library, active]);

  /*
    Selection is derived too, because hubs belong to an axis. Re-sorting the map
    by rating deletes the "1990s" node, and a focus pointing at a node that is no
    longer there would dim every remaining node to 12% with nothing lit. Films
    keep their id across axes, so a selected film survives the switch and can be
    watched travelling to its new place.
  */
  const focused = useMemo(
    () => (focusedId && graph.nodes.some((node) => node.id === focusedId) ? focusedId : null),
    [graph, focusedId],
  );

  /*
    Searched over the library rather than the graph: the answer is about films,
    and films are the one thing that survives every axis. Recomputed on each
    keystroke, which is a folded substring test over a few hundred titles — a
    debounce would add a state machine to save nothing measurable.
  */
  const matches = useMemo(() => searchFilms(library.films, query), [library, query]);

  const load = useCallback(async (files: readonly File[]) => {
    const result = await importLetterboxdFiles([...files]);
    setImported(result);
    setFocusedId(null);
  }, []);

  const reset = useCallback(() => {
    setImported(null);
    setFocusedId(null);
  }, []);

  const hubs = graph.nodes.filter((node) => node.kind === "hub").length;
  const films = graph.nodes.length - hubs;

  /*
    The caption is composed here rather than inside the exporter, because what
    the map is *of* is knowledge this component has and the canvas should not.
    Nothing crosses the network: the blob goes straight to the user's downloads.
  */
  const save = useCallback(async () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    setSaving("working");
    try {
      const blob = await exportMapPng(surface, {
        caption: `EIGA · ${active.label} · ${films} films`,
      });
      download(blob, `eiga-${active.id}.png`);
      setSaving("idle");
    } catch {
      /*
        Swallowed on purpose: the reason is a canvas or codec failure, and the
        message would name nothing the user can act on. The label saying so is
        the whole report — and an import must never reach a log.
      */
      setSaving("failed");
    }
  }, [active, films]);

  const status = [
    `${films} films`,
    // Every axis names its own hubs, and every one of those names takes a plain s.
    `${hubs} ${hubs === 1 ? graph.hubKind : `${graph.hubKind}s`}`,
    usable ? "your library" : "demo library",
  ].join(" · ");

  return (
    <main
      className="relative flex-1 overflow-hidden"
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // Ignore the leave events fired while crossing between children.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) void load(files);
      }}
    >
      <div className="absolute inset-0">
        <GraphView
          graph={graph}
          focusedId={focused}
          onFocus={setFocusedId}
          matches={matches}
          surfaceRef={surfaceRef}
        />
      </div>

      <div className="from-void via-void/85 pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-8 bg-linear-to-b to-transparent px-7 pt-7 pb-20 sm:px-12">
        <div>
          <p className="eiga-mark text-paper text-sm">EIGA</p>
          <p className="eiga-annotation mt-2">Your cinema, mapped.</p>
          <div className="pointer-events-auto">
            <AxisControl options={options} active={active.id} onSelect={setAxis} />
            <SearchControl query={query} onQuery={setQuery} found={matches?.size ?? null} />
          </div>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-4">
          <ImportControl onFiles={load} />
          {/*
            Quieter than the import: an annotation rather than a mark, because
            saving is something you do after the map has told you something, not
            the reason you came. Its label doubles as the only status report.
          */}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving === "working"}
            className="eiga-annotation hover:text-paper-mid focus-visible:outline-signal transition-colors focus-visible:outline-1 focus-visible:outline-offset-4"
          >
            {saving === "working"
              ? "Saving…"
              : saving === "failed"
                ? "Could not save — try again"
                : "Save this map"}
          </button>
        </div>
      </div>

      <div className="from-void via-void/85 pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-8 bg-linear-to-t to-transparent px-7 pt-20 pb-7 sm:px-12">
        <div className="pointer-events-auto">
          <Inspector
            graph={graph}
            library={library}
            focusedId={focused}
            onFocus={setFocusedId}
            observation={observation}
          />
        </div>

        <div className="pointer-events-auto shrink-0 text-right">
          <p className="eiga-annotation">{status}</p>
          <p className="eiga-annotation mt-1.5">Nothing leaves this browser</p>
          {imported && (
            <div className="mt-4">
              <ImportReport result={imported} onReset={reset} />
            </div>
          )}
        </div>
      </div>

      {dropping && (
        <div className="border-signal/30 pointer-events-none absolute inset-5 flex items-center justify-center border">
          <p className="eiga-mark text-signal text-xs">Release to read</p>
        </div>
      )}
    </main>
  );
}
