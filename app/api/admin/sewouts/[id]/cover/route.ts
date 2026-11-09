import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { isAdminAuthed } from "@/lib/admin-auth";
import { setSewoutCover } from "@/lib/sewouts-store";
import { itemPhotoUrl } from "@/lib/item-photo";
import { MAX_SEWOUT_UPLOAD_BYTES, storeSewoutCover } from "../../photo-util";

export const runtime = "nodejs";

// POST multipart "cover": replaces this sew-out's square card image (cropped
// in the browser by the crop tool). DELETE clears it (cards fall back to the
// first photo).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("cover");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing cover" }, { status: 400 });
  if (file.size > MAX_SEWOUT_UPLOAD_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 400 });
  const blobUrl = await storeSewoutCover(file, id);
  const { record, previous } = await setSewoutCover(id, blobUrl);
  if (!record) {
    await del(blobUrl).catch(() => {});
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (previous) await del(previous).catch(() => {});
  return NextResponse.json({
    ok: true,
    record: { ...record, photoUrls: record.photos.map((p) => itemPhotoUrl(p.blobUrl)), coverUrl: itemPhotoUrl(blobUrl) },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { record, previous } = await setSewoutCover(id, undefined);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (previous) await del(previous).catch(() => {});
  return NextResponse.json({ ok: true, record: { ...record, photoUrls: record.photos.map((p) => itemPhotoUrl(p.blobUrl)) } });
}
