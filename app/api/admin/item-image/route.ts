import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { isAdminAuthed } from "@/lib/admin-auth";
import { itemPhotoUrl } from "@/lib/item-photo";

export const runtime = "nodejs";

const CANVAS_SIZE = 1000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12MB — plenty for a phone/DSLR product photo

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

// Admin upload for a custom design-canvas photo, used when SanMar has no
// real flat/no-model photo for an item/color (or the admin just prefers a
// different image). Mirrors the trim + pad-onto-a-square-canvas processing
// that /api/product-image applies to real SanMar photos, so an uploaded
// image lines up with the print-location zone boxes the same way a real
// photo would — the result is stored pre-processed in Blob and can be
// rendered directly by the client with no further proxying.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Blob storage isn't connected on this Vercel project yet (Storage -> Create Database -> Blob -> Connect to Project), so uploaded images can't be saved.",
      },
      { status: 501 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const styleNumber = form.get("styleNumber");
  const colorName = form.get("colorName");
  const view = form.get("view");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (typeof styleNumber !== "string" || !styleNumber) {
    return NextResponse.json({ error: "Missing styleNumber" }, { status: 400 });
  }
  if (typeof colorName !== "string" || !colorName) {
    return NextResponse.json({ error: "Missing colorName" }, { status: 400 });
  }
  if (view !== "front" && view !== "back") {
    return NextResponse.json({ error: "view must be 'front' or 'back'" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image is too large (12MB max)" }, { status: 400 });
  }

  try {
    const inputBuffer = Buffer.from(await file.arrayBuffer());

    const trimmed = await sharp(inputBuffer)
      .rotate() // respect EXIF orientation from phone cameras
      .flatten({ background: "#ffffff" })
      .trim({ background: "#ffffff", threshold: 12 })
      .toBuffer();

    const processed = await sharp(trimmed)
      .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "contain", background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer();

    const pathname = `item-images/${slugify(styleNumber)}/${slugify(colorName)}/${view}-${Date.now()}.jpg`;
    // The connected Blob store is private (a public put() 403s there — see
    // lib/item-photo.ts), so uploads go in as private and get served back
    // out through /api/item-photo, which holds the read token.
    const blob = await put(pathname, processed, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "image/jpeg",
    });

    return NextResponse.json({ ok: true, url: itemPhotoUrl(blob.url) });
  } catch (err) {
    console.error("item-image upload failed", err);
    return NextResponse.json({ error: "Couldn't process that image" }, { status: 500 });
  }
}
