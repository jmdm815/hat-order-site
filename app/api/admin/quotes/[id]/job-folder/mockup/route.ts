import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import sharp from "sharp";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, setJobFolderMockupImage } from "@/lib/quotes-store";
import { itemPhotoUrl } from "@/lib/item-photo";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12MB
const MAX_DIMENSION = 1600; // plenty for a page-width PDF image; keeps the blob/PDF small

// Admin-only: uploads (or replaces) the garment mock-up image shown on page
// 2 of this quote/invoice's job-folder PDF (see
// lib/quote-pdf.ts's renderJobFolderPdf, AdminJobFolderModal.tsx). Mirrors
// app/api/admin/item-image/route.ts's upload pattern: processed with sharp,
// stored in the private Blob store, served back through the existing
// /api/item-photo proxy (it's content-agnostic — just streams back whatever
// private blob URL it's given after an admin auth check at upload time, so
// reusing it here needs no new proxy route).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Blob storage isn't connected on this Vercel project yet (Storage -> Create Database -> Blob -> Connect to Project), so an uploaded mock-up can't be saved.",
      },
      { status: 501 }
    );
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image is too large (12MB max)" }, { status: 400 });
  }
  // Which line item this mock-up is for — AdminJobFolderModal.tsx always
  // prompts for this before uploading (a picker of the order's current line
  // items, plus "For reference only"), so a missing/blank value here should
  // only happen from some other caller; default rather than hard-reject so
  // the upload itself never fails over it.
  const rawLineItemLabel = form.get("lineItemLabel");
  const lineItemLabel =
    typeof rawLineItemLabel === "string" && rawLineItemLabel.trim()
      ? rawLineItemLabel.trim().slice(0, 200)
      : "For reference only";

  try {
    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const processed = await sharp(inputBuffer)
      .rotate() // respect EXIF orientation from phone cameras
      .flatten({ background: "#ffffff" })
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();

    const pathname = `job-folder-mockups/${id}/${Date.now()}.jpg`;
    const blob = await put(pathname, processed, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "image/jpeg",
    });

    // Best-effort cleanup of the previous mock-up blob, if any — not
    // critical if it fails (just leaves an orphaned blob behind), so this
    // never blocks or fails the upload itself.
    const previousUrl = record.jobFolder?.mockupImageBlobUrl;
    if (previousUrl && previousUrl !== blob.url) {
      del(previousUrl).catch(() => {});
    }

    const { record: updated, persisted } = await setJobFolderMockupImage(id, blob.url, lineItemLabel);
    if (!updated) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      record: updated,
      mockupImageUrl: itemPhotoUrl(blob.url),
      persisted,
    });
  } catch (err) {
    console.error(`POST /api/admin/quotes/${id}/job-folder/mockup failed`, err);
    return NextResponse.json({ error: "Couldn't process that image" }, { status: 500 });
  }
}

// Removes the mock-up image from this record (keeps printFiles untouched).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  const previousUrl = record.jobFolder?.mockupImageBlobUrl;
  if (previousUrl) {
    del(previousUrl).catch(() => {});
  }
  const { record: updated, persisted } = await setJobFolderMockupImage(id, null, null);
  if (!updated) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record: updated, persisted });
}
