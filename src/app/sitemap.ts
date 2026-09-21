import type { MetadataRoute } from "next";
import { ORIGIN } from "./site.ts";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: ORIGIN,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
