import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
import { createJobsFromQuote } from "@/lib/jobs-store";

export const runtime = "nodejs";

// Admin-only: "Send to Jobs" — the admin's own call on any saved quote or
// invoice (components/AdminSavedQuotesList.tsx), independent of its
// quote/invoice or payment status. Creates one production job per line item
// (lib/jobs-store.ts), assigned to that line's decoration type as its
// station. Safe to click more than once on the same record — only lines
// that don't already have a job from it get one; existing jobs' status/
// notes are left untouched.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (record.computed.lines.length === 0) {
    return NextResponse.json({ error: "This quote has no line items to send to production." }, { status: 400 });
  }

  const { created, skipped, persisted } = await createJobsFromQuote(
    record.id,
    record.quoteNumber,
    record.invoiceNumber,
    record.computed
  );

  return NextResponse.json({ created, skipped, persisted });
}
