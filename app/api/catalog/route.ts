import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/sanmar";
import { getCustomProductsForType } from "@/lib/custom-products-store";
import { getHiddenStyleNumbers } from "@/lib/catalog-selection";
import { getGarmentMarkupSettings } from "@/lib/garment-markup-store";
import { applyGarmentMarkupToProduct } from "@/lib/garment-markup";
import { ProductType } from "@/lib/types";

function parseProductType(raw: string | null): ProductType {
  if (raw === "shirt") return "shirt";
  if (raw === "tumbler") return "tumbler";
  if (raw === "polo") return "polo";
  return "hat";
}

export async function GET(req: NextRequest) {
  const productType = parseProductType(req.nextUrl.searchParams.get("type"));

  const [catalog, customProducts, hidden, garmentMarkup] = await Promise.all([
    getCatalog(productType),
    getCustomProductsForType(productType),
    getHiddenStyleNumbers(),
    getGarmentMarkupSettings(),
  ]);
  // Only SanMar-sourced catalog entries carry raw vendor cost — custom
  // (admin-added) products are already priced at their intended sell price
  // and must not be marked up again (see lib/garment-markup.ts).
  const markedCatalog = catalog.map((p) => applyGarmentMarkupToProduct(p, garmentMarkup.breakpoints));
  const visible = [...markedCatalog, ...customProducts].filter((p) => !hidden.has(p.styleNumber));
  return NextResponse.json(visible);
}
