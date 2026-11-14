import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { isAdminAuthed } from "@/lib/admin-auth";
import { setCustomerContacts } from "@/lib/customers-store";
import type { CustomerContact } from "@/lib/types";

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

// PUT { contacts: [{ id?, name, role?, email?, phone?, notes? }] } — replaces
// the customer's extra contacts (the primary contact is the customer itself).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.contacts)) return NextResponse.json({ error: "contacts must be a list" }, { status: 400 });
  const contacts: CustomerContact[] = [];
  for (const raw of body.contacts.slice(0, 50)) {
    const name = str(raw?.name, 120);
    if (!name) return NextResponse.json({ error: "Every contact needs a name" }, { status: 400 });
    contacts.push({
      id: str(raw?.id, 60) ?? uuid(),
      name,
      role: str(raw?.role, 80),
      email: str(raw?.email, 200),
      phone: str(raw?.phone, 40),
      notes: str(raw?.notes, 500),
    });
  }
  const { customer, persisted } = await setCustomerContacts(id, contacts);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json({ ok: true, customer, persisted });
}
