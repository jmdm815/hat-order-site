import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  createDecorationType,
  deleteDecorationType,
  getDecorationTypes,
  updateDecorationType,
} from "@/lib/decoration-types-store";
import { isPersistent } from "@/lib/pricing-store";
import { DecorationOption, ProductType } from "@/lib/types";

function isValidTier(
  t: unknown
): t is { minQty: number; pricePerUnit: number; pricesByColumn?: Record<string, number> } {
  if (typeof t !== "object" || t === null) return false;
  const tier = t as { minQty?: unknown; pricePerUnit?: unknown; pricesByColumn?: unknown };
  if (typeof tier.minQty !== "number" || typeof tier.pricePerUnit !== "number") return false;
  if (tier.pricesByColumn !== undefined) {
    if (typeof tier.pricesByColumn !== "object" || tier.pricesByColumn === null) return false;
    if (!Object.values(tier.pricesByColumn).every((v) => typeof v === "number")) return false;
  }
  return true;
}

function isValidPriceColumns(value: unknown): value is { id: string; label: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as { id?: unknown }).id === "string" &&
        typeof (c as { label?: unknown }).label === "string"
    )
  );
}

function isValidProductTypes(value: unknown): value is ProductType[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => v === "hat" || v === "shirt")
  );
}

// Validates everything except `id`, which the store assigns on create and
// which callers must already know (and can't change) on update/delete.
function isValidDecorationFields(
  value: unknown
): value is Omit<DecorationOption, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  if (typeof d.label !== "string" || !d.label.trim()) return false;
  if (typeof d.shortLabel !== "string" || !d.shortLabel.trim()) return false;
  if (typeof d.description !== "string") return false;
  if (!isValidProductTypes(d.productTypes)) return false;
  if (typeof d.minQuantity !== "number" || d.minQuantity < 0) return false;
  if (typeof d.setupFee !== "number" || d.setupFee < 0) return false;
  if (d.setupFeeEnabled !== undefined && typeof d.setupFeeEnabled !== "boolean") return false;
  if (!Array.isArray(d.pricingTiers) || !d.pricingTiers.length || !d.pricingTiers.every(isValidTier)) {
    return false;
  }
  if (d.priceColumns !== undefined && !isValidPriceColumns(d.priceColumns)) return false;
  if (d.quoteRequired !== undefined && typeof d.quoteRequired !== "boolean") return false;
  if (typeof d.turnaroundDays !== "string") return false;
  if (!Array.isArray(d.acceptedFileTypes) || !d.acceptedFileTypes.every((f) => typeof f === "string")) {
    return false;
  }
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const decorationTypes = await getDecorationTypes();
  return NextResponse.json({ decorationTypes, persistent: isPersistent() });
}

// Create a brand-new decoration type. The store assigns the id (slugified
// from the label, de-duped if needed) — admins don't set it directly.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  if (!isValidDecorationFields(body)) {
    return NextResponse.json({ error: "Invalid decoration type" }, { status: 400 });
  }
  const { decoration, persisted } = await createDecorationType(body);
  return NextResponse.json({ ok: true, decoration, persisted });
}

// Update an existing decoration type's fields (label/description,
// hat/shirt availability, accepted file types, turnaround, and pricing).
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
  if (!isValidDecorationFields(fields)) {
    return NextResponse.json({ error: "Invalid decoration type" }, { status: 400 });
  }
  const { decoration, persisted } = await updateDecorationType(id, fields);
  if (!decoration) {
    return NextResponse.json({ error: "No decoration type with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, decoration, persisted });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Expected ?id=" }, { status: 400 });
  }
  const { deleted, persisted } = await deleteDecorationType(id);
  if (!deleted) {
    return NextResponse.json({ error: "No decoration type with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
