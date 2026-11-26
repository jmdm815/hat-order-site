import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/shop/Cart";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://buyjmmedia.com"),
  title: "JM Digital Media — Custom embroidery & printing for businesses | Rosenberg, TX",
  description:
    "Embroidered polos, hats and jackets, DTF and screen printed shirts, and UV printed patches and tumblers for contractors, trades, schools and local businesses. Made in Rosenberg, TX.",
  openGraph: {
    title: "JM Digital Media — Branded gear for businesses",
    description: "Embroidery, DTF and screen printing, and UV printing for crews, teams and storefronts. Rosenberg, TX.",
    images: ["/img/crew-back.webp"],
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#1d2b4f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
