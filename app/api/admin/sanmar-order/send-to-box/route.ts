import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSanmarOrder, saveSanmarOrder } from "@/lib/sanmar-order-store";
import { getSanmarInventory } from "@/lib/sanmar-services";
import { addToShoppingBox, BoxItem } from "@/lib/sanmar-web";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/sanmar-order/send-to-box
// Puts the current SanMar order list into the sanmar.com shopping box using
// the server's own SanMar sign-in (no one needs to be signed in). Dallas first;
// a size Dallas can't cover comes from the warehouse with the most. Never
// checks out. On success the list is marked "in shopping box". ?dry=1 runs
// everything but blocks the final submit (nothing is added).
export async function POST(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const order = await getSanmarOrder();
  if (order.status === "in-shopping-box" && !dryRun) {
    return NextResponse.json({ error: "This list is already in the shopping box. Switch it back to draft to send it again." }, { status: 409 });
  }
  const items: BoxItem[] = order.items.filter((i) => i.qty > 0).map(({ style, color, size, qty }) => ({ style, color, size, qty }));
  if (!items.length) return NextResponse.json({ error: "The order list is empty." }, { status: 400 });

  // Warehouse choice from live inventory.
  const stock = new Map<string, { name: string; qty: number }[]>();
  for (const style of Array.from(new Set(items.map((i) => i.style.toUpperCase())))) {
    const parts = await getSanmarInventory(style);
    for (const p of parts ?? []) stock.set(`${style}|${p.color.toLowerCase()}|${p.size.toUpperCase()}`, p.warehouses);
  }
  const warehouseFor = (it: BoxItem) => {
    const whs = stock.get(`${it.style.toUpperCase()}|${it.color.toLowerCase()}|${it.size.toUpperCase()}`);
    if (!whs) return "Dallas";
    const dallas = whs.find((w) => w.name === "Dallas");
    if (dallas && dallas.qty >= it.qty) return "Dallas";
    const best = [...whs].sort((a, b) => b.qty - a.qty)[0];
    return best && best.qty >= it.qty ? best.name : "Dallas";
  };

  const result = await addToShoppingBox(items, warehouseFor, { dryRun });
  if (result.ok && !dryRun) {
    await saveSanmarOrder({ ...order, status: "in-shopping-box", addedToBoxAt: new Date().toISOString() });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
