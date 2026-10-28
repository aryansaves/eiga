import Link from "next/link";
import { Guide, guideMetadata } from "@/components/Guide.tsx";
import { demoLibrary } from "@/domain/demo.ts";
import { buildGraph, byDecade, orderedHubs } from "@/graph/build.ts";

const title = "Eiga movie graph: read your Letterboxd viewing history";
const description =
  "See what the dots and connections in Eiga mean, explore an original graph of the demo library, and choose the right view for your Letterboxd export.";
export const metadata = guideMetadata(title, description, "/movie-graph");

export default function MovieGraph() {
  const library = demoLibrary();
  const graph = buildGraph(library, byDecade);
  const hubs = orderedHubs(graph);
  const memberships = graph.edges.filter((edge) => edge.kind === "membership");
  const dated = library.watches.filter((watch) => watch.watchedOn !== null);
  const undated = library.films.filter(
    (film) => !dated.some((watch) => watch.filmId === film.id),
  );
  return (
    <Guide title={title} description={description} path="/movie-graph">
      <section>
        <h2>What is a movie graph in Eiga?</h2>
        <p>
          Eiga turns the films in your Letterboxd export into an interactive map. In “Your
          journey,” stops represent dated viewings and connections follow watch order. In
          Decade, Rating and Watch year, film dots connect to groups that explain a shared
          attribute.
        </p>
        <p>
          Use it to explore your own history: a run of older films, a year of frequent
          rewatches, or the films you rated most highly. Connections describe your
          records; they do not predict which film you should watch next.
        </p>
        <p>
          <Link href="/letterboxd-exports">
            Download and import your Letterboxd export
          </Link>{" "}
          to make your own, or <Link href="/">open Eiga</Link> and choose the demo library
          first.
        </p>
      </section>
      <section>
        <h2>A reproducible example from Eiga’s demo</h2>
        <p>
          The bundled demo contains {library.films.length} films, {dated.length} dated
          viewings, {library.ratings.size} rated films and {undated.length} films without
          dated viewings. These counts are calculated from the actual demo during the site
          build. Its viewing dates and ratings are authored examples, not a real person’s
          history or a survey of Eiga users.
        </p>
        <figure>
          <svg
            viewBox={`0 0 680 ${hubs.length * 78 + 30}`}
            role="img"
            aria-labelledby="demo-title demo-desc"
            className="eiga-guide-diagram"
          >
            <title id="demo-title">
              Eiga demo films connected to release-decade hubs
            </title>
            <desc id="demo-desc">
              Each row shows one decade hub and one small dot per demo film in that
              decade. The table below gives exact counts. Positions are an explanatory
              layout, not the interactive app layout.
            </desc>
            {hubs.map((hub, row) => {
              const edges = memberships.filter(
                (edge) => edge.target === hub.id || edge.source === hub.id,
              );
              const y = row * 78 + 38;
              return (
                <g key={hub.id}>
                  <text x="10" y={y + 5} fill="currentColor" fontSize="16">
                    {hub.label}
                  </text>
                  <circle cx="130" cy={y} r="10" fill="none" stroke="currentColor" />
                  {edges.map((edge, index) => {
                    const x = 220 + index * 40;
                    const filmId = edge.source === hub.id ? edge.target : edge.source;
                    const film = graph.nodes.find((node) => node.id === filmId);
                    return (
                      <g key={edge.id}>
                        <line
                          x1="140"
                          y1={y}
                          x2={x}
                          y2={y + (index % 2 === 0 ? -18 : 18)}
                          stroke="currentColor"
                          opacity="0.25"
                        />
                        <circle
                          cx={x}
                          cy={y + (index % 2 === 0 ? -18 : 18)}
                          r="5"
                          fill="currentColor"
                        >
                          <title>{film?.label}</title>
                        </circle>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <figcaption>
            Original diagram generated from the{" "}
            <a href="https://github.com/aryansaves/eiga/blob/main/src/domain/demo.ts">
              bundled demo data
            </a>{" "}
            and Eiga’s graph builder. Only decade membership edges are shown; the app also
            connects ordered hubs and qualifying same-day sessions.
          </figcaption>
        </figure>
        <div className="eiga-guide-table">
          <table>
            <caption>Demo films by release decade</caption>
            <thead>
              <tr>
                <th scope="col">Decade</th>
                <th scope="col">Films</th>
              </tr>
            </thead>
            <tbody>
              {hubs.map((hub) => (
                <tr key={hub.id}>
                  <th scope="row">{hub.label}</th>
                  <td>
                    {
                      memberships.filter(
                        (edge) => edge.target === hub.id || edge.source === hub.id,
                      ).length
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Choose a view that answers your question</h2>
        <dl>
          <dt>Your journey: what did I watch, and when?</dt>
          <dd>
            Follow dated viewing events on the calendar. A rewatch can be another stop for
            the same film. Without watch dates, Eiga hides this view.
          </dd>
          <dt>Decade: which eras do I return to?</dt>
          <dd>
            Group films by release decade. A film released in 1999 belongs to the 1990s
            even if you watched it in 2025. Unknown release years have their own group.
          </dd>
          <dt>Rating: what did I love?</dt>
          <dd>
            Group by your personal stars, not Letterboxd’s community average. The view
            requires at least one rating; unrated films are kept separate.
          </dd>
          <dt>Watch year: how did my viewing change?</dt>
          <dd>
            Group by the year of the viewing. A film watched in more than one year can
            connect to more than one year hub.
          </dd>
          <dt>Director: whose work am I exploring?</dt>
          <dd>
            Available for the demo, which includes credits. Standard Letterboxd exports do
            not provide those credits, so this view is normally absent on import.
          </dd>
        </dl>
      </section>
      <section>
        <h2>Why use hubs instead of connecting every pair of films?</h2>
        <p>
          Ten films in one decade need 45 connections if every film connects to every
          other film: 10 × 9 ÷ 2. Connecting the same ten films to one decade hub needs
          ten membership edges. That leaves the films readable as a library grows.
        </p>
        <p>
          Eiga uses one grouping axis at a time. Ordered hubs have a connecting spine;
          qualifying small same-day viewing sessions can add film-to-film links. In the
          journey view, links instead follow chronological stops. A line does not imply
          that two films share a cast, genre or director.
        </p>
      </section>
      <section>
        <h2>Read a graph without overreading the data</h2>
        <p>
          A large decade group tells you how many imported films fall in that release
          period. It does not prove that decade is your favorite: compare your ratings
          before making that claim. Missing diary entries mean missing dates, not a period
          when you watched nothing.
        </p>
        <p>
          If two records unexpectedly merge, or a viewing disappears, check the{" "}
          <Link href="/letterboxd-exports">
            Letterboxd export guide’s duplicate and missing-date explanations
          </Link>
          . The graph can only represent the records and metadata the importer actually
          receives.
        </p>
        <p>
          For the precise rules, inspect the public{" "}
          <a href="https://github.com/aryansaves/eiga/blob/main/src/graph/build.ts">
            hub graph implementation
          </a>{" "}
          and{" "}
          <a href="https://github.com/aryansaves/eiga/blob/main/src/graph/thread.ts">
            journey implementation
          </a>
          .
        </p>
      </section>
    </Guide>
  );
}
