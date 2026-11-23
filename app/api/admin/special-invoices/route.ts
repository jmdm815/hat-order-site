import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
import { applyCommission, createSpecialInvoice, getSpecialInvoices } from "@/lib/special-invoices-store";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const invoices = (await getSpecialInvoices()).map((si) => ({
    ...si,
    summary: applyCommission(si.source, si.commissionPercent).summary,
  }));
  return NextResponse.json({ invoices });
}

// Body: { sourceId, commissionPercent?, date?, notes?, showCommissionNote? }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sourceId = typeof b.sourceId === "string" ? b.sourceId : "";
  const record = sourceId ? await getQuote(sourceId) : undefined;
  if (!record) return NextResponse.json({ error: "Pick the invoice or quote to copy" }, { status: 400 });
  const pct = b.commissionPercent === undefined ? 30 : Number(b.commissionPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return NextResponse.json({ error: "Commission must be 0-100%" }, { status: 400 });
  const date =
    typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date)
      ? b.date
      : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const si = await createSpecialInvoice({
    date,
    sourceId: record.id,
    sourceNumber: record.invoiceNumber ?? record.quoteNumber ?? undefined,
    commissionPercent: pct,
    showCommissionNote: b.showCommissionNote !== false,
    status: "unpaid",
    terms: b.terms === "source" ? "source" : "due-on-receipt",
    notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : undefined,
    source: record.computed,
  });
  return NextResponse.json({ invoice: { ...si, summary: applyCommission(si.source, si.commissionPercent).summary } });
}
