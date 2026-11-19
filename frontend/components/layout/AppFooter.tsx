"use client";

import Image from "next/image";
import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="bg-white border-t border-[#dedee5] mt-auto">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-7 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="BitPredict home"
            className="flex items-center cursor-pointer"
          >
            <Image
              src="/brand/bitpredict-wordmark-light.png"
              alt="BitPredict"
              width={120}
              height={26}
              className="h-6 w-auto"
            />
          </Link>
          <span className="text-[#dedee5]">|</span>
          <span className="text-[13px] text-[#9497a9]">
            Bitcoin Lightning &amp; Nostr Prediction Protocol
          </span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-5 text-[13px] font-medium text-[#686b82]">
          <Link href="/" className="hover:text-[#7132f5] transition-colors cursor-pointer">
            Live Markets
          </Link>
          <Link href="/create" className="hover:text-[#7132f5] transition-colors cursor-pointer">
            AI Creator
          </Link>
          <Link href="/oracle" className="hover:text-[#7132f5] transition-colors cursor-pointer">
            Oracles
          </Link>
          <Link href="/docs" className="hover:text-[#7132f5] transition-colors cursor-pointer">
            How It Works
          </Link>
          <Link href="/admin" className="hover:text-[#7132f5] transition-colors cursor-pointer">
            Admin
          </Link>
        </nav>
      </div>
    </footer>
  );
}
