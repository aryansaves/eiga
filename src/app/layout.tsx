import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ORIGIN } from "./site.ts";

/*
  The canonical origin, and the only value in this file that cannot be derived
  from anything else.

  `output: "export"` writes this HTML once, at build time, with no request to
  learn a host from — so every absolute URL in the metadata below is frozen at
  whatever `metadataBase` resolves to. Left unset, Next falls back to
  `http://localhost:3000` and bakes that into production, at which point a shared
  link asks the *reader's* machine for the preview image. That fails silently and
  is invisible in local testing, because localhost resolves perfectly well on the
  machine that built the file.

  Cloudflare Pages serves from the root of this origin, so there is no `basePath`
  to match here. A GitHub Pages project site would serve from `/eiga/` and would
  need both this path and `basePath` in `next.config.ts` to agree.

  If the domain changes, change this line and rebuild. Nothing else moves.
*/
/*
  Stated once and reused. Open Graph does not inherit from `<title>` or from
  `description` — a scraper reads the `og:` namespace or falls back to guessing,
  and the guess is usually the first heading it finds. Repeating them here is not
  duplication; it is the only way the card says what the page says.
*/
const TITLE = "EIGA";
const DESCRIPTION =
  "Turn your Letterboxd history into an interactive map of your movie taste. Processed entirely in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "EIGA",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "EIGA",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  /*
    `summary_large_image` rather than the default. Without it X renders a small
    square crop of a 1.91:1 card, which cuts the map fragment off entirely and
    leaves a thumbnail of the left margin.

    No `images` entry on either object: `opengraph-image.png` and
    `twitter-image.png` sit beside this file, and Next emits the tags — including
    the width, height and type that some scrapers use to decide whether to fetch
    at all — with the absolute URL resolved through `metadataBase`.
  */
  verification: {
    google: "H_zjVGoGKD6hl7smyrCc8WOQLSFCPjdAfNxVssaD_w0"
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

/*
  Separate from `metadata` because Next moved it there; declaring `themeColor`
  alongside the rest is a deprecation warning now.

  This is `--color-void`, so mobile browser chrome takes the page's ground colour
  instead of flashing white around a near-black map.
*/
export const viewport: Viewport = {
  themeColor: "#101114",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
      A definite height, all the way down, and `h-full` rather than `min-h-full`
      on purpose.

      `main` is a flex column on a phone whose middle row is the map, and the map
      asks for 100% of that row. A percentage height only resolves against an
      ancestor chain that is definite — under `min-h-full` the chain never was, so
      the request fell through to the SVG's intrinsic default and the map drew
      itself 150px tall inside a 275px slot. Nothing looked broken; the map was
      simply framed to the wrong box and opened at a hundredth of its right scale.

      Costs nothing that `min-h-full` was buying: `main` is `overflow-hidden` at
      both widths, so the page has never grown past one screen either way.
    */
    <html lang="en" className="h-full" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Restore appearance before paint; no imported data is stored. */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            if (localStorage.getItem("eiga-theme") === "light") {
              document.documentElement.dataset.theme = "light";
              document.querySelector('meta[name="theme-color"]')
                ?.setAttribute("content", "#f3f1ea");
            }
          } catch {}
        ` }} />
      </head>
      <body className="bg-void text-paper flex h-full flex-col">
        {children}
      </body>
    </html>
  );
}
