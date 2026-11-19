import { Suspense } from "react";
import { BitPredictApp } from "@/components/BitPredictApp";

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
