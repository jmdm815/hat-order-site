import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers, createCustomer, CustomerInput } from "@/lib/customers-store";
import { isPersistent } from "@/lib/pricing-store";

function parseInput(body: unknown): CustomerInput | null {
  const b = body as Record<string, unknown> | null;
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (!name) return null;
  return {
    name,
    company: typeof b?.company === "string" ? b.company.trim() : undefined,
    email: typeof b?.email === "string" ? b.email.trim() : undefined,
    phone: typeof b?.phone === "string" ? b.phone.trim() : undefined,
    notes: typeof b?.notes === "string" ? b.notes.trim() : undefined,
  };
}

// GET: list every customer (search is done client-side — this list is
// expected to stay small enough that fetching it all once is fine, same
// assumption as lib/categories-store.ts). POST: add a new one.
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const customers = await getCustomers();
  return NextResponse.json({ customers, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const input = parseInput(await req.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
  }
  const { customer, persisted } = await createCustomer(input);
  return NextResponse.json({ ok: true, customer, persisted });
}
