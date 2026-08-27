import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/sanmar";
import { getHiddenStyleNumbers } from "@/lib/catalog-selection";
import { ProductType } from "@/lib/types";

export async function GET(req: NextRequest) {
  const typeParam = req.nextUrl.searchParams.get("type");
  const productType: ProductType = typeParam === "shirt" ? "shirt" : "hat";

  const [catalog, hidden] = await Promise.all([
    getCatalog(productType),
    getHiddenStyleNumbers(),
  ]);
  const visible = catalog.filter((p) => !hidden.has(p.styleNumber));
  return NextResponse.json(visible);
}
