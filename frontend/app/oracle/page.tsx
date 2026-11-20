import type { Metadata } from "next";
import { BitPredictApp } from "@/components/BitPredictApp";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Oracle Transparency Board",
  description:
    "Inspect live automated oracle data feeds, SHA-256 commitment proofs, community outcome proposals, and dispute challenges on BitPredict.",
  path: "/oracle",
});

export default function OraclePage() {
  return <BitPredictApp initialView="oracle" />;
}
