import type { Metadata } from "next";
import { BitPredictApp } from "@/components/BitPredictApp";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "My Positions & Payouts",
  description:
    "Manage your Nostr account, connected WebLN or NWC Lightning wallet, active prediction positions, and claimable payouts.",
  path: "/profile",
  noIndex: true,
});

export default function ProfilePage() {
  return <BitPredictApp initialView="positions" />;
}
