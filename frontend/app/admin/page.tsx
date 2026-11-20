import type { Metadata } from "next";
import { BitPredictApp } from "@/components/BitPredictApp";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Operator Admin Console",
  description:
    "BitPredict operator console for Track B dispute arbitration, oracle feed triggers, and workspace operations.",
  path: "/admin",
  noIndex: true,
});

export default function AdminPage() {
  return <BitPredictApp initialView="admin" />;
}
