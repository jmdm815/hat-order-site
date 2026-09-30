import type { Metadata } from "next";
import { Assistant, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OrderProvider } from "@/lib/order-context";

// Assistant is buyjmmedia.com's actual theme font (both body and headings —
// see --font-body-family / --font-heading-family in its Shopify theme). Used
// here for both, same as the real site, in place of the previous
// Geist/Oswald pairing.
const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JM Digital Media — Custom Hat & T-Shirt Ordering",
  description:
    "Order custom hats and t-shirts from JM Digital Media with UV patch, engraved patch, embroidered, or screen print decoration.",
  // Invisible marker used to verify the auto-deploy pipeline (Claude edit ->
  // git push -> Vercel build) end to end. Safe to remove any time.
  other: { "x-autodeploy-test": "2026-08-29-ok" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${assistant.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-navy">
        <OrderProvider>{children}</OrderProvider>
      </body>
    </html>
  );
}
