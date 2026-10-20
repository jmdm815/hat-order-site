import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getCustomers, createCustomer, deleteCustomers, CustomerInput } from "@/lib/customers-store";
import { isPersistent } from "@/lib/pricing-store";

function parseInput(body: unknown): CustomerInput | null {
  const b = body as Record<string, unknown> | null;
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (!name) return null;
  const depositPercent = typeof b?.defaultDepositPercent === "number" ? b.defaultDepositPercent : undefined;
  return {
    name,
    company: typeof b?.company === "string" ? b.company.trim() : undefined,
    email: typeof b?.email === "string" ? b.email.trim() : undefined,
    phone: typeof b?.phone === "string" ? b.phone.trim() : undefined,
    notes: typeof b?.notes === "string" ? b.notes.trim() : undefined,
    defaultDepositPercent:
      depositPercent !== undefined && depositPercent > 0 && depositPercent <= 100 ? depositPercent : undefined,
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

// Bulk delete — the "select several, then delete" flow in
// components/AdminCustomersManager.tsx (which also covers "select all" +
// delete, i.e. delete every customer). Body: { ids: string[] }. Deleting a
// single customer still goes through DELETE /api/admin/customers/[id].
export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "No customer ids provided" }, { status: 400 });
  }
  const { deletedCount, persisted } = await deleteCustomers(ids);
  return NextResponse.json({ ok: true, deletedCount, persisted });
}
