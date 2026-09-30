import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  DEFAULT_LOGO_URL,
  getBrandSettings,
  isPersistent,
  setBrandSettings,
} from "@/lib/pricing-store";

// Admin-only: upload/replace/revert the site logo shown on the customer
// homepage hero and the order-flow header (StepHeader.tsx). See
// lib/pricing-store.ts's BrandSettings doc comment for why this exists — the
// shipped default is a tiny 48x48 placeholder that looks blurry at real
// display sizes.
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const brand = await getBrandSettings();
  return NextResponse.json({
    logoUrl: brand.logoUrl ?? DEFAULT_LOGO_URL,
    isCustom: Boolean(brand.logoUrl),
    persistent: isPersistent(),
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  if (!isPersistent()) {
    return NextResponse.json(
      {
        error:
          "No durable storage is connected to this deployment yet, so an uploaded logo wouldn't survive a redeploy. Connect a Vercel Blob store first.",
      },
      { status: 400 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (expected form field \"file\")" }, { status: 400 });
  }

  const ext = ACCEPTED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Use PNG, JPG, WebP, or SVG.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large — 5MB max." }, { status: 400 });
  }

  try {
    // addRandomSuffix so each new upload gets a fresh URL — avoids stale
    // browser/CDN caching serving the old logo after a replace.
    const blob = await put(`brand/logo.${ext}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });
    const { persisted } = await setBrandSettings({ logoUrl: blob.url });
    return NextResponse.json({ ok: true, logoUrl: blob.url, persisted });
  } catch (err) {
    console.error("POST /api/admin/logo failed", err);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { persisted } = await setBrandSettings({});
  return NextResponse.json({ ok: true, logoUrl: DEFAULT_LOGO_URL, persisted });
}
