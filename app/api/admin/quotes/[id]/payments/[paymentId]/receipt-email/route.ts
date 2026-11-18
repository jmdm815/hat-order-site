import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
import { emailPaymentReceipt } from "@/lib/payment-receipt";
import { isReceiptEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { emails: [...], preview?: true } — emails ONE payment's receipt
// (receipt PDF with method + transaction ID, plus the invoice PDF showing
// the paid status). preview: true prefixes the subject with "[Preview]".
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isReceiptEmailConfigured()) {
    return NextResponse.json({ error: "Email isn't configured (RESEND_API_KEY)." }, { status: 503 });
  }
  const { id, paymentId } = await params;
  const record = await getQuote(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const emails: string[] = Array.isArray(body?.emails)
    ? [...new Set((body.emails as unknown[]).map((e) => String(e).trim().toLowerCase()))]
    : [];
  if (!emails.length || emails.some((e) => !EMAIL_RE.test(e))) {
    return NextResponse.json({ error: "Give one or more valid email addresses." }, { status: 400 });
  }
  try {
    await emailPaymentReceipt(record, paymentId, req.nextUrl.origin, emails, { preview: !!body?.preview });
    return NextResponse.json({ ok: true, sentTo: emails });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Payment not found" ? 404 : 500 });
  }
}
