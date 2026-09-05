import { NextRequest, NextResponse } from "next/server";
import { getDecorationTypes, getDecorationTypesForProduct } from "@/lib/decoration-types-store";
import { ProductType } from "@/lib/types";

// Customer-facing decoration list — the admin-editable decoration types from
// lib/decoration-types-store.ts. Pass ?productType=hat|shirt to filter to
// only the types offered on that product type.
export async function GET(req: NextRequest) {
  const productType = req.nextUrl.searchParams.get("productType") as ProductType | null;
  const decorations =
    productType === "hat" || productType === "shirt" || productType === "tumbler" || productType === "polo"
      ? await getDecorationTypesForProduct(productType)
      : await getDecorationTypes();
  return NextResponse.json(decorations);
}
