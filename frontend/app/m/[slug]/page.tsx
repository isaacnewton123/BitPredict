import type { Metadata } from "next";
import { Suspense } from "react";
import { BitPredictApp } from "@/components/BitPredictApp";
import { buildPageMetadata, formatMarketSlugTitle } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const marketTitle = formatMarketSlugTitle(slug);
  return buildPageMetadata({
    title: marketTitle,
    description: `Trade YES/NO odds on "${marketTitle}" with instant Bitcoin Lightning settlement and cryptographic oracle proofs on BitPredict.`,
    path: `/m/${encodeURIComponent(slug)}`,
  });
}

async function MarketDetailContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BitPredictApp initialView="market-detail" initialMarketIdOrSlug={slug} />;
}

export default function MarketDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <MarketDetailContent params={params} />
    </Suspense>
  );
}
