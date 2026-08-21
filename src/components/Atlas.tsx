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
 *
 * There are three libraries it can be showing, not two — nothing, the demo, or
 * yours — and the first of those is the one a visitor arrives on. See `NOTHING`
 * and `landing` below.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { AxisControl } from "@/components/AxisControl.tsx";
import { FilterControl } from "@/components/FilterControl.tsx";
import { GraphView } from "@/components/GraphView.tsx";
import { ImportControl, ImportReport } from "@/components/ImportControl.tsx";
import { Inspector } from "@/components/Inspector.tsx";
import { Landing } from "@/components/Landing.tsx";
import { SearchControl } from "@/components/SearchControl.tsx";
import { demoLibrary } from "@/domain/demo.ts";
import { filtersFor, narrow, type FilterId } from "@/domain/filters.ts";
import { searchFilms } from "@/domain/search.ts";
import { observe } from "@/domain/stats.ts";
import { emptyLibrary } from "@/domain/types.ts";
import { axesFor, resolveAxis, type AxisId } from "@/graph/axes.ts";
import { buildGraph, groupCount } from "@/graph/build.ts";
import { buildThread, unplaced } from "@/graph/thread.ts";
import { buildTree } from "@/graph/tree.ts";
import { download, exportMapPng } from "@/viz/exportImage.ts";
import { importLetterboxdFiles, type ImportResult } from "@/import/letterboxd.ts";

/** Whether a save is idle, in flight, or has just failed. */
type SaveState = "idle" | "working" | "failed";

/**
 * The library before there is one.
 *
 * Module-level rather than built per render, and that is load-bearing: every memo
 * below keys on `library` by identity, so a fresh `emptyLibrary()` each render
 * would rebuild the graph, the statistics and the filters on every keystroke the
 * landing sees. One frozen-by-type instance costs nothing and changes never.
 *
 * Its whole point is that the derivation layer needs no empty case. `axesFor`
 * answers Decade, `buildThread` answers an empty graph, `observe` answers null,
 * `fitToFrame` answers the identity transform — the pipeline runs unchanged and
 * produces nothing, which is exactly right, because nothing is what there is.
 */
const NOTHING = emptyLibrary();

