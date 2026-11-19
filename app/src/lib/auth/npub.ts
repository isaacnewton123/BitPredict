import { nip19 } from "nostr-tools";

export function pubkeyToNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex.toLowerCase());
}

export function shortNpub(npubOrHex: string): string {
  const npub = npubOrHex.startsWith("npub1") ? npubOrHex : pubkeyToNpub(npubOrHex);
  return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
}
