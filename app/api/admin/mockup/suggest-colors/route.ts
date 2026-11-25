import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { suggestSwaps } from "@/lib/ai-draw-garment";

export const runtime = "nodejs";
export const maxDuration = 120;

// Admin: POST multipart logo (PNG), palette (JSON ["#hex"]), garments (JSON
// [{name, hex}]), instructions -> { swaps, note }. Recolor-only suggestions.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const logo = form.get("logo");
    if (!(logo instanceof File)) return NextResponse.json({ error: "Send the logo" }, { status: 400 });
    const parse = (k: string) => { try { return JSON.parse(String(form.get(k) ?? "[]")); } catch { return []; } };
    const r = await suggestSwaps({
      logoPng: Buffer.from(await logo.arrayBuffer()),
      palette: (parse("palette") as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 12),
      garments: (parse("garments") as { name?: string; hex?: string }[]).filter((g) => g?.name).slice(0, 30).map((g) => ({ name: String(g.name), hex: g.hex })),
      instructions: String(form.get("instructions") ?? ""),
    });
    return NextResponse.json(r);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't get suggestions" }, { status });
  }
}
