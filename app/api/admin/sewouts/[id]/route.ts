import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { deleteSewout, getSewout, updateSewout, SewoutFields } from "@/lib/sewouts-store";
import { itemPhotoUrl } from "@/lib/item-photo";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const record = await getSewout(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ record: { ...record, photoUrls: record.photos.map((p) => itemPhotoUrl(p.blobUrl)) } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Partial<SewoutFields> | null;
  if (!body || !body.customerName?.trim()) {
    return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
  }
  const { record, persisted } = await updateSewout(id, body);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record: { ...record, photoUrls: record.photos.map((p) => itemPhotoUrl(p.blobUrl)) }, persisted });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { deleted } = await deleteSewout(id);
  return NextResponse.json({ ok: deleted });
}
