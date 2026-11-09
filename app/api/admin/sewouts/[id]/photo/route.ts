import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSewout, setSewoutPhotos } from "@/lib/sewouts-store";
import { itemPhotoUrl } from "@/lib/item-photo";
import { MAX_SEWOUT_UPLOAD_BYTES, storeSewoutPhoto } from "../../photo-util";

export const runtime = "nodejs";

const withUrls = <T extends { photos: { blobUrl: string }[] }>(r: T) => ({ ...r, photoUrls: r.photos.map((p) => itemPhotoUrl(p.blobUrl)), coverUrl: (r as { coverBlobUrl?: string }).coverBlobUrl ? itemPhotoUrl((r as { coverBlobUrl?: string }).coverBlobUrl!) : undefined });

// POST multipart "photo": adds a photo to this sew-out (max 6).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await getSewout(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.photos.length >= 6) return NextResponse.json({ error: "Up to 6 photos per sew-out" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing photo" }, { status: 400 });
  if (file.size > MAX_SEWOUT_UPLOAD_BYTES) return NextResponse.json({ error: "Photo is too large (15MB max)" }, { status: 400 });
  const blobUrl = await storeSewoutPhoto(file, id);
  const { record } = await setSewoutPhotos(id, [...existing.photos, { blobUrl, addedAt: new Date().toISOString() }]);
  return NextResponse.json({ ok: true, record: record && withUrls(record) });
}

// DELETE ?index=N — removes one photo.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const index = Number(req.nextUrl.searchParams.get("index"));
  const existing = await getSewout(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const target = existing.photos[index];
  if (!target) return NextResponse.json({ error: "No such photo" }, { status: 400 });
  await del(target.blobUrl).catch(() => {});
  const { record } = await setSewoutPhotos(id, existing.photos.filter((_, i) => i !== index));
  return NextResponse.json({ ok: true, record: record && withUrls(record) });
}
