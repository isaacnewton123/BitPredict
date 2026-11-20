import type { MetadataRoute } from "next";
import { CATEGORIES } from "@/lib/bitpredict-data";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/create`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/oracle`,
      changeFrequency: "hourly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/docs`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];

  const categoryRoutes: MetadataRoute.Sitemap = CATEGORIES.filter(
    (c) => c.id !== "All",
  ).map((c) => ({
    url: `${SITE_URL}/c/${c.slug}`,
    changeFrequency: "hourly",
    priority: 0.85,
  }));

  return [...staticRoutes, ...categoryRoutes];
}