export function Atlas() {
  const demo = useMemo(() => demoLibrary(), []);
  const [imported, setImported] = useState<ImportResult | null>(null);
  /**
   * Whether the visitor asked to see the demo.
   *
   * A separate flag rather than a third value folded into `imported`, because the
   * two answer different questions and can both be true: an import that failed
   * while the demo was on screen has to leave the demo up *and* show the report.
   */
  const [demoAsked, setDemoAsked] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /*
    The diary thread, which `axesFor` puts first. Held as an id rather than
    resolved here so that a library with no dates — an import of `watched.csv`
    alone — falls through `resolveAxis` to Decade without this line knowing.
  */
  const [axis, setAxis] = useState<AxisId>("diary");
  const [query, setQuery] = useState("");
  /*
    Highlights, unlike the axis, are a set: they union rather than replace. Held
    as ids and resolved by `narrow`, so a chip pressed on one library and taken
    away by the next import simply stops applying instead of dimming everything.
  */
  const [highlights, setHighlights] = useState<readonly FilterId[]>([]);
  const [dropping, setDropping] = useState(false);
  const [saving, setSaving] = useState<SaveState>("idle");
  /** The drawn map, handed up by GraphView so it can be exported as it appears. */
  const surfaceRef = useRef<SVGSVGElement | null>(null);

  /*
    Which of the three libraries is on screen.

    An import that produced nothing usable falls back rather than replacing a
    working map with an empty one — to the demo if that is where the user was, and
    otherwise to nothing at all. Either way the report explains why, so a failed
    import never silently looks like an empty library.
  */
  const usable = imported !== null && imported.library.films.length > 0;
  const library = usable && imported ? imported.library : demoAsked ? demo : NOTHING;
  /*
    The front door: no library of either kind. Not derived from `library === NOTHING`
    but from the same two facts that chose it, so the branch cannot drift from the
    choice. Everything the loaded map draws is suppressed here — there is no axis to
    pick, nothing to search, nothing to inspect and nothing to save — and the
    surface shows its graticule and nothing else.
  */
  const landing = !usable && !demoAsked;

  /*
    Which axes this library can be drawn on, and which of them is actually in
    use. Both derived rather than stored: swapping the demo for a real import can
    take the chosen axis away — a Letterboxd export has no director credits — and
    deriving the answer means there is never a render where the control and the
    map disagree about what is being shown.
  */
  const options = useMemo(() => axesFor(library), [library]);
  const active = useMemo(() => resolveAxis(library, axis), [library, axis]);

  /*
    The one place the three topologies diverge, and the whole reason a new one is
    cheap to add. A thread, a tree and a hub map are the same `Graph` to everything
    downstream — same node ids, so a film keeps its identity across a switch and can
    be watched travelling from its place on the calendar into its decade cluster and
    back.
  */
  const graph = useMemo(() => {
    if (active.kind === "thread") return buildThread(library);
    if (active.kind === "tree") return buildTree(library);
    return buildGraph(library, active.strategy);
  }, [library, active]);
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

    `lit` is the one answer the map is drawn from; `found` is the search's own
    count, which the field reports separately because "3 films" has to mean the
    query even while a highlight is narrowing it further.
  */
  const filters = useMemo(() => filtersFor(library), [library]);
  const lit = useMemo(() => narrow(library, highlights, query), [library, highlights, query]);
  const found = useMemo(() => searchFilms(library.films, query), [library, query]);

  const toggleHighlight = useCallback((id: FilterId) => {
    setHighlights((current) =>
      current.includes(id) ? current.filter((held) => held !== id) : [...current, id],
    );
  }, []);

  const load = useCallback(async (files: readonly File[]) => {
    const result = await importLetterboxdFiles([...files]);
    setImported(result);
    setFocusedId(null);
  }, []);

  /*
    Back to the front door. Clears the demo as well as the import: it is reached
    from the report, and the report is only ever shown over a library the user
    chose, so "start over" has to undo both choices or it would strand someone on
    the demo with no way back to the door they came in through.
  */
  const reset = useCallback(() => {
    setImported(null);
    setDemoAsked(false);
    setFocusedId(null);
  }, []);

  const films = graph.nodes.filter((node) => node.kind === "film").length;
  /*
    Hubs on a hub map, distinct watch days on the thread — `groupCount` knows
    which, so the status line does not have to branch and cannot disagree with
    the map about what it is showing.
  */
  const groups = groupCount(graph);
  /*
    Films the map could not place. Named rather than left to be noticed: a scattered
    band below the graticule is otherwise indistinguishable from a rendering fault,
    and silently dropping them would understate the library.

    The word changes with the shape because the reason does. A thread parks a film
    only when it has no readable watch date, so "undated" is exact there; a tree also
    parks one that has no release year, and calling *that* film undated would be a
    small lie about a library the user knows better than the map does.
  */
  const parked = graph.shape === "hubs" ? 0 : unplaced(graph).length;
  const parkedWord = graph.shape === "thread" ? "undated" : "unplaced";

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
    // Every grouping names its own unit — hub, day, branch point — plain s on each.
    `${groups} ${groups === 1 ? graph.groupKind : `${graph.groupKind}s`}`,
    ...(parked > 0 ? [`${parked} ${parkedWord}`] : []),
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
      {/*
        The surface. On the front door there is no map to draw, so the graticule is
        rendered on its own rather than as an empty `GraphView`: a map of zero films
        would still announce itself to a screen reader as "Map of 0 films across 0
        hub groups", and starting a force simulation in order to place nothing is
        work that comes with a description worse than no description at all.
      */}
      {landing ? (
        <div className="eiga-grid absolute inset-0" />
      ) : (
        <div className="absolute inset-0">
          <GraphView
            graph={graph}
            focusedId={focused}
            onFocus={setFocusedId}
            lit={lit}
            /*
              The search's own answer, not `lit`. A query names a film, so the view
              can travel to it; a highlight chip lights a third of the library, which
              has nowhere to travel. `GraphView.travel` explains why the two are
              separate props rather than one.
            */
            travel={found}
            surfaceRef={surfaceRef}
          />
        </div>
      )}

      {landing ? (
        <Landing
          onFiles={load}
          onDemo={() => setDemoAsked(true)}
          report={imported}
          onReset={reset}
        />
      ) : (
        <>
          {/*
            Both bands wrap. `justify-between` holds the two columns apart at any
            width that fits them, but below roughly 520px they stopped fitting and
            the band is `overflow-hidden`, so the right-hand column was not merely
            cramped — on a 375px screen it sat 130px past the edge, which put the
            import control, the save control and the way back out of the demo all
            off the display at once. Wrapping is a no-op above that width and the
            difference between cramped and unreachable below it.

            This is a safety fix, not a phone layout. What an atlas should do with a
            screen too narrow to hold both the map and its instruments is a design
            question, and guessing at it here would answer it badly.
          */}
          <div className="from-void via-void/85 pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-8 bg-linear-to-b to-transparent px-7 pt-7 pb-20 sm:px-12">
            <div>
              {/*
                The same heading the landing carries, at caption size. An `h1` in
                both states rather than a `p` here and an `h1` there: the inspector
                below renders the focused film's title as an `h2`, which needs
                something above it, and two states of one page disagreeing about
                their outline is the kind of thing only a screen reader ever sees.
              */}
              <h1 className="eiga-mark text-paper text-sm">EIGA</h1>
              <p className="eiga-annotation mt-2">Your cinema, mapped.</p>
              <div className="pointer-events-auto">
                <AxisControl options={options} active={active.id} onSelect={setAxis} />
                <SearchControl query={query} onQuery={setQuery} found={found?.size ?? null} />
                <FilterControl
                  options={filters}
                  active={highlights}
                  onToggle={toggleHighlight}
                />
              </div>
            </div>
            <div className="pointer-events-auto flex flex-col items-end gap-4 text-right">
              <ImportControl onFiles={load} />
              {/*
                The same hairline box as the import, and no quieter. It was an
                unadorned line of annotation text on the grounds that saving is
                something you do after the map has told you something rather than the
                reason you came — but that reasoning ranked two *acts* by their
                importance, and the thing a control has to communicate first is that it
                is a control at all. Hierarchy is carried by order and by the subtitle
                under the import instead, which is where it costs nothing.

                Its label still doubles as the only status report; the box simply grows
                to hold it.
              */}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving === "working"}
                className="eiga-button"
              >
                {saving === "working"
                  ? "Saving…"
                  : saving === "failed"
                    ? "Could not save — try again"
                    : "Save this map"}
              </button>
            </div>
          </div>

          <div className="from-void via-void/85 pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-8 bg-linear-to-t to-transparent px-7 pt-20 pb-7 sm:px-12">
            <div className="pointer-events-auto">
              <Inspector
                graph={graph}
                library={library}
                focusedId={focused}
                onFocus={setFocusedId}
                observation={observation}
              />
            </div>

            {/*
              Allowed to shrink. It was `shrink-0` so the status line would never
              wrap mid-phrase, but refusing to shrink is how it left the viewport
              entirely — a wrapped status line is legible and an absent one is not.
            */}
            <div className="pointer-events-auto text-right">
              <p className="eiga-annotation">{status}</p>
              <p className="eiga-annotation mt-1.5">Nothing leaves this browser</p>
              {/*
                One corner answers "how do I get out of this library", in both
                senses of it. After an import that is the report, which carries its
                own way back; on the demo there is no report to carry one, and
                without this the front door became unreachable the moment the
                landing stopped being a state you could return to by clearing an
                import. A visitor who came to look at the demo was stranded on
                someone else's map.

                Worded differently on purpose. "Start over" discards a library you
                built and is worth reading twice; leaving the demo discards nothing
                and should not be dressed up as though it might.
              */}
              {imported ? (
                <div className="mt-4">
                  <ImportReport result={imported} onReset={reset} />
                </div>
              ) : (
                <button type="button" onClick={reset} className="eiga-button mt-4">
                  Leave the demo
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {dropping && (
        <div className="border-signal/30 pointer-events-none absolute inset-5 flex items-center justify-center border">
          <p className="eiga-mark text-signal text-xs">Release to read</p>
        </div>
      )}
    </main>
  );
}
