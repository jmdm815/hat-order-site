import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { drawGarment } from "@/lib/ai-draw-garment";
import { fetchUrl } from "@/lib/auto-mockup";

export const runtime = "nodejs";
export const maxDuration = 300;

// Admin: POST multipart photo (file) or photoUrl, garment, view, notes,
// quality (medium|high), redraw=1. -> PNG (X-AI-Cached header).
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const s = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)).trim() : "");
    const f = form.get("photo");
    const photo = f instanceof File ? Buffer.from(await f.arrayBuffer()) : s("photoUrl") ? await fetchUrl(s("photoUrl")) : null;
    if (!photo) return NextResponse.json({ error: "Send photo or photoUrl" }, { status: 400 });
    const r = await drawGarment(
      { photo, garment: s("garment") || "blank garment", view: s("view") === "back" ? "back" : "front", notes: s("notes") || undefined, quality: s("quality") === "high" ? "high" : "medium" },
      { skipCache: s("redraw") === "1" },
    );
    return new NextResponse(new Uint8Array(r.png), { headers: { "Content-Type": "image/png", "X-AI-Cached": r.cached ? "1" : "0" } });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI drawing failed" }, { status });
  }
}
