import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getHiddenCatalogTypes, setHiddenCatalogTypes } from "@/lib/catalog-tabs-store";
import type { ProductType } from "@/lib/types";

// GET -> { hidden } ; PUT { hidden: ProductType[] } -> { hidden }
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ hidden: await getHiddenCatalogTypes() });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const hidden = Array.isArray(body.hidden) ? (body.hidden as ProductType[]) : [];
  return NextResponse.json({ hidden: await setHiddenCatalogTypes(hidden) });
}
