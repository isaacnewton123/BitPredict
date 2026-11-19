import { Suspense } from "react";
import { BitPredictApp } from "@/components/BitPredictApp";
import { categoryFromSlug } from "@/lib/bitpredict-data";

async function CategoryContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BitPredictApp initialView="markets" initialCategory={categoryFromSlug(slug)} />;
}

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<BitPredictApp initialView="markets" />}>
      <CategoryContent params={params} />
    </Suspense>
  );
}
