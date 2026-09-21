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
import Link from "next/link";

import { AxisControl } from "@/components/AxisControl.tsx";
import { FilterControl } from "@/components/FilterControl.tsx";
import { GraphView } from "@/components/GraphView.tsx";
import { ImportControl, ImportReport } from "@/components/ImportControl.tsx";
import { Inspector } from "@/components/Inspector.tsx";
import { Landing } from "@/components/Landing.tsx";
import { SearchControl } from "@/components/SearchControl.tsx";
import { ThemeControl } from "@/components/ThemeControl.tsx";
import { demoLibrary } from "@/domain/demo.ts";
import { filtersFor, narrow, type FilterId } from "@/domain/filters.ts";
import { searchFilms } from "@/domain/search.ts";
import { observe } from "@/domain/stats.ts";
import { emptyLibrary } from "@/domain/types.ts";
import { axesFor, resolveAxis, type AxisId } from "@/graph/axes.ts";
import { buildGraph, groupCount } from "@/graph/build.ts";
import { buildThread, journeyObservation, unthreaded } from "@/graph/thread.ts";
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
    A journey and a hub map share the Graph interface. The earliest stop keeps
    the canonical film node id; later viewings link back through filmId.
  */
  const graph = useMemo(
    () => (active.kind === "thread" ? buildThread(library) : buildGraph(library, active.strategy)),
    [library, active],
  );
  /*
    The observation follows the axis: the same set of facts, but the one that
    speaks to what is on screen is preferred. Nothing new becomes sayable, so
    switching axes cannot make EIGA assert something it would not otherwise.
  */
  const observation = useMemo(
    () => active.kind === "thread" ? journeyObservation(graph) : observe(library, active.id),
    [library, active, graph],
  );

  /*
    Selection is derived too, because hubs belong to an axis. Re-sorting the map
    by rating deletes the "1990s" node, and a focus pointing at a node that is no
    longer there would dim every remaining node to 12% with nothing lit. Films
    keep their id across axes, so a selected film survives the switch and can be
    watched travelling to its new place.
  */
  const focused = useMemo(() => {
    if (!focusedId) return null;
    if (graph.nodes.some((node) => node.id === focusedId)) return focusedId;
    // A rewatch stop becomes its film when switching to an attribute map.
    const film = library.films.find((entry) => focusedId.startsWith(`viewing:${entry.id}:`));
    return film ? graph.nodes.find((node) => node.filmId === film.id)?.id ?? null : null;
  }, [graph, focusedId, library]);

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

  const films = library.films.length;
  /*
    Hubs on a hub map, dated viewing stops on the journey — `groupCount` knows
    which, so the status line does not have to branch and cannot disagree with
    the map about what it is showing.
  */
  const groups = groupCount(graph);
  /*
    Films the thread could not place. Named rather than left to be noticed: the
    scattered band outside the last turn is otherwise indistinguishable from a
    rendering fault, and silently dropping them would understate the library.
  */
  const undated = graph.shape === "thread" ? unthreaded(graph).length : 0;

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
    // Every grouping names its own unit — hub, day — and each takes a plain s.
    `${groups} ${groups === 1 ? graph.groupKind : `${graph.groupKind}s`}`,
    ...(undated > 0 ? [`${undated} undated`] : []),
    usable ? "your library" : "demo library",
  ].join(" · ");

  return (
    <main
      /*
        Two compositions of one tree.

        Above `sm` the map is the page and the chrome is a caption over it: the
        surface is `absolute inset-0`, the two bands float on top of it and fade
        into it, and nothing has an edge. That is the composition the brief asks
        for, and it needs room in order to be true — a caption over a map has to
        leave the map visible underneath.

        On a phone there is no such room, and pretending otherwise did not degrade
        gracefully, it just lied. Measured at 375×812: the top band stood 475px
        tall and the bottom 330px, which left eight pixels of map between them and
        put the save control directly on top of the timeline. Both bands also
        carry 80px of padding whose only job is to give the gradient somewhere to
        fade, which on a phone is a tenth of the screen spent on a fade.

        So below `sm` the same three children stop overlapping and become a flow
        column — header, map, footer — the fade padding collapses to real
        spacing, and the bands take a hairline edge because a band in flow has one
        whether it is drawn or not. The map gets what is left, which is a little
        under half the screen. Nothing overlaps because nothing is positioned.
      */
      className="relative flex flex-1 flex-col overflow-hidden sm:block"
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
      {landing ? (
        /*
          The front door. On the landing there is no map to draw, so the graticule
          is rendered on its own rather than as an empty `GraphView`: a map of zero
          films would still announce itself to a screen reader as "Map of 0 films
          across 0 hub groups", and starting a force simulation in order to place
          nothing is work that comes with a description worse than no description
          at all.

          Both children are absolutely positioned, so the flow column above has no
          in-flow content here and `flex-1` resolves to the whole free space —
          which is what keeps this state one full-bleed screen at every width.
        */
        <>
          <div className="eiga-grid absolute inset-0" />
          <div className="absolute top-7 right-7 z-20 sm:right-12">
            <ThemeControl />
          </div>
          <Landing
            onFiles={load}
            onDemo={() => setDemoAsked(true)}
            report={imported}
            onReset={reset}
          />
        </>
      ) : (
        <>
          {/*
            The instruments.

            A two-column grid at both widths, which is the one arrangement that
            reads correctly at each without moving anything in the DOM: the free
            column takes the identity and the controls, the hugging column takes
            the acts. Above `sm` the acts span both rows and sit in the top-right
            corner, exactly as they did when this was a `justify-between` flex row.
            Below `sm` they sit beside the wordmark on the first line and the
            controls span the full width underneath.

            That last part is the whole reason for the grid. As a wrapping flex row
            the right-hand column dropped *below* the left one on a narrow screen,
            which is what turned 200px of chrome into 475px and pushed the save
            control onto the map.

            No `gap-y`: `AxisControl` opens with `mt-5` and the search and
            highlight rows with `mt-3`, so the vertical rhythm is already stated
            once, in the controls themselves.
          */}
          <div className="from-void via-void/85 border-rule pointer-events-none relative z-10 grid shrink-0 grid-cols-[1fr_auto] gap-x-6 border-b px-7 pt-7 pb-5 sm:absolute sm:inset-x-0 sm:top-0 sm:gap-x-8 sm:border-0 sm:bg-linear-to-b sm:to-transparent sm:px-12 sm:pb-20">
            <div className="col-start-1 row-start-1">
              {/*
                The same heading the landing carries, at caption size. An `h1` in
                both states rather than a `p` here and an `h1` there: the inspector
                below renders the focused film's title as an `h2`, which needs
                something above it, and two states of one page disagreeing about
                their outline is the kind of thing only a screen reader ever sees.
              */}
              <h1 className="text-sm">
                <Link
                  href="/"
                  aria-label="EIGA home"
                  onClick={(event) => {
                    event.preventDefault();
                    reset();
                  }}
                  className="eiga-mark text-paper hover:text-signal pointer-events-auto transition-colors"
                >
                  EIGA
                </Link>
              </h1>
              {/*
                Dropped on a phone, where this line would share 319px with the
                wordmark and two controls. It is not lost: the landing sets it
                directly under the wordmark at full size, and every visitor to a
                loaded map has just come through there.
              */}
              <p className="eiga-annotation mt-2 max-sm:hidden">Your cinema, mapped.</p>
            </div>

            {/*
              The two acts. A row on a phone, where the grid gives them one line
              beside the wordmark; a right-aligned stack above `sm`, which is the
              corner they have always occupied.
            */}
            <div className="pointer-events-auto col-start-2 row-start-1 flex flex-wrap items-start justify-end gap-2 justify-self-end max-sm:max-w-56 sm:row-span-2 sm:flex-col sm:items-end sm:gap-4 sm:text-right">
              <ThemeControl />
              <ImportControl onFiles={load} hintClassName="max-sm:hidden" />
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

            <div className="pointer-events-auto col-span-2 col-start-1 row-start-2 sm:col-span-1">
              <AxisControl options={options} active={active.id} onSelect={setAxis} />
              <SearchControl query={query} onQuery={setQuery} found={found?.size ?? null} />
              <FilterControl options={filters} active={highlights} onToggle={toggleHighlight} />
              {active.id === "diary" && (
                <p className="eiga-annotation mt-3 max-w-sm text-balance">
                  Longer gaps get more room
                </p>
              )}
            </div>
          </div>

          {/*
            The surface. Full-bleed above `sm`; the column's one flexible row
            below it, where `min-h-0` is what lets it actually shrink — a flex item
            defaults to its content's minimum size, and `GraphView` asks for 100%
            of its parent, which without this resolves circularly in the map's
            favour and pushes the footer off the screen.
          */}
          <div className="relative min-h-0 flex-1 sm:absolute sm:inset-0">
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

          <div className="from-void via-void/85 border-rule pointer-events-none relative z-10 flex shrink-0 flex-wrap items-end justify-between gap-6 border-t px-7 pt-5 pb-7 sm:absolute sm:inset-x-0 sm:bottom-0 sm:gap-8 sm:border-0 sm:bg-linear-to-t sm:to-transparent sm:px-12 sm:pt-20">
            {/*
              Given a fixed plate on a phone rather than being allowed to grow.

              The museum label is the one piece of chrome whose height is decided by
              the data — "Nothing selected" is two lines, a five-star film with a
              review is ten — and in a flow column that height comes straight out of
              the map's. `GraphView` reframes on every size change, so letting the
              label grow would mean the map jumped and re-fitted each time a film was
              tapped, which is the one gesture the whole screen exists to serve. A
              fixed plate that scrolls keeps the map still; above `sm` the label
              floats over the map and can be exactly as tall as it needs to be.
            */}
            <div className="pointer-events-auto max-sm:h-36 max-sm:w-full max-sm:overflow-y-auto">
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

              Flush right in the corner it occupies above `sm`, flush left on a
              phone, where it is a full-width row under the label and ranging it
              right would leave it hanging off the end of nothing.
            */}
            <div className="pointer-events-auto text-right max-sm:w-full max-sm:text-left">
              {/*
                `text-balance` because this line is composed, not written, so its
                length is a property of the library and cannot be checked once.
                Measured at 375px it wrapped to `37 films · 29 days · 4 undated ·`
                then `library` — a single orphaned word, and on the default axis,
                because Watch dates is the only one that can add an `undated`
                clause. Balancing splits it evenly instead of leaving the tail
                behind. Above `sm` it fits on one line and this does nothing.
              */}
              <p className="eiga-annotation text-balance">{status}</p>
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

      {/* Above the bands, which are now explicitly at `z-10` so that moving the
          header ahead of the map in the DOM cannot let the map paint over it. */}
      {dropping && (
        <div className="border-signal/30 pointer-events-none absolute inset-5 z-20 flex items-center justify-center border">
          <p className="eiga-mark text-signal text-xs">Release to read</p>
        </div>
      )}
    </main>
  );
}
