import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ORIGIN } from "@/app/site.ts";

export function guideMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function Guide({
  title,
  description,
  path,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly children: ReactNode;
}) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: `${ORIGIN}${path}`,
    author: {
      "@type": "Organization",
      name: "Eiga project",
      url: "https://github.com/aryansaves/eiga",
    },
  };
  return (
    <main className="eiga-guide">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <nav aria-label="Main navigation">
        <Link href="/" className="eiga-mark">
          EIGA
        </Link>
        <Link href="/letterboxd-exports">Letterboxd exports</Link>
        <Link href="/movie-graph">Movie graph</Link>
      </nav>
      <article>
        <header>
          <p className="eiga-annotation">The Eiga field guide</p>
          <h1>{title}</h1>
          <p className="eiga-guide-deck">{description}</p>
          <p className="eiga-guide-credit">
            By the <a href="https://github.com/aryansaves/eiga">Eiga project</a> ·
            Implementation notes checked{" "}
            <time dateTime="2026-10-28">28 October 2026</time>. Based on the public
            importer, graph code and reproducible demo library.
          </p>
        </header>
        {children}
        <footer>
          <h2>Make a map of your own cinema</h2>
          <p>
            <Link href="/">Open Eiga and import your Letterboxd export</Link>, or choose
            “Or see a demo library” to explore before importing.
          </p>
          <p>Eiga is an independent project and is not affiliated with Letterboxd.</p>
        </footer>
      </article>
    </main>
  );
}
