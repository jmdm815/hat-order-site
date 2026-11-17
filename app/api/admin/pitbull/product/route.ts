import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getPitbullPrices, getPitbullProduct } from "@/lib/pitbull";

export const runtime = "nodejs";

// GET /api/admin/pitbull/product?style=PB311 → product + JM's saved wholesale price
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const style = req.nextUrl.searchParams.get("style")?.trim();
  if (!style) return NextResponse.json({ error: "style required" }, { status: 400 });
  try {
    const product = await getPitbullProduct(style);
    if (!product) return NextResponse.json({ error: `No Pitbull Cap style "${style}" found.` }, { status: 404 });
    const prices = await getPitbullPrices();
    return NextResponse.json({ product, wholesale: prices.byStyle[product.style] ?? null });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't reach pitbullcap.com: ${(e as Error).message}` }, { status: 502 });
  }
}
