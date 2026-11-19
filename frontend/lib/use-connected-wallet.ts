"use client";

import { useSyncExternalStore } from "react";
import {
  type ConnectedLightningWallet,
  getConnectedWallet,
  getServerWalletSnapshot,
  subscribeWallet,
} from "./lightning-wallet";

/** Hydration-safe client hook returning the live connected Lightning wallet. */
export function useConnectedWallet(): ConnectedLightningWallet | null {
  return useSyncExternalStore(
    subscribeWallet,
    getConnectedWallet,
    getServerWalletSnapshot,
  );
}
