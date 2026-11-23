import { NextRequest, NextResponse } from "next/server";
import { fetchPrivateBlob, getSheet } from "@/lib/gang-sheet-store";

export const maxDuration = 120;

// Streams the print PNG (?kind=png) or the small preview (?kind=preview).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rec = await getSheet((await params).id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("kind") === "png" ? "png" : "preview";
  const url = kind === "png" ? rec.pngUrl : rec.previewUrl;
  if (!url) return NextResponse.json({ error: rec.status === "failed" ? rec.error ?? "Render failed" : "Still rendering" }, { status: 409 });
  const res = await fetchPrivateBlob(url);
  if (!res.ok || !res.body) return NextResponse.json({ error: "File unavailable" }, { status: 502 });
  const filename = kind === "png" ? `${rec.number}-24x${rec.lengthIn}in-300dpi.png` : `${rec.number}-preview.png`;
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `${req.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${filename}"`,
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
      "Cache-Control": "private, max-age=300",
    },
  });
}
