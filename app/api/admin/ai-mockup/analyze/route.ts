import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { AiMockupError, analyzeProduct, readImages } from "@/lib/ai-mockup";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/admin/ai-mockup/analyze — multipart refs[] (+ optional hint):
// returns a structured description of the product in the photos.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const refs = await readImages(form, "refs");
    if (!refs.length) return NextResponse.json({ error: "Add at least one product photo." }, { status: 400 });
    if (refs.length > 6) return NextResponse.json({ error: "Up to 6 reference photos." }, { status: 400 });
    const hint = String(form.get("hint") ?? "").trim().slice(0, 80) || undefined;
    return NextResponse.json({ description: await analyzeProduct(refs, hint) });
  } catch (err) {
    return fail(err);
  }
}

function fail(err: unknown) {
  if (err instanceof AiMockupError) {
    return NextResponse.json(
      { error: err.message, retryAfter: err.retryAfterSec },
      { status: err.status, headers: err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined },
    );
  }
  console.error("ai-mockup analyze failed", err);
  return NextResponse.json({ error: "Analysis failed. Try again." }, { status: 500 });
}
