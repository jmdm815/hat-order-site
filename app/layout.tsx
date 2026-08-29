import type { Metadata } from "next";
import { Geist, Geist_Mono, Oswald } from "next/font/google";
import "./globals.css";
import { OrderProvider } from "@/lib/order-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-navy">
        <OrderProvider>{children}</OrderProvider>
      </body>
    </html>
  );
}
