import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { AiMockupError, generateView, readImages, type GenerateSpec } from "@/lib/ai-mockup";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/admin/ai-mockup/generate — multipart:
//   spec     JSON GenerateSpec (description, view, style, background, …)
//   refs[]   the original product photos (always sent)
//   primary  optional: the approved primary view, for consistency
//   current  optional: the output being refined (with spec.instruction)
// Returns { image: base64 PNG, model }.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    let spec: GenerateSpec;
    try {
      spec = JSON.parse(String(form.get("spec") ?? ""));
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    if (!spec?.description?.productType || !spec.view?.id) return NextResponse.json({ error: "Analyze the photos first." }, { status: 400 });
    if (spec.instruction) spec.instruction = String(spec.instruction).slice(0, 1000);
    const refs = await readImages(form, "refs");
    const primary = await readImages(form, "primary");
    const current = await readImages(form, "current");
    const images = current.length ? [current[0], ...refs] : [...refs, ...primary.slice(0, 1)];
    const r = await generateView({ ...spec, hasPrimary: !current.length && primary.length > 0, isRefine: current.length > 0 }, images);
    return NextResponse.json({ image: r.png.toString("base64"), model: r.model });
  } catch (err) {
    if (err instanceof AiMockupError) {
      return NextResponse.json(
        { error: err.message, retryAfter: err.retryAfterSec },
        { status: err.status, headers: err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined },
      );
    }
    console.error("ai-mockup generate failed", err);
    return NextResponse.json({ error: "Generation failed. Try again." }, { status: 500 });
  }
}
