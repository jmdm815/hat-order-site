import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers } from "@/lib/customers-store";
import { getQuote } from "@/lib/quotes-store";
import { ownerOf } from "@/lib/customer-match";

// GET ?recordId= -> { customer: {id, name} | null } — the customer page a quote/invoice belongs to.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const recordId = req.nextUrl.searchParams.get("recordId") ?? "";
  const record = recordId ? await getQuote(recordId) : undefined;
  if (!record) return NextResponse.json({ customer: null });
  const c = ownerOf(record, await getCustomers());
  return NextResponse.json({ customer: c ? { id: c.id, name: c.name } : null });
}
