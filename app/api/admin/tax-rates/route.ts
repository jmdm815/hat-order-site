import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createTaxRate, deleteTaxRate, getTaxRates, updateTaxRate } from "@/lib/tax-rates-store";
import { isPersistent } from "@/lib/pricing-store";
import { TaxRateOption } from "@/lib/types";

function isValidRateFields(value: unknown): value is Omit<TaxRateOption, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  if (typeof t.label !== "string" || !t.label.trim()) return false;
  if (typeof t.ratePercent !== "number" || t.ratePercent < 0 || t.ratePercent > 100) return false;
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const taxRates = await getTaxRates();
  return NextResponse.json({ taxRates, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  if (!isValidRateFields(body)) {
    return NextResponse.json({ error: "Invalid tax rate" }, { status: 400 });
  }
  const { rate, persisted } = await createTaxRate(body);
  return NextResponse.json({ ok: true, rate, persisted });
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
  if (!isValidRateFields(fields)) {
    return NextResponse.json({ error: "Invalid tax rate" }, { status: 400 });
  }
  const { rate, persisted } = await updateTaxRate(id, fields);
  if (!rate) {
    return NextResponse.json({ error: "No tax rate with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, rate, persisted });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Expected ?id=" }, { status: 400 });
  }
  const { deleted, persisted } = await deleteTaxRate(id);
  if (!deleted) {
    return NextResponse.json({ error: "No tax rate with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
