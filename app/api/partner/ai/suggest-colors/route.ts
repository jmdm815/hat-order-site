import { NextRequest, NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { suggestSwaps } from "@/lib/ai-draw-garment";
import { partnerId, QuotaError, refund, reserve, usageFor } from "@/lib/partner-ai-quota";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST JSON { logo: data:image/png;base64,…, palette: ["#hex"], garments:
// [{name, hex}], instructions? } -> { swaps, note, usage }. Counts one AI use.
export async function POST(req: NextRequest) {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(body?.logo ?? ""));
  if (!m) return NextResponse.json({ error: "Send the logo as a PNG data URL." }, { status: 400 });
  const palette = (Array.isArray(body?.palette) ? body.palette : []).filter((x: unknown) => typeof x === "string").slice(0, 12);
  const garments = (Array.isArray(body?.garments) ? body.garments : []).slice(0, 30).map((g: { name?: unknown; hex?: unknown }) => ({ name: String(g?.name ?? "").slice(0, 60), hex: typeof g?.hex === "string" ? g.hex : undefined })).filter((g: { name: string }) => g.name);
  if (!palette.length || !garments.length) return NextResponse.json({ error: "Missing logo colours or garments." }, { status: 400 });
  const id = await partnerId();
  let reserved = false;
  try {
    await reserve(id);
    reserved = true;
    const r = await suggestSwaps({ logoPng: Buffer.from(m[2], "base64"), palette, garments, instructions: typeof body?.instructions === "string" ? body.instructions : "" });
    return NextResponse.json({ ...r, usage: await usageFor(id) });
  } catch (err) {
    if (reserved) await refund(id).catch(() => {});
    const status = err instanceof QuotaError ? 429 : (err as { status?: number })?.status ?? 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't get suggestions." }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
