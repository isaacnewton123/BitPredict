import type { Metadata } from "next";
import { BitPredictApp } from "@/components/BitPredictApp";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "AI Market Creator",
  description:
    "Draft and publish unambiguous Bitcoin Lightning prediction markets in seconds with deterministic Auto-API and Nostr oracle specs.",
  path: "/create",
});

export default function CreatePage() {
  return <BitPredictApp initialView="creator" />;
}
