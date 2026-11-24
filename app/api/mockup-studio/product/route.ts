import { NextRequest, NextResponse } from "next/server";
import { loadProduct } from "@/lib/auto-mockup";
import { corsHeaders, preflight } from "@/lib/mockup-studio";
import { productPreviewImageUrl } from "@/lib/product-image";

export const runtime = "nodejs";
export const OPTIONS = preflight;

// Public: one style's colors (name, swatch, photo) — no prices or inventory.
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  const style = req.nextUrl.searchParams.get("style")?.trim() ?? "";
  const source = req.nextUrl.searchParams.get("source") ?? "auto";
  if (!style) return NextResponse.json({ error: "Missing style" }, { status: 400, headers });
  const p = await loadProduct(style, source).catch(() => null);
  if (!p) return NextResponse.json({ error: "Style not found" }, { status: 404, headers });
  return NextResponse.json(
    {
      product: {
        styleNumber: p.styleNumber,
        name: `${p.brandName} ${p.productName}`.trim(),
        hat: p.productType === "hat",
        colors: p.colors.map((c) => ({ name: c.colorName, hexes: c.colorHexes, image: productPreviewImageUrl(c.imageUrl, c.imageFallbackUrl) })),
      },
    },
    { headers: { ...headers, "Cache-Control": "public, max-age=600" } }
  );
}
