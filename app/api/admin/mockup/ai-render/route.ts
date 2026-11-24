import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { AiMockupError } from "@/lib/ai-mockup";
import { aiRender, type RenderPlacement } from "@/lib/ai-render";
import { fetchUrl, garmentPhoto, loadProduct, pickColor } from "@/lib/auto-mockup";

export const runtime = "nodejs";
export const maxDuration = 300;

const PLACEMENTS: RenderPlacement[] = ["left-chest", "right-chest", "full-front", "back", "hat-front", "sleeve"];

// POST multipart: logo (file), and either garment (file) / garmentUrl, or
// style + color (+ source sanmar|ss|auto); placement, decoration, notes,
// quality (medium|high). Returns { image (base64 PNG), model, garmentNote }.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const logoFile = form.get("logo");
    if (!(logoFile instanceof File)) return NextResponse.json({ error: "Upload the logo (transparent PNG)" }, { status: 400 });
    const logo = Buffer.from(await logoFile.arrayBuffer());
    const str = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)).trim() : "");
    const placement = (PLACEMENTS.includes(str("placement") as RenderPlacement) ? str("placement") : "left-chest") as RenderPlacement;

    let garment: Buffer;
    let garmentNote: string | undefined;
    const gFile = form.get("garment");
    if (gFile instanceof File) garment = Buffer.from(await gFile.arrayBuffer());
    else if (str("garmentUrl")) garment = await fetchUrl(str("garmentUrl"));
    else {
      const product = await loadProduct(str("style"), str("source") || "auto");
      if (!product) return NextResponse.json({ error: `Style ${str("style")} not found` }, { status: 404 });
      const color = pickColor(product, str("color"));
      if (!color) return NextResponse.json({ error: `${product.styleNumber} has no color "${str("color")}"` }, { status: 404 });
      const ph = await garmentPhoto(color, placement === "back" ? "back" : "front");
      garment = ph.buf;
      garmentNote = ph.note;
    }
    const r = await aiRender({
      garment,
      logo,
      placement,
      decoration: /embroid/i.test(str("decoration")) ? "embroidery" : "print",
      notes: str("notes") || undefined,
      quality: str("quality") === "medium" ? "medium" : "high",
    });
    return NextResponse.json({ image: r.png.toString("base64"), model: r.model, garmentNote });
  } catch (err) {
    const status = err instanceof AiMockupError ? err.status : 500;
    if (status === 500) console.error("ai-render failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI render failed" }, { status });
  }
}
