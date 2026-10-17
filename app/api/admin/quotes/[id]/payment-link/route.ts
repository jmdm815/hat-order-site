import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { isSquareConfigured } from "@/lib/square-client";
import { createInvoicePaymentLink, SquareNotConfiguredError } from "@/lib/square-payment-links";
import { getQuote, setInvoicePaymentLink } from "@/lib/quotes-store";

// Admin-only: creates (or re-creates) a Square-hosted "Pay online" link for
// an invoice's current total and saves it onto the record. Mirrors
// app/api/admin/quotes/[id]/payment/route.ts's shape. POST again any time to
// get a fresh link (e.g. after the invoice's total changed) — Square links
// don't need to be explicitly revoked first, the old one just stops being
// the one shown to the customer.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSquareConfigured()) {
    return NextResponse.json(
      {
        error:
          "Square isn't configured yet. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in the site's environment variables to enable online payment links.",
      },
      { status: 503 }
    );
  }

  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (record.status !== "invoice") {
    return NextResponse.json(
      { error: "Convert this quote to an invoice before creating a payment link" },
      { status: 400 }
    );
  }

  try {
    const link = await createInvoicePaymentLink(record);
    const { record: updated, persisted } = await setInvoicePaymentLink(id, link);
    if (!updated) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, record: updated, persisted });
  } catch (err) {
    if (err instanceof SquareNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("POST /api/admin/quotes/[id]/payment-link failed", err);
    return NextResponse.json({ error: "Failed to create Square payment link" }, { status: 500 });
  }
}
