# Eiga search and inbound-link plan

Research date: 28 October 2026. These are observations from live web-search results,
not a location-controlled Google rank report. No search-volume, keyword-difficulty,
Search Console or conversion data was available. Do not interpret result presence
or absence as a verified ranking or indexing diagnosis.

## Search intent and page ownership

| Target | Observed results and intent | Eiga page and response |
| --- | --- | --- |
| eiga / eiga Letterboxd | Brand ambiguity: Japanese movie content, Letterboxd profiles and studio pages. Eiga.com is a separate film site. | `/`: identify Eiga immediately as a Letterboxd movie graph; keep the brand and product purpose together in the title and visible copy. |
| Letterboxd exports | Official export help, import walkthroughs and independent export viewers. People need the file and an explanation of what to do with it. | `/letterboxd-exports`: put export and import steps first, followed by supported files, dates, duplicates, limits and privacy. |
| movie graph / Letterboxd movie graph | Mixed intent: CineGraph recommendations, graph databases, academic material and viewing-history visualizations. | `/movie-graph`: explain a personal viewing-history graph with a reproducible demo, distinguish viewings from films, and state what connections mean. |

Sources inspected:

- [Letterboxd account-export help](https://letterboxd.zendesk.com/hc/en-us/articles/15179196880911-Can-I-get-a-copy-of-my-account-data): authoritative explanation of the downloadable bundle.
- [RANKD export guide](https://therankd.com/import/letterboxd): direct steps, file descriptions and FAQs; a strong example of satisfying the export task quickly.
- [Letterboxd Export Viewer](https://github.com/KevDoy/letterboxd-viewer): export browsing, posters, statistics and a local-data approach.
- [CineGraph](https://cinegraphd.com/): search result describes movie similarity and recommendations; Eiga should explain its own viewing-history purpose clearly.

The opportunity is an implementation-backed answer, not a longer generic article.
Eiga's distinguishing details are date provenance, record merging, absent credits,
and a graph whose sample counts can be reproduced from public code. Keep the two
guides distinct instead of making near-duplicate pages for keyword variations.

## Evidence and attribution

The graph guide calculates 37 demo films, 36 dated viewing events and 32 rated films
from `demoLibrary()` at build time. Decade counts are 4, 6, 3, 3, 7, 9 and 5 from the
1950s through the 2010s. These are measurements of an authored demo, not production
usage or a real viewer's ratings. The diagram is a new explanatory layout of real
graph membership output. Never claim these are audience statistics.

The byline credits the Eiga project with public source links and a clear evidence
basis. A named author biography should be added only after the author supplies or
confirms their name, role and relevant experience. Do not invent credentials,
testimonials, customer counts or personal testing history.

## How external SEO works here

A useful inbound link is an editorial reference from a relevant page whose readers
would benefit from Eiga. Relevance, placement, genuine readership and the reason for
the citation matter more than buying a high third-party domain score.

1. Make the guides and demo worth citing. Keep the file-format table and edge cases
   current; publish corrections when importer behavior changes. Offer a documented
   sample or an original diagram, not fabricated aggregate user data.
2. Add a descriptive project link from the public Eiga repository README/About and
   the maintainer's own project portfolio. This helps discovery and credibility;
   self-controlled links are not independent editorial endorsements.
3. Find authors of Letterboxd export tutorials, film-data newsletters and data
   visualization writeups. Read the exact page before approaching its author.
   Suggest the export guide where they explain CSV handling, or the movie-graph
   guide where they discuss visualizing a viewing history.
4. Share a useful worked example in communities that permit project posts. Disclose
   that you work on Eiga, answer questions directly and include a link only where
   it helps. A forum link can bring relevant visitors even when marked nofollow.
5. Offer film clubs or visualization educators a short demonstration using the
   public demo or data they explicitly agree to share. An independently written
   resource page or tutorial is a better outcome than a mandatory backlink.

Suggested outreach draft (not sent):

> Your guide explains how to download a Letterboxd export. I work on Eiga, which
> maps that export locally. We documented why the Date and Watched Date fields
> differ, and how diary/review duplicates affect the map. If that would help your
> readers at [specific relevant section], the guide is at [guide URL]. Happy to
> answer questions about the importer.

Personalize the bracketed parts after actually reading the page. Let publishers
choose their wording and whether to link. Do not send bulk pitches or demand exact
keyword anchors. No outreach or external posting has been performed for this task.

Avoid paid ranking links, automated directory submissions, private link networks,
and excessive reciprocal exchanges. Sponsored placements need appropriate link
qualification (prefer `rel="sponsored"`). Google's [link spam policy](https://developers.google.com/search/docs/essentials/spam-policies#link-spam)
and [link guidance](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
explain the distinction. No backlink or keyword change guarantees ranking.

## Release and measure

The frontend statically exports both guides. Each has its own title, description,
canonical URL, social metadata, visible project byline and matching TechArticle
structured data. The sitemap includes all three public pages. Links from the
homepage and between guides use descriptive anchor text. No keyword meta tag or
FAQ-rich-result promise is needed.

Release using the existing paired workflow: validate frontend checks, test the
frontend/backend pair on staging, merge frontend, pin its merged SHA in
`eiga-persistent/release.json`, verify the pair and merge the backend release.
Do not deploy this frontend alone over the combined application.

After release:

- Check production returns HTML for both guide URLs, with self-canonicals and the
  correct sitemap; confirm account and sharing routes still work.
- In the verified Search Console property, submit `/sitemap.xml` and inspect the
  two new URLs. Request indexing where appropriate; indexing is not guaranteed.
- Record a baseline and compare equal 28-day periods by page and query. Separate
  brand searches from export/graph searches; track impressions, clicks and CTR.
  Interpret position with country/device context and sufficient impressions.
- Record earned referring pages and relevant referral visits where existing,
  privacy-approved measurement permits. Search Console cannot prove which link
  caused a ranking change. Do not add tracking solely for this exercise.
- Improve answers from real importer questions and search queries, rather than
  repeatedly adding keyword variants. Recheck dates and code links on revisions.
