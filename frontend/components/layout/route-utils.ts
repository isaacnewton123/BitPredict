import type { IconType } from "react-icons";
import {
  LuBitcoin,
  LuChartBar,
  LuChartColumn,
  LuCloudSun,
  LuCompass,
  LuCpu,
  LuGamepad2,
  LuLandmark,
  LuLayoutGrid,
  LuShieldCheck,
  LuSparkles,
  LuTrendingUp,
  LuTrophy,
  LuWallet,
} from "react-icons/lu";
import { type AppView, categoryFromSlug, type CategoryId } from "@/lib/bitpredict-data";

export const VIEW_PATHS: Record<Exclude<AppView, "market-detail">, string> = {
  markets: "/",
  creator: "/create",
  oracle: "/oracle",
  positions: "/profile",
  "how-it-works": "/docs",
  admin: "/admin",
};

export const NAV_ITEMS: readonly {
  viewKey: Exclude<AppView, "market-detail" | "admin">;
  label: string;
  Icon: IconType;
}[] = [
  { viewKey: "markets", label: "Markets", Icon: LuChartColumn },
  { viewKey: "creator", label: "AI Creator", Icon: LuSparkles },
  { viewKey: "oracle", label: "Oracle", Icon: LuShieldCheck },
  { viewKey: "positions", label: "Positions", Icon: LuWallet },
  { viewKey: "how-it-works", label: "How It Works", Icon: LuCompass },
];

export const CATEGORY_ICONS: Record<CategoryId, IconType> = {
  All: LuLayoutGrid,
  Sports: LuTrophy,
  Politics: LuLandmark,
  Crypto: LuBitcoin,
  Esports: LuGamepad2,
  Finance: LuTrendingUp,
  Technology: LuCpu,
  Economy: LuChartBar,
  Culture: LuSparkles,
  Weather: LuCloudSun,
};

export function parseRouteState(
  pathname: string | null,
  fallback: { view: AppView; category: CategoryId; slug: string | null },
): { view: AppView; category: CategoryId; slug: string | null } {
  if (!pathname) return fallback;
  if (pathname === "/") return { view: "markets", category: "All", slug: null };
  if (pathname === "/create") return { view: "creator", category: "All", slug: null };
  if (pathname === "/oracle") return { view: "oracle", category: "All", slug: null };
  if (pathname === "/profile") return { view: "positions", category: "All", slug: null };
  if (pathname === "/docs") return { view: "how-it-works", category: "All", slug: null };
  if (pathname === "/admin") return { view: "admin", category: "All", slug: null };
  if (pathname.startsWith("/c/")) {
    const rawSlug = decodeURIComponent(pathname.slice(3).split("/")[0] ?? "");
    return { view: "markets", category: categoryFromSlug(rawSlug), slug: null };
  }
  if (pathname.startsWith("/m/")) {
    const rawSlug = decodeURIComponent(pathname.slice(3).split("/")[0] ?? "");
    if (rawSlug) return { view: "market-detail", category: "All", slug: rawSlug };
  }
  return fallback;
}
