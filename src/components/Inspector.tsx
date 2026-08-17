"use client";

/**
 * The inspector — a museum label, not a dashboard panel.
 *
 * It has three states and no chrome: at rest it says the one thing worth saying
 * about the library, on a film it reads out that film's catalogue entry, and on
 * a hub it lists what the hub holds. The list is also the keyboard route to
 * individual films, which the graph itself deliberately does not provide.
 */

import { describeFilm, type Library } from "@/domain/types.ts";
import { neighboursOf, type Graph } from "@/graph/build.ts";

export interface InspectorProps {
  readonly graph: Graph;
  readonly library: Library;
  readonly focusedId: string | null;
  readonly onFocus: (id: string | null) => void;
  readonly observation: string | null;
}

/** A ten-tick instrument scale. Reads as a measurement rather than a score. */
function RatingScale({ rating }: { readonly rating: number }) {
  return (
    <>
      <span className="flex items-end gap-[3px]" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <span
            key={index}
            className={`h-3 w-[2px] ${
              index < Math.round(rating * 2) ? "bg-tungsten" : "bg-rule"
            }`}
          />
        ))}
      </span>
      <span className="sr-only">Rated {rating} out of 5</span>
    </>
  );
}

function Meta({ children }: { readonly children: React.ReactNode }) {
  return <p className="eiga-annotation mt-3">{children}</p>;
}

export function Inspector({
  graph,
  library,
  focusedId,
  onFocus,
  observation,
}: InspectorProps) {
  const node = focusedId
    ? (graph.nodes.find((candidate) => candidate.id === focusedId) ?? null)
    : null;

  if (!node) {
    return (
      <div className="max-w-md">
        {observation ? (
          <p className="font-display text-paper text-xl leading-snug text-balance">
            {observation}
          </p>
        ) : (
          <p className="font-display text-paper-mid text-xl leading-snug">
            Nothing selected.
          </p>
        )}
        <Meta>Select a film or a group</Meta>
      </div>
    );
  }

  if (node.kind === "hub") {
    const members = [...neighboursOf(graph, node.id)]
      .map((id) => graph.nodes.find((candidate) => candidate.id === id))
      .filter((candidate) => candidate?.kind === "film")
      .sort((a, b) => (a?.label ?? "").localeCompare(b?.label ?? ""));

    return (
      <div className="max-w-md">
        <h2 className="eiga-mark text-paper text-sm">{node.label}</h2>
        <Meta>
          {members.length} {members.length === 1 ? "film" : "films"}
        </Meta>

        <ul className="mt-4 max-h-40 space-y-1 overflow-y-auto pr-2">
          {members.map((member) =>
            member ? (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => onFocus(member.id)}
                  className="text-paper-mid hover:text-paper text-left text-sm transition-colors"
                >
                  {member.label}
                  {member.year !== null && (
                    <span className="text-paper-dim"> · {member.year}</span>
                  )}
                </button>
              </li>
            ) : null,
          )}
        </ul>
      </div>
    );
  }

  const detail = node.filmId ? describeFilm(library, node.filmId) : null;
  if (!detail) return null;

  const facts = [
    detail.film.year === null ? null : String(detail.film.year),
    detail.film.directors.length > 0 ? detail.film.directors.join(", ") : null,
    detail.watchedOn === null ? null : `Seen ${detail.watchedOn}`,
    detail.rewatchCount > 0
      ? `${detail.rewatchCount} ${detail.rewatchCount === 1 ? "rewatch" : "rewatches"}`
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="max-w-md">
      <h2 className="font-display text-paper text-2xl leading-tight text-balance">
        {detail.film.title}
      </h2>

      <Meta>{facts.join(" · ")}</Meta>

      {detail.rating !== null && (
        <div className="mt-4">
          <RatingScale rating={detail.rating} />
        </div>
      )}

      {/*
        Rendered as a text child, so React escapes it. Review text is the most
        sensitive thing in an export and is never trusted as markup.
      */}
      {detail.review !== null && (
        <p className="text-paper-mid mt-4 max-w-prose text-sm leading-relaxed">
          {detail.review}
        </p>
      )}
    </div>
  );
}
