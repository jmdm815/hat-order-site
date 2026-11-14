import { NextResponse } from "next/server";
import { CATALOG_TYPES, getHiddenCatalogTypes } from "@/lib/catalog-tabs-store";

export const dynamic = "force-dynamic";

// Public: which catalog tabs to show customers -> { visible: ["hat", ...] }.
export async function GET() {
  const hidden = await getHiddenCatalogTypes();
  return NextResponse.json({ visible: CATALOG_TYPES.filter((t) => !hidden.includes(t)) });
}
