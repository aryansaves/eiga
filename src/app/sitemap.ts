import type { MetadataRoute } from "next";
import { ORIGIN } from "./site.ts";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/letterboxd-exports", "/movie-graph"].map((path) => ({
    url: `${ORIGIN}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.8,
  }));
}
