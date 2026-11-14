import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { fetchAndProcess, parseAllowedUrl } from "@/lib/product-photo";

export const runtime = "nodejs";

// GET ?url=<product photo>&fallback=<on-model photo> -> a small solid PNG in
// the garment's real color, sampled from the chest area of the (trimmed,
// centered) product photo. Cached hard: a style's photos don't change.
export async function GET(req: NextRequest) {
  const primary = parseAllowedUrl(req.nextUrl.searchParams.get("url"));
  const fallback = parseAllowedUrl(req.nextUrl.searchParams.get("fallback"));
  if (!primary) return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  try {
    const photo = (await fetchAndProcess(primary).catch(() => null)) ?? (fallback ? await fetchAndProcess(fallback).catch(() => null) : null);
    if (!photo) return NextResponse.json({ error: "No photo" }, { status: 404 });
    const { data, info } = await sharp(photo).resize(200, 200, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // Chest area: centered, a bit above the middle (flat lays and on-model
    // photos are both trimmed to the subject and centered by fetchAndProcess).
    const r: number[] = [], g: number[] = [], b: number[] = [];
    for (let y = Math.round(info.height * 0.4); y < info.height * 0.56; y++)
      for (let x = Math.round(info.width * 0.4); x < info.width * 0.6; x++) {
        const i = (y * info.width + x) * 3;
        r.push(data[i]);
        g.push(data[i + 1]);
        b.push(data[i + 2]);
      }
    const med = (v: number[]) => v.sort((a, z) => a - z)[Math.floor(v.length / 2)] ?? 154;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: med(r), g: med(g), b: med(b) } } })
      .png()
      .toBuffer();
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't sample that photo" }, { status: 502 });
  }
}
