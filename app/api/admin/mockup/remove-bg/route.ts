import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { cutoutLogo, type CutoutMode } from "@/lib/mockup-node";
import { SocialError } from "@/lib/social-openai";

export const runtime = "nodejs";
export const maxDuration = 180;

const MODES: CutoutMode[] = ["auto", "exact", "ai"];

// POST multipart: file, mode (auto|exact|ai, default auto), holes (1 = also
// clear enclosed areas). -> transparent PNG. Headers: X-Cutout-Method
// (exact|ai|already-transparent|none) and X-Cutout-Note.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Attach an image." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Image is too big (25MB max)." }, { status: 400 });
  const m = String(form?.get("mode") ?? "auto") as CutoutMode;
  try {
    const r = await cutoutLogo(Buffer.from(await file.arrayBuffer()), MODES.includes(m) ? m : "auto", form?.get("holes") === "1");
    return new NextResponse(new Uint8Array(r.png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Cutout-Method": r.method,
        ...(r.note ? { "X-Cutout-Note": encodeURIComponent(r.note) } : {}),
      },
    });
  } catch (err) {
    const status = err instanceof SocialError ? err.status : 500;
    console.error("remove-bg failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't process that image." }, { status });
  }
}
