import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, recordInvoicePayment } from "@/lib/quotes-store";
import { cardKeyForRecord, cardLabel, chargeSavedCard, getSavedCards } from "@/lib/saved-cards-store";
import { isSquareConfigured } from "@/lib/square-client";

export const runtime = "nodejs";

// GET  /api/admin/quotes/[id]/saved-cards — cards on file for this record's customer.
// POST /api/admin/quotes/[id]/saved-cards {cardId, amount} — charge one
//      (the customer asked you to "run the saved card").
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const record = await getQuote((await params).id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const cards = await getSavedCards(cardKeyForRecord(record));
  return NextResponse.json({ cards: cards.map((c) => ({ ...c, label: cardLabel(c) })) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSquareConfigured()) return NextResponse.json({ error: "Square isn't set up on this deployment." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { cardId?: string; amount?: number };
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const balance = Math.round((record.computed.grandTotal - (record.amountPaid ?? 0)) * 100) / 100;
  if (!body.cardId) return NextResponse.json({ error: "Pick a saved card." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  if (amount > balance + 0.02) return NextResponse.json({ error: `That's more than the balance of $${balance.toFixed(2)}.` }, { status: 400 });
  try {
    const note = record.invoiceNumber ? `Invoice ${record.invoiceNumber}` : `Quote ${record.quoteNumber ?? id.slice(0, 8)}`;
    const { paymentId, card } = await chargeSavedCard(record, body.cardId, amount, note);
    const { record: updated } = await recordInvoicePayment(id, {
      amount,
      method: "square_card",
      squarePaymentId: paymentId,
      note: `Saved card ${cardLabel(card)} (charged from admin)`,
    });
    return NextResponse.json({ ok: true, record: updated });
  } catch (err) {
    console.error(`charge saved card ${id} failed`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Charge failed" }, { status: 400 });
  }
}
