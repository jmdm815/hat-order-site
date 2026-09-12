import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  createSetupCharge,
  deleteSetupCharge,
  getSetupCharges,
  updateSetupCharge,
} from "@/lib/setup-charges-store";
import { isPersistent } from "@/lib/pricing-store";
import { SetupChargeType } from "@/lib/types";

// Validates everything except `id`, which the store assigns on create and
// which callers must already know (and can't change) on update/delete.
function isValidChargeFields(value: unknown): value is Omit<SetupChargeType, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.label !== "string" || !c.label.trim()) return false;
  if (typeof c.price !== "number" || c.price < 0) return false;
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const setupCharges = await getSetupCharges();
  return NextResponse.json({ setupCharges, persistent: isPersistent() });
}

// Create a brand-new setup charge type. The store assigns the id (slugified
// from the label, de-duped if needed) — admins don't set it directly.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  if (!isValidChargeFields(body)) {
    return NextResponse.json({ error: "Invalid setup charge" }, { status: 400 });
  }
  const { charge, persisted } = await createSetupCharge(body);
  return NextResponse.json({ ok: true, charge, persisted });
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
  if (!isValidChargeFields(fields)) {
    return NextResponse.json({ error: "Invalid setup charge" }, { status: 400 });
  }
  const { charge, persisted } = await updateSetupCharge(id, fields);
  if (!charge) {
    return NextResponse.json({ error: "No setup charge with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, charge, persisted });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Expected ?id=" }, { status: 400 });
  }
  const { deleted, persisted } = await deleteSetupCharge(id);
  if (!deleted) {
    return NextResponse.json({ error: "No setup charge with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
