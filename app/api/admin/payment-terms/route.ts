import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  createPaymentTerm,
  deletePaymentTerm,
  getPaymentTerms,
  updatePaymentTerm,
} from "@/lib/payment-terms-store";
import { isPersistent } from "@/lib/pricing-store";
import { PaymentTermOption } from "@/lib/types";

function isValidTermFields(value: unknown): value is Omit<PaymentTermOption, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  if (typeof t.label !== "string" || !t.label.trim()) return false;
  if (typeof t.depositPercent !== "number" || t.depositPercent < 1 || t.depositPercent > 100) {
    return false;
  }
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const paymentTerms = await getPaymentTerms();
  return NextResponse.json({ paymentTerms, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  if (!isValidTermFields(body)) {
    return NextResponse.json({ error: "Invalid payment term" }, { status: 400 });
  }
  const { term, persisted } = await createPaymentTerm(body);
  return NextResponse.json({ ok: true, term, persisted });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const id: unknown = body?.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Expected { id: string, ...fields }" }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _ignored, ...fields } = body;
  if (!isValidTermFields(fields)) {
    return NextResponse.json({ error: "Invalid payment term" }, { status: 400 });
  }
  const { term, persisted } = await updatePaymentTerm(id, fields);
  if (!term) {
    return NextResponse.json({ error: "No payment term with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, term, persisted });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Expected ?id=" }, { status: 400 });
  }
  const { deleted, persisted } = await deletePaymentTerm(id);
  if (!deleted) {
    return NextResponse.json({ error: "No payment term with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
