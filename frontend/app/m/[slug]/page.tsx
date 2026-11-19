import { Suspense } from "react";
import { BitPredictApp } from "@/components/BitPredictApp";

async function MarketDetailContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BitPredictApp initialView="markets" initialMarketIdOrSlug={slug} />;
}

export default function MarketDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<BitPredictApp initialView="markets" />}>
      <MarketDetailContent params={params} />
    </Suspense>
  );
}
