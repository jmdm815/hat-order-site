import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuotes, recordInvoicePayment, updatePaymentDetails, type QuoteRecord } from "@/lib/quotes-store";
import { emailPaymentReceipt } from "@/lib/payment-receipt";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST — match one Chase "You received money with Zelle" alert to an
// invoice and record it (or attach the transaction number to a Zelle
// payment that was already entered by hand).
// Body: { amount, transactionId, memo?, sender?, sentOn?, previewTo?: [emails], dryRun? }
// Matching, in order:
//   1. transactionId already on some payment → "already-recorded" (no-op)
//   2. memo names an invoice/quote (INV-0017, QT-1044):
//        - it has a hand-entered Zelle payment of this amount with no
//          transaction number → "attached"
//        - otherwise, if its balance covers the amount → "recorded"
//   3. no memo: exactly one hand-entered Zelle payment of this amount with
//      no transaction number anywhere → "attached"; else exactly one open
//      invoice whose balance equals the amount (sender name breaks ties)
//      → "recorded"; else "ambiguous" / "no-match" (nothing changed).
// Transfers from the shop owner to himself are skipped unless the memo
// names an invoice.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cents = (n: number) => Math.round(n * 100);
const balanceOf = (r: QuoteRecord) => Math.round((r.computed.grandTotal - (r.amountPaid ?? 0)) * 100) / 100;
const label = (r: QuoteRecord) => r.invoiceNumber ?? r.quoteNumber ?? r.id;
const summary = (r: QuoteRecord) => ({
  id: r.id,
  number: label(r),
  customer: [r.computed.customerName, r.computed.customerCompany].filter(Boolean).join(" — "),
  total: r.computed.grandTotal,
  balance: balanceOf(r),
});

function docFromMemo(memo: string, all: QuoteRecord[]) {
  const inv = memo.match(/INV[\s#-]*0*(\d{1,6})/i);
  if (inv) {
    const n = Number(inv[1]);
    return all.find((r) => r.invoiceNumber && Number(r.invoiceNumber.replace(/\D/g, "")) === n) ?? null;
  }
  const qt = memo.match(/QT[\s#-]*0*(\d{1,6})/i);
  if (qt) {
    const n = Number(qt[1]);
    // A converted quote's payments live on its invoice.
    const q = all.find((r) => r.quoteNumber && Number(r.quoteNumber.replace(/\D/g, "")) === n) ?? null;
    if (q?.linkedInvoiceId) return all.find((r) => r.id === q.linkedInvoiceId) ?? q;
    return q;
  }
  return null;
}

function senderMatches(r: QuoteRecord, sender: string) {
  const words = norm(sender).split(" ").filter((w) => w.length > 2 && !["llc", "inc", "the", "services", "service", "company"].includes(w));
  const hay = norm(`${r.computed.customerName ?? ""} ${r.computed.customerCompany ?? ""}`);
  return words.some((w) => hay.includes(w));
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const amount = Number(b?.amount);
  const transactionId = typeof b?.transactionId === "string" ? b.transactionId.trim().slice(0, 60) : "";
  if (!(amount > 0) || !transactionId) {
    return NextResponse.json({ error: "amount and transactionId required" }, { status: 400 });
  }
  const memo = typeof b?.memo === "string" && !/^n\/?a$/i.test(b.memo.trim()) ? b.memo.trim() : "";
  const sender = typeof b?.sender === "string" ? b.sender.trim().replace(/\s*\.\s*$/, "") : "";
  const sentOn = typeof b?.sentOn === "string" ? b.sentOn.trim() : "";
  const dryRun = !!b?.dryRun;
  const previewTo: string[] = Array.isArray(b?.previewTo) ? b.previewTo.map(String) : [];

  const all = (await getQuotes()).filter((r) => !r.deletedAt);

  const dup = all.find((r) => r.payments?.some((p) => p.transactionId === transactionId));
  if (dup) return NextResponse.json({ status: "already-recorded", invoice: summary(dup) });

  const memoDoc = memo ? docFromMemo(memo, all) : null;
  if (!memoDoc && /jhairson\s+medina/i.test(sender)) {
    return NextResponse.json({ status: "skipped-self", reason: "Transfer from Jhairson Medina with no invoice in the memo." });
  }

  const unreferencedZelle = (r: QuoteRecord) =>
    (r.payments ?? []).find((p) => p.tender === "zelle" && !p.transactionId && cents(p.amount) === cents(amount));

  let action: { kind: "attach"; record: QuoteRecord; paymentId: string } | { kind: "record"; record: QuoteRecord } | null = null;
  let candidates: QuoteRecord[] = [];

  if (memoDoc) {
    const existing = unreferencedZelle(memoDoc);
    if (existing) action = { kind: "attach", record: memoDoc, paymentId: existing.id };
    else if (balanceOf(memoDoc) + 0.005 >= amount) action = { kind: "record", record: memoDoc };
    else
      return NextResponse.json({
        status: "memo-mismatch",
        reason: `Memo names ${label(memoDoc)} but its balance is $${balanceOf(memoDoc).toFixed(2)}.`,
        invoice: summary(memoDoc),
      });
  } else {
    const handEntered = all.filter((r) => unreferencedZelle(r));
    if (handEntered.length === 1) {
      action = { kind: "attach", record: handEntered[0], paymentId: unreferencedZelle(handEntered[0])!.id };
    } else {
      candidates = all.filter((r) => r.status === "invoice" && r.invoiceStatus !== "paid" && cents(balanceOf(r)) === cents(amount));
      if (candidates.length > 1 && sender) {
        const bySender = candidates.filter((r) => senderMatches(r, sender));
        if (bySender.length) candidates = bySender;
      }
      if (handEntered.length > 1 && !candidates.length) candidates = handEntered;
      if (candidates.length === 1 && candidates[0].status === "invoice" && !unreferencedZelle(candidates[0])) {
        action = { kind: "record", record: candidates[0] };
      }
    }
  }

  if (!action) {
    return NextResponse.json({
      status: candidates.length ? "ambiguous" : "no-match",
      candidates: candidates.map(summary),
    });
  }
  if (dryRun) {
    return NextResponse.json({ status: action.kind === "attach" ? "would-attach" : "would-record", invoice: summary(action.record) });
  }

  const note = [sender && `Zelle from ${sender}`, sentOn && `sent ${sentOn}`].filter(Boolean).join(", ") || undefined;
  let record: QuoteRecord | null;
  let paymentId: string;
  if (action.kind === "attach") {
    const r = await updatePaymentDetails(action.record.id, action.paymentId, { transactionId });
    record = r.record;
    paymentId = action.paymentId;
  } else {
    const r = await recordInvoicePayment(action.record.id, { amount, method: "manual", tender: "zelle", transactionId, note });
    record = r.record;
    paymentId = r.record?.payments?.find((p) => p.transactionId === transactionId)?.id ?? "";
  }
  if (!record || !paymentId) return NextResponse.json({ error: "Couldn't save the payment." }, { status: 500 });

  let previewSent: string[] = [];
  let previewError: string | undefined;
  if (previewTo.length) {
    try {
      await emailPaymentReceipt(record, paymentId, req.nextUrl.origin, previewTo, { preview: true });
      previewSent = previewTo;
    } catch (e) {
      previewError = (e as Error).message;
    }
  }
  return NextResponse.json({
    status: action.kind === "attach" ? "attached" : "recorded",
    invoice: summary(record),
    paymentId,
    receiptUrl: `${req.nextUrl.origin}/api/pay/${record.id}/payments/${paymentId}/receipt-pdf`,
    previewSent,
    previewError,
  });
}
