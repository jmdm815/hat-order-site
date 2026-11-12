import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSanmarInventory } from "@/lib/sanmar-services";
import { getLiveSanmarPricing, livePriceResolver } from "@/lib/sanmar-pricing";
import { sizeRank } from "@/lib/sanmar-order-store";

// GET /api/admin/sanmar-order/lookup?style=K540[&color=Black]
// Colors for a style, plus — for the chosen color — each size's live account
// cost and stock by warehouse (Dallas first).
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const style = req.nextUrl.searchParams.get("style")?.trim().toUpperCase();
  if (!style) return NextResponse.json({ error: "style is required" }, { status: 400 });
  const color = req.nextUrl.searchParams.get("color")?.trim() || undefined;

  const [parts, priceRows] = await Promise.all([getSanmarInventory(style), getLiveSanmarPricing(style)]);
  if (!parts) return NextResponse.json({ error: `Couldn't get ${style} from SanMar. Check the style number.` }, { status: 502 });

  const colors = Array.from(new Set(parts.map((p) => p.color))).sort((a, b) => a.localeCompare(b));
  const resolve = priceRows ? livePriceResolver(priceRows, colors) : null;
  const chosen = color ? colors.find((c) => c.toLowerCase() === color.toLowerCase()) : undefined;

  const sizes = chosen
    ? parts
        .filter((p) => p.color === chosen)
        .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))
        .map((p) => {
          const cost = resolve?.(chosen, p.size);
          const dallas = p.warehouses.find((w) => w.name === "Dallas")?.qty ?? 0;
          return {
            size: p.size,
            cost: cost ?? null,
            costSource: cost ? "live" : "unavailable",
            total: p.total,
            dallas,
            warehouses: [...p.warehouses].sort((a, b) => (a.name === "Dallas" ? -1 : b.name === "Dallas" ? 1 : b.qty - a.qty)),
          };
        })
    : [];

  return NextResponse.json({ style, colors, color: chosen ?? null, sizes, priced: Boolean(priceRows) });
}
