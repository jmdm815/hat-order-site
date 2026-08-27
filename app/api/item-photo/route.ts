import { NextRequest, NextResponse } from "next/server";
import { isTrustedBlobUrl } from "@/lib/item-photo";

export const runtime = "nodejs";

// Serves an admin-uploaded item photo (see app/api/admin/item-image). The
// connected Blob store is private, so the raw blob URL only works with the
// BLOB_READ_WRITE_TOKEN this server holds — this route re-fetches it with
// that token and streams the bytes back, so a normal same-origin <img src>
// works for everyone. NOT admin-gated: these are the live design-canvas
// photos customers see, not an admin-only resource.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !isTrustedBlobUrl(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Blob storage not connected" }, { status: 501 });
  }

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    const buf = await upstream.arrayBuffer();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable",
      },
    });
  } catch (err) {
    console.error("item-photo: fetch failed", err);
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
}
