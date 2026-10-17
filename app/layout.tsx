import type { Metadata } from "next";
import { Assistant, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OrderProvider } from "@/lib/order-context";

// Assistant is buyjmmedia.com's actual theme font (both body and headings —
// see --font-body-family / --font-heading-family in its Shopify theme). Used
// here for both, same as the real site, in place of the previous
// Geist/Oswald pairing.
//
// weight: "variable" (one variable-font file covering the whole 200-800
// axis) rather than an explicit array of static weights — Vercel's
// production build pipeline has a font-loader bug where a multi-weight
// Google Fonts request for this font fails with "Module not found:
// Can't resolve '@vercel/turbopack-next/internal/font/google/font'" /
// "next/font/google queries have exactly one entry", even though the
// identical config builds fine locally. The single variable-font request
// sidesteps that bug entirely and still supports every font-weight
// utility class used across the site (font-semibold, font-extrabold, etc.)
// since the variable font covers the full weight range.
const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["latin"],
  weight: "variable",
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
