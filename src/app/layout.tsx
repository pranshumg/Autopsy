import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Geist_Pixel, Instrument_Serif } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import "./site.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const pixel = Geist_Pixel({ variable: "--font-pixel", subsets: ["latin"], weight: "400" });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "AUTOPSY — Black-box algorithm investigation", template: "%s · AUTOPSY" },
  description:
    "AUTOPSY deploys statistical agents that audit opaque scoring systems through controlled experiments and report the behavioral patterns the evidence supports, with uncertainty, as an auditable rulebook.",
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrument.variable} ${pixel.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
