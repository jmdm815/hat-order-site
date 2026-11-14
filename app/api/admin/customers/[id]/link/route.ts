import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers } from "@/lib/customers-store";
import { setQuoteCustomerId } from "@/lib/quotes-store";

// POST { recordId, unlink? } — link a quote/invoice to this customer (or
// remove an explicit link with unlink: true).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const recordId = typeof body.recordId === "string" ? body.recordId : "";
  if (!recordId) return NextResponse.json({ error: "recordId is required" }, { status: 400 });
  if (!(await getCustomers()).some((c) => c.id === id)) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  const { record, persisted } = await setQuoteCustomerId(recordId, body.unlink ? null : id);
  if (!record) return NextResponse.json({ error: "Quote/invoice not found" }, { status: 404 });
  return NextResponse.json({ ok: true, persisted });
}
