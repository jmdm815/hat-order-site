import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { AiMockupError, checkView, readImages, type GenerateSpec } from "@/lib/ai-mockup";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/admin/ai-mockup/check — multipart spec + refs[] + output:
// vision QC of one generated view against the original photos.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const spec = JSON.parse(String(form.get("spec") ?? "{}")) as GenerateSpec;
    const refs = await readImages(form, "refs");
    const [output] = await readImages(form, "output");
    if (!output || !refs.length || !spec?.description) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    return NextResponse.json({ qc: await checkView(spec, refs, output) });
  } catch (err) {
    if (err instanceof AiMockupError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("ai-mockup check failed", err);
    return NextResponse.json({ error: "Check failed." }, { status: 500 });
  }
}
