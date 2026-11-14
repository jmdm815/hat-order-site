import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers } from "@/lib/customers-store";
import { getQuotes } from "@/lib/quotes-store";
import { ownerOf } from "@/lib/customer-match";

// GET -> { owners: { [recordId]: { id, name } } } — which customer page each
// quote/invoice belongs to, so list rows can link the customer name.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const [customers, records] = await Promise.all([getCustomers(), getQuotes()]);
  const owners: Record<string, { id: string; name: string }> = {};
  for (const r of records) {
    const c = ownerOf(r, customers);
    if (c) owners[r.id] = { id: c.id, name: c.name };
  }
  return NextResponse.json({ owners });
}
