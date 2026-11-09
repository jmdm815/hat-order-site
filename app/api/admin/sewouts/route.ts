import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createSewout, getSewouts, scoreSewout, SewoutFields } from "@/lib/sewouts-store";
import { itemPhotoUrl } from "@/lib/item-photo";
import { MAX_SEWOUT_UPLOAD_BYTES, storeSewoutCover, storeSewoutPhoto } from "./photo-util";

export const runtime = "nodejs";

// GET /api/admin/sewouts[?q=dozier] — the whole library (it's small), or the
// matches for a search, best first. Each record gets photoUrls (proxied) for
// display.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const all = await getSewouts();
  const withUrls = all.map((s) => ({ ...s, photoUrls: s.photos.map((p) => itemPhotoUrl(p.blobUrl)), coverUrl: s.coverBlobUrl ? itemPhotoUrl(s.coverBlobUrl) : undefined }));
  if (!q) return NextResponse.json({ sewouts: withUrls });
  const ranked = withUrls
    .map((s) => ({ s, score: scoreSewout(s, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
  return NextResponse.json({ sewouts: ranked });
}

// POST multipart: "fields" (JSON of SewoutFields) + one or more "photo" files.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  let fields: Partial<SewoutFields> = {};
  try {
    fields = JSON.parse(String(form.get("fields") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  if (!fields.customerName?.trim()) {
    return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
  }
  const files = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.some((f) => f.size > MAX_SEWOUT_UPLOAD_BYTES)) {
    return NextResponse.json({ error: "A photo is too large (15MB max)" }, { status: 400 });
  }
  const id = uuid();
  try {
    const photos = [];
    for (const f of files.slice(0, 6)) photos.push({ blobUrl: await storeSewoutPhoto(f, id), addedAt: new Date().toISOString() });
    const cover = form.get("cover");
    const coverBlobUrl = cover instanceof File && cover.size > 0 ? await storeSewoutCover(cover, id) : undefined;
    const { record, persisted } = await createSewout(id, fields, photos, coverBlobUrl);
    return NextResponse.json({
      ok: true,
      record: {
        ...record,
        photoUrls: photos.map((p) => itemPhotoUrl(p.blobUrl)),
        coverUrl: coverBlobUrl ? itemPhotoUrl(coverBlobUrl) : undefined,
      },
      persisted,
    });
  } catch (err) {
    console.error("POST /api/admin/sewouts failed", err);
    return NextResponse.json({ error: "Couldn't save that sew-out" }, { status: 500 });
  }
}
