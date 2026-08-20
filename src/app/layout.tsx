import type { Metadata, Viewport } from "next";
import "./globals.css";

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
const ORIGIN = "https://eiga.pages.dev";

/*
  Stated once and reused. Open Graph does not inherit from `<title>` or from
  `description` — a scraper reads the `og:` namespace or falls back to guessing,
  and the guess is usually the first heading it finds. Repeating them here is not
  duplication; it is the only way the card says what the page says.
*/
const TITLE = "EIGA — Your cinema, mapped.";
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
    <html lang="en" className="h-full">
      <body className="bg-void text-paper flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
