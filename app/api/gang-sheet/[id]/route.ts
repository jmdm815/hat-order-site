import { NextRequest, NextResponse, after } from "next/server";
import { getSheet } from "@/lib/gang-sheet-store";
import { renderSheet } from "@/lib/gang-sheet-render";

export const maxDuration = 300;

// Public status for a sheet (the id is an unguessable UUID).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rec = await getSheet((await params).id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A render that died (timeout/crash) — retry once it's clearly stale.
  if (rec.status === "rendering" && Date.now() - Date.parse(rec.createdAt) > 6 * 60 * 1000) after(() => renderSheet(rec));
  return NextResponse.json({
    id: rec.id, number: rec.number, mode: rec.mode, lengthIn: rec.lengthIn, quantity: rec.quantity, price: rec.price,
    status: rec.status, error: rec.error, designs: rec.items.length, createdAt: rec.createdAt, renderedAt: rec.renderedAt,
  });
}
