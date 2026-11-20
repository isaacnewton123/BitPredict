import type { Metadata } from "next";
import { BitPredictApp } from "@/components/BitPredictApp";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "How BitPredict Works",
  description:
    "Learn how BitPredict settles parimutuel Bitcoin Lightning prediction markets using Auto-API feeds, Nostr optimistic oracles, and instant Lightning payouts.",
  path: "/docs",
});

export default function DocsPage() {
  return <BitPredictApp initialView="how-it-works" />;
}
