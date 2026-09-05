import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/sanmar";
import { getCustomProductsForType } from "@/lib/custom-products-store";
import { getHiddenStyleNumbers } from "@/lib/catalog-selection";
import { ProductType } from "@/lib/types";

function parseProductType(raw: string | null): ProductType {
  if (raw === "shirt") return "shirt";
  if (raw === "tumbler") return "tumbler";
  if (raw === "polo") return "polo";
  return "hat";
}

export async function GET(req: NextRequest) {
  const productType = parseProductType(req.nextUrl.searchParams.get("type"));

  const [catalog, customProducts, hidden] = await Promise.all([
    getCatalog(productType),
    getCustomProductsForType(productType),
    getHiddenStyleNumbers(),
  ]);
  const visible = [...catalog, ...customProducts].filter((p) => !hidden.has(p.styleNumber));
  return NextResponse.json(visible);
}
