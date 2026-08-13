import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";
import { MobileNav } from "@/components/MobileNav";
import { Footer } from "@/components/Footer";
import "./globals.css";

const sans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", weight: "400", style: ["normal", "italic"], subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ShadowPool | Dark pool for FAssets on Flare",
  description:
    "Encrypted orders, TEE matching, on-chain settlement. Trade large FAsset positions without showing the market your hand.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} ${mono.variable} min-h-screen flex flex-col`}>
        <WalletProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
          <MobileNav />
        </WalletProvider>
      </body>
    </html>
  );
}
