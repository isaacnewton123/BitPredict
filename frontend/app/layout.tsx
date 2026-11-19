import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BitPredict — Live Bitcoin Lightning & Nostr Prediction Markets",
  description:
    "Turn any prediction into an unambiguous Bitcoin Lightning prediction market backed by deterministic Auto-API and Nostr oracles.",
  icons: {
    icon: "/brand/bitpredict-logo.jpg",
    shortcut: "/brand/bitpredict-logo.jpg",
    apple: "/brand/bitpredict-logo.jpg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${ibmPlexSans.variable} h-full antialiased`}
    >
      <body className="bg-white text-[#101114] antialiased min-h-screen flex flex-col selection:bg-[rgba(133,91,251,0.16)] selection:text-[#7132f5]">
        {children}
      </body>
    </html>
  );
}
