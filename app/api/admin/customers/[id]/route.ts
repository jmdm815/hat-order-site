import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { updateCustomer, deleteCustomer, CustomerInput } from "@/lib/customers-store";

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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const input = parseInput(await req.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
  }
  const { customer, persisted } = await updateCustomer(id, input);
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, customer, persisted });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { id } = await params;
  const { deleted, persisted } = await deleteCustomer(id);
  if (!deleted) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
