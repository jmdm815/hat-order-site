import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
import { getSanmarOrder, saveSanmarOrder, mergeItems, SanmarOrderItem, SanmarOrderList } from "@/lib/sanmar-order-store";
import type { QuoteLineInput } from "@/lib/quote";

// GET  /api/admin/sanmar-order            → the working SanMar order list
// PUT  /api/admin/sanmar-order            → replace it ({ items, status?, note? })
// POST /api/admin/sanmar-order            → { action: "add-quotes", quoteIds: [...] } merges those
//                                           quotes' SanMar garments in; { action: "add-items", items }
//                                           adds hand-picked rows; { action: "clear" } empties it.

function isSanmarLine(l: QuoteLineInput): boolean {
  if (l.customerSupplied || !l.styleNumber || !l.colorName) return false;
  return !l.catalogSource || l.catalogSource === "sanmar";
}

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ order: await getSanmarOrder() });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) return NextResponse.json({ error: "items[] required" }, { status: 400 });
  const current = await getSanmarOrder();
  const next: SanmarOrderList = {
    ...current,
    items: body.items as SanmarOrderItem[],
    status: body.status === "in-shopping-box" ? "in-shopping-box" : body.status === "draft" ? "draft" : current.status,
    addedToBoxAt: body.status === "in-shopping-box" ? new Date().toISOString() : body.status === "draft" ? undefined : current.addedToBoxAt,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : current.note,
  };
  return NextResponse.json(await saveSanmarOrder(next));
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const current = await getSanmarOrder();

  if (body?.action === "clear") {
    return NextResponse.json(await saveSanmarOrder({ items: [], status: "draft", updatedAt: "" }));
  }

  if (body?.action === "add-items" && Array.isArray(body.items)) {
    const items = mergeItems([...current.items, ...(body.items as SanmarOrderItem[]).map((i) => ({ ...i, sources: [] }))]);
    return NextResponse.json(await saveSanmarOrder({ ...current, items, status: "draft" }));
  }

  if (body?.action === "add-quotes" && Array.isArray(body.quoteIds)) {
    const added: SanmarOrderItem[] = [];
    const skipped: string[] = [];
    for (const id of body.quoteIds.slice(0, 30) as string[]) {
      const q = await getQuote(String(id));
      if (!q) {
        skipped.push(String(id));
        continue;
      }
      const label = [q.invoiceNumber || q.quoteNumber, q.computed.customerCompany || q.computed.customerName]
        .filter(Boolean)
        .join(" · ");
      // Don't add the same quote twice.
      if (current.items.some((i) => i.sources.some((s) => s.quoteId === q.id))) {
        skipped.push(label);
        continue;
      }
      for (const line of q.input.lines.filter(isSanmarLine)) {
        for (const s of line.sizes) {
          const qty = Math.round(Number(s.quantity) || 0);
          if (qty <= 0) continue;
          added.push({
            style: line.styleNumber!,
            color: line.colorName!,
            size: s.size,
            qty,
            sources: [{ quoteId: q.id, label, qty }],
          });
        }
      }
    }
    const result = await saveSanmarOrder({ ...current, items: [...current.items, ...added], status: "draft" });
    return NextResponse.json({ ...result, addedRows: added.length, skipped });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
