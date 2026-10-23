import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { searchAnySanmarStyle } from "@/lib/sanmar";
import { searchSsStyles } from "@/lib/ssactivewear";
import { getCustomProducts } from "@/lib/custom-products-store";

export type ManualQuoteSearchResult = {
  styleNumber: string;
  name: string;
  brand: string;
  // Raw image URL — route through lib/product-image.ts's
  // productPreviewImageUrl before rendering (see AdminQuoteBuilder).
  imageUrl?: string;
};

// Admin-only, catalog-source-aware typeahead for the manual quote builder's
// "Product" field (components/AdminQuoteBuilder.tsx) — searches as the
// admin types a few characters of a style number or name, unlike the older
// exact-match-only /api/admin/quote/lookup. "sanmar" searches the *entire*
// raw SanMar feed (see lib/sanmar.ts's searchAnySanmarStyle — deliberately
// not limited to the site's curated Caps/T-Shirts/Polos categories, since a
// one-off customer order can call for any real SanMar blank). "custom"
// searches the admin's own hand-added products. "ss" (S&S Activewear) hits
// S&S's own live REST API directly (lib/ssactivewear.ts) on every search —
// unlike SanMar there's no pre-synced feed to query, since S&S's API is
// real-time already.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const catalog = req.nextUrl.searchParams.get("catalog") ?? "sanmar";
  if (!q) return NextResponse.json({ results: [] satisfies ManualQuoteSearchResult[] });

  if (catalog === "custom") {
    const products = await getCustomProducts();
    const ql = q.toLowerCase();
    const results: ManualQuoteSearchResult[] = products
      .filter(
        (p) =>
          p.styleNumber.toLowerCase().includes(ql) ||
          p.productName.toLowerCase().includes(ql) ||
          p.brandName.toLowerCase().includes(ql)
      )
      .slice(0, 20)
      .map((p) => ({
        styleNumber: p.styleNumber,
        name: p.productName,
        brand: p.brandName,
        imageUrl: p.heroImageUrl || p.colors?.[0]?.imageUrl || undefined,
      }));
    return NextResponse.json({ results });
  }

  if (catalog === "ss") {
    try {
      const matches = await searchSsStyles(q, 20);
      const results: ManualQuoteSearchResult[] = matches.map((m) => ({
        styleNumber: m.styleNumber,
        name: m.name,
        brand: m.brand,
        imageUrl: m.imageUrl,
      }));
      return NextResponse.json({ results });
    } catch (err) {
      console.error("GET /api/admin/quote/search-products: S&S search failed", err);
      return NextResponse.json({ results: [] satisfies ManualQuoteSearchResult[] });
    }
  }

  const matches = await searchAnySanmarStyle(q, 20);
  const results: ManualQuoteSearchResult[] = matches.map((m) => ({
    styleNumber: m.styleNumber,
    name: m.name,
    brand: m.brand,
    imageUrl: m.imageUrl,
  }));
  return NextResponse.json({ results });
}
