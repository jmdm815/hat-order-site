import { NextRequest, NextResponse } from "next/server";
import { getAltPhotos } from "@/lib/designer-photos";

export const runtime = "nodejs";

// Public: extra flat garment photos (S&S) for the customer designer.
// GET ?style=1717&brand=Comfort%20Colors -> { photos: { [colorKey]: { front, back } } }
export async function GET(req: NextRequest) {
  const style = req.nextUrl.searchParams.get("style")?.slice(0, 40) ?? "";
  const brand = req.nextUrl.searchParams.get("brand")?.slice(0, 80) ?? undefined;
  const photos = style ? await getAltPhotos(style, brand) : {};
  return NextResponse.json(
    { photos },
    { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400" } }
  );
}
