import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  getCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  reorderCategories,
} from "@/lib/categories-store";
import { isPersistent } from "@/lib/pricing-store";

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const categories = await getCategories();
  return NextResponse.json({ categories, persistent: isPersistent() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Category name is required" }, { status: 400 });
  }
  const { category, persisted } = await createCategory(name);
  return NextResponse.json({ ok: true, category, persisted });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (Array.isArray(body?.order)) {
    const result = await reorderCategories(body.order.filter((x: unknown) => typeof x === "string"));
    return NextResponse.json({ ok: true, ...result });
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!id || !name) {
    return NextResponse.json({ error: "Expected { id, name } or { order: string[] }" }, { status: 400 });
  }
  const { category, persisted } = await renameCategory(id, name);
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, category, persisted });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const { deleted, persisted } = await deleteCategory(id);
  if (!deleted) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
