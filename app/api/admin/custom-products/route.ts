import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  createCustomProduct,
  deleteCustomProduct,
  getCustomProducts,
  updateCustomProduct,
} from "@/lib/custom-products-store";
import { isPersistent } from "@/lib/pricing-store";
import { Product, ProductSize, ProductType } from "@/lib/types";

function isValidProductType(value: unknown): value is ProductType {
  return value === "hat" || value === "shirt" || value === "tumbler";
}

function isValidSize(v: unknown): v is ProductSize {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    s.name.trim().length > 0 &&
    typeof s.price === "number" &&
    s.price >= 0 &&
    typeof s.inventory === "number"
  );
}

function isValidColor(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.colorName !== "string" || !c.colorName.trim()) return false;
  if (!Array.isArray(c.colorHexes) || !c.colorHexes.every((h) => typeof h === "string")) return false;
  if (typeof c.imageUrl !== "string" || !c.imageUrl) return false;
  if (c.sizes !== undefined && (!Array.isArray(c.sizes) || !c.sizes.every(isValidSize))) return false;
  return true;
}

// Validates everything except styleNumber/isCustom, which the store assigns
// on create and callers can't change on update/delete.
function isValidProductFields(value: unknown): value is Omit<Product, "styleNumber" | "isCustom"> {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.productName !== "string" || !p.productName.trim()) return false;
  if (typeof p.brandName !== "string") return false;
  if (typeof p.description !== "string") return false;
  if (!isValidProductType(p.productType)) return false;
  if (typeof p.category !== "string" || !p.category.trim()) return false;
  if (typeof p.basePrice !== "number" || p.basePrice < 0) return false;
  if (!Array.isArray(p.colors) || !p.colors.length || !p.colors.every(isValidColor)) return false;
  if (typeof p.heroImageUrl !== "string" || !p.heroImageUrl) return false;
  return true;
}

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const products = await getCustomProducts();
  return NextResponse.json({ products, persistent: isPersistent() });
}

// Create a brand-new custom product. The store assigns a generated
// styleNumber (custom-<id>) — admins don't set it directly.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body: unknown = await req.json();
  // Optional: the admin UI generates a "custom-..." id up front so it can
  // upload photos keyed by that id before the product itself exists — pass
  // it through so the saved product matches the already-uploaded photos.
  const styleNumberHint =
    typeof (body as { styleNumber?: unknown })?.styleNumber === "string"
      ? (body as { styleNumber: string }).styleNumber
      : undefined;
  if (!isValidProductFields(body)) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }
  const { product, persisted } = await createCustomProduct({ ...body, styleNumber: styleNumberHint });
  return NextResponse.json({ ok: true, product, persisted });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const styleNumber: unknown = body?.styleNumber;
  if (typeof styleNumber !== "string" || !styleNumber) {
    return NextResponse.json({ error: "Expected { styleNumber: string, ...fields }" }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { styleNumber: _ignored, ...fields } = body;
  if (!isValidProductFields(fields)) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }
  const { product, persisted } = await updateCustomProduct(styleNumber, fields);
  if (!product) {
    return NextResponse.json({ error: "No custom product with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, product, persisted });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const styleNumber = req.nextUrl.searchParams.get("id");
  if (!styleNumber) {
    return NextResponse.json({ error: "Expected ?id=" }, { status: 400 });
  }
  const { deleted, persisted } = await deleteCustomProduct(styleNumber);
  if (!deleted) {
    return NextResponse.json({ error: "No custom product with that id" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
