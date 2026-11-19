import { NextRequest, NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { getAnySanmarStyleAsProduct } from "@/lib/sanmar";
import { getSsStyleAsProduct } from "@/lib/ssactivewear";

// GET /api/partner/product?source=sanmar|ss&style= — one style with its
// colors, photos, sizes and stock. Supplier list prices are stripped; the
// partner gets prices only from /api/partner/price.
export async function GET(req: NextRequest) {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const style = req.nextUrl.searchParams.get("style")?.trim() ?? "";
  const source = req.nextUrl.searchParams.get("source");
  if (!style) return NextResponse.json({ error: "Missing style" }, { status: 400 });
  try {
    const p = source === "ss" ? await getSsStyleAsProduct(style) : await getAnySanmarStyleAsProduct(style);
    if (!p) return NextResponse.json({ error: "Style not found" }, { status: 404 });
    const product = {
      ...p,
      basePrice: 0,
      colors: p.colors.map((c) => ({
        ...c,
        sizes: c.sizes?.map((s) => ({ name: s.name, inventory: (s as { inventory?: number }).inventory })),
      })),
    };
    return NextResponse.json({ product });
  } catch (err) {
    console.error("partner product: load failed", err);
    return NextResponse.json({ error: "Couldn't load that style from the supplier" }, { status: 502 });
  }
}
