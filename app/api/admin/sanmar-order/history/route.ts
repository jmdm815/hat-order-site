import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSanmarOrderStatuses, getSanmarShipmentsForOrder } from "@/lib/sanmar-services";

// GET /api/admin/sanmar-order/history[?days=30]  → recent SanMar orders + status
// GET /api/admin/sanmar-order/history?so=167551772 → tracking for one order
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const so = req.nextUrl.searchParams.get("so")?.trim();
  if (so) {
    const shipments = await getSanmarShipmentsForOrder(so);
    if (!shipments) return NextResponse.json({ error: "Couldn't reach SanMar" }, { status: 502 });
    return NextResponse.json({ so, shipments });
  }
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const orders = await getSanmarOrderStatuses(since);
  if (!orders) return NextResponse.json({ error: "Couldn't reach SanMar" }, { status: 502 });
  return NextResponse.json({ since, orders });
}
