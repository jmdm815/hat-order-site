import { NextRequest, NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { drawGarment, findCachedDrawing } from "@/lib/ai-draw-garment";
import { partnerId, QuotaError, refund, reserve, usageFor } from "@/lib/partner-ai-quota";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST multipart: photo (blank garment image), garment (description), view
// (front|back), redraw=1 to skip the cache. -> PNG. A cached drawing is free;
// a new one counts against the partner's weekly AI allowance.
// Headers: X-AI-Cached (1|0), X-AI-Used, X-AI-Limit.
export async function POST(req: NextRequest) {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File) || !photo.size) return NextResponse.json({ error: "Attach the garment photo." }, { status: 400 });
  if (photo.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Photo is too big (15MB max)." }, { status: 400 });
  const garment = String(form?.get("garment") ?? "blank garment").slice(0, 200);
  const view = form?.get("view") === "back" ? "back" : "front";
  const redraw = form?.get("redraw") === "1";
  const id = await partnerId();
  const buf = Buffer.from(await photo.arrayBuffer());
  let reserved = false;
  try {
    if (!redraw) {
      // Try the cache first without spending an AI use.
      const hit = await findCachedDrawing({ photo: buf, garment, view });
      if (hit) return png(hit, true, await usageFor(id));
    }
    await reserve(id);
    reserved = true;
    const r = await drawGarment({ photo: buf, garment, view }, { skipCache: true });
    return png(r.png, false, await usageFor(id));
  } catch (err) {
    if (reserved) await refund(id).catch(() => {});
    const status = err instanceof QuotaError ? 429 : (err as { status?: number })?.status ?? 500;
    console.error("partner draw-garment failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI drawing failed." }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}

function png(b: Buffer, cached: boolean, u: { used: number; limit: number }) {
  return new NextResponse(new Uint8Array(b), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-AI-Cached": cached ? "1" : "0", "X-AI-Used": String(u.used), "X-AI-Limit": String(u.limit) },
  });
}
