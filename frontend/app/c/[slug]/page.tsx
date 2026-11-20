import type { Metadata } from "next";
import { Suspense } from "react";
import { BitPredictApp } from "@/components/BitPredictApp";
import { categoryFromSlug } from "@/lib/bitpredict-data";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = categoryFromSlug(slug);
  const label = category === "All" ? "Prediction" : category;
  return buildPageMetadata({
    title: `${label} Prediction Markets`,
    description: `Browse live ${label.toLowerCase()} prediction markets powered by Bitcoin Lightning settlement and verifiable Nostr oracles on BitPredict.`,
    path: `/c/${encodeURIComponent(slug)}`,
  });
}

async function CategoryContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BitPredictApp initialView="markets" initialCategory={categoryFromSlug(slug)} />;
}

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <CategoryContent params={params} />
    </Suspense>
  );
}
