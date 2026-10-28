import Link from "next/link";
import { Guide, guideMetadata } from "@/components/Guide.tsx";

const title = "Letterboxd exports: from ZIP to your Eiga movie graph";
const description =
  "Download your Letterboxd export, import it into Eiga, and understand which CSV files shape your viewing history, ratings and watch dates.";
export const metadata = guideMetadata(title, description, "/letterboxd-exports");

export default function LetterboxdExports() {
  return (
    <Guide title={title} description={description} path="/letterboxd-exports">
      <section>
        <h2>The quickest route to your map</h2>
        <ol>
          <li>
            Sign in to Letterboxd in your browser. Open Settings and find the account data
            export, or go directly to{" "}
            <a href="https://letterboxd.com/user/exportdata/">Letterboxd’s export page</a>
            .
          </li>
          <li>Request and download the ZIP. Keep the original archive as your backup.</li>
          <li>
            <Link href="/">Open Eiga’s movie graph</Link> and select the ZIP with the
            import control. You can also select the supported CSV files together after
            unzipping.
          </li>
          <li>
            Explore “Your journey” when your export includes watch dates, or start with
            Decade when it does not. Add ratings and diary files for more ways to explore.
          </li>
        </ol>
        <p>
          No Eiga account is required for local exploration. Eiga parses the raw files in
          your browser. Letterboxd’s{" "}
          <a href="https://letterboxd.zendesk.com/hc/en-us/articles/15179196880911-Can-I-get-a-copy-of-my-account-data">
            account-export documentation
          </a>{" "}
          confirms that the ZIP contains CSV documents, including deleted content; Eiga
          deliberately excludes nested deleted watch history.
        </p>
      </section>
      <section>
        <h2>Which export files does Eiga use?</h2>
        <p>
          You do not need to edit the CSVs. Keep their original names: similar-looking
          headers can describe very different things.
        </p>
        <div className="eiga-guide-table">
          <table>
            <caption>How Eiga interprets Letterboxd export files</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">What it contributes</th>
                <th scope="col">Important limit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">watched.csv</th>
                <td>Films, release years and film links</td>
                <td>The Date column is not treated as a viewing date.</td>
              </tr>
              <tr>
                <th scope="row">ratings.csv</th>
                <td>Films and personal star ratings</td>
                <td>Valid ratings run from 0.5 to 5 in half-star steps.</td>
              </tr>
              <tr>
                <th scope="row">diary.csv</th>
                <td>Viewings, Watched Date and rewatch flags</td>
                <td>A diary-entry link is not a film identifier.</td>
              </tr>
              <tr>
                <th scope="row">reviews.csv</th>
                <td>Review text and overlapping viewing records</td>
                <td>Matching diary and review viewings are deduplicated.</td>
              </tr>
              <tr>
                <th scope="row">likes/films.csv</th>
                <td>Likes on films already in the imported history</td>
                <td>A like alone does not add a watched film.</td>
              </tr>
              <tr>
                <th scope="row">
                  watchlist.csv, profile.csv, lists and nested watch history
                </th>
                <td>Not used to populate the map</td>
                <td>
                  Unseen films, account identity and deleted entries do not become viewing
                  history.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Why a map can differ from your Letterboxd totals</h2>
        <h3>Films and viewings are different counts</h3>
        <p>
          A film watched twice is one film with two viewing events. Eiga merges films
          using a normalized title and release year because film links and diary-entry
          links identify different objects. Matching title, year, watch date and rewatch
          flag collapse overlapping diary and review entries into one event.
        </p>
        <p>
          This has limits: different films with the same normalized title and year can
          merge. Multiple same-day viewings with the same rewatch flag can also collapse.
          Missing or inconsistent release years can keep records apart. These are importer
          limitations, not evidence that your original export lost data.
        </p>
        <h3>“Your journey” is missing</h3>
        <p>
          A watched-only export has no reliable viewing dates. Import diary.csv or
          reviews.csv with a populated Watched Date column. Eiga does not substitute the
          date you added a film to Letterboxd. Undated films remain available in the
          attribute maps.
        </p>
        <h3>The Director option is missing</h3>
        <p>
          Standard watch-history CSVs do not contain director credits. The authored demo
          supplies those credits; your raw export does not. Eiga only offers the Director
          view when that information exists. See{" "}
          <Link href="/movie-graph">what each movie graph connection means</Link>.
        </p>
        <h3>An archive is rejected or files are skipped</h3>
        <p>
          Eiga caps both the compressed archive and its total expanded data at 32 MiB.
          Encrypted or unsupported ZIP formats cannot be read. For an archive problem,
          extract the supported top-level CSVs and select them together, preserving their
          filenames. Do not move deleted or orphaned history into the top level.
        </p>
        <p>
          Read the import report beside the control. Unknown filenames are skipped; a
          missing Name column rejects a file, and rows without a title are skipped.
          Invalid ratings are discarded rather than guessed. Correct the source file or
          request a fresh export if the report identifies malformed data.
        </p>
      </section>
      <section>
        <h2>What stays local, and what gets saved?</h2>
        <p>
          Raw ZIP and CSV files are parsed locally. Anonymous exploration does not save
          your library to an Eiga account; closing the tab clears that session. Optional
          sign-in lets you save the normalized library to Eiga’s backend. A shared link
          exposes the latest saved map, including review text, until revoked. Review that
          content before sharing.
        </p>
        <p>
          This is a one-time import, not a live sync with Letterboxd. Export again when
          you want to bring in newer activity.
        </p>
      </section>
      <section>
        <h2>Check the implementation</h2>
        <p>
          These details come from Eiga’s{" "}
          <a href="https://github.com/aryansaves/eiga/blob/main/src/import/letterboxd.ts">
            CSV importer
          </a>
          ,{" "}
          <a href="https://github.com/aryansaves/eiga/blob/main/src/import/zip.ts">
            ZIP reader
          </a>{" "}
          and{" "}
          <a href="https://github.com/aryansaves/eiga/blob/main/src/import/letterboxd.test.ts">
            import regression tests
          </a>
          . They document actual behavior, including tradeoffs, so you can inspect how
          your records become a graph.
        </p>
      </section>
    </Guide>
  );
}
