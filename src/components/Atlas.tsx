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

import { useCallback, useMemo, useState } from "react";

import { GraphView } from "@/components/GraphView.tsx";
import { ImportControl, ImportReport } from "@/components/ImportControl.tsx";
import { Inspector } from "@/components/Inspector.tsx";
import { demoLibrary } from "@/domain/demo.ts";
import { observe } from "@/domain/stats.ts";
import { buildGraph, byDecade, byDirector } from "@/graph/build.ts";
import { importLetterboxdFiles, type ImportResult } from "@/import/letterboxd.ts";

export function Atlas() {
  const demo = useMemo(() => demoLibrary(), []);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  /*
    An import that produced nothing usable leaves the demo on screen rather than
    replacing a working map with an empty one. The report explains why.
  */
  const usable = imported !== null && imported.library.films.length > 0;
  const library = usable && imported ? imported.library : demo;

  /*
    A Letterboxd export contains no director credits, so real libraries are
    grouped by decade. The demo is the only dataset with directors, which is
    what makes it the demonstration that the strategy is interchangeable.
  */
  const graph = useMemo(
    () => buildGraph(library, usable ? byDecade : byDirector),
    [library, usable],
  );
  const observation = useMemo(() => observe(library), [library]);

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
  const hubWord = graph.hubKind === "decade" ? "decade" : "director";

  const status = [
    `${films} films`,
    `${hubs} ${hubs === 1 ? hubWord : `${hubWord}s`}`,
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
        <GraphView graph={graph} focusedId={focusedId} onFocus={setFocusedId} />
      </div>

      <div className="from-void via-void/85 pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-8 bg-linear-to-b to-transparent px-7 pt-7 pb-20 sm:px-12">
        <div>
          <p className="eiga-mark text-paper text-sm">EIGA</p>
          <p className="eiga-annotation mt-2">Your cinema, mapped.</p>
        </div>
        <div className="pointer-events-auto">
          <ImportControl onFiles={load} />
        </div>
      </div>

      <div className="from-void via-void/85 pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-8 bg-linear-to-t to-transparent px-7 pt-20 pb-7 sm:px-12">
        <div className="pointer-events-auto">
          <Inspector
            graph={graph}
            library={library}
            focusedId={focusedId}
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
        <div className="border-tungsten/30 pointer-events-none absolute inset-5 flex items-center justify-center border">
          <p className="eiga-mark text-tungsten text-xs">Release to read</p>
        </div>
      )}
    </main>
  );
}
