import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
import {
  applyCommission,
  deleteSpecialInvoice,
  getSpecialInvoice,
  updateSpecialInvoice,
  type SpecialInvoice,
} from "@/lib/special-invoices-store";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
const withSummary = (si: SpecialInvoice) => ({ ...si, summary: applyCommission(si.source, si.commissionPercent).summary });

export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const si = await getSpecialInvoice((await params).id);
  if (!si) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ invoice: withSummary(si), computed: applyCommission(si.source, si.commissionPercent).computed });
}

// Body: any of { commissionPercent, date, status, notes, showCommissionNote, refreshFromSource: true }
export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const id = (await params).id;
  const si = await getSpecialInvoice(id);
  if (!si) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<SpecialInvoice> = {};
  if (b.commissionPercent !== undefined) {
    const pct = Number(b.commissionPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return NextResponse.json({ error: "Commission must be 0-100%" }, { status: 400 });
    patch.commissionPercent = pct;
  }
  if (typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) patch.date = b.date;
  if (b.status === "paid" || b.status === "unpaid") patch.status = b.status;
  if (b.terms === "source" || b.terms === "due-on-receipt") patch.terms = b.terms;
  if (typeof b.notes === "string") patch.notes = b.notes.trim() || undefined;
  if (typeof b.showCommissionNote === "boolean") patch.showCommissionNote = b.showCommissionNote;
  if (b.refreshFromSource === true) {
    const record = await getQuote(si.sourceId);
    if (!record) return NextResponse.json({ error: "The original invoice no longer exists" }, { status: 404 });
    patch.source = record.computed;
    patch.sourceNumber = record.invoiceNumber ?? record.quoteNumber ?? si.sourceNumber;
  }
  const updated = await updateSpecialInvoice(id, patch);
  return NextResponse.json({ invoice: withSummary(updated!) });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  await deleteSpecialInvoice((await params).id);
  return NextResponse.json({ ok: true });
}
