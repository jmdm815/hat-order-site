import { NextRequest, NextResponse } from "next/server";
import { fetchAndProcess, parseAllowedUrl } from "@/lib/product-photo";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("url");
  const fallback = req.nextUrl.searchParams.get("fallback");
  // `strict=1` is for callers that need to know definitively whether a real
  // photo exists at `url` (e.g. the shirt design canvas, which wants to show
  // a real flat/no-model photo when SanMar has one, but must never silently
  // fall through to the on-model photo or SanMar's placeholder graphic as a
  // substitute) — a genuine 404 lets the client's <img onError> swap to a
  // generated fallback instead of rendering something misleading.
  const strict = req.nextUrl.searchParams.get("strict") === "1";

  const primary = parseAllowedUrl(src);
  if (!primary) {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  }
  const fallbackParsed = strict ? null : parseAllowedUrl(fallback);

  try {
    const output = await fetchAndProcess(primary);
    if (output) {
      return new NextResponse(new Uint8Array(output), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable",
        },
      });
    }

    if (fallbackParsed) {
      const fallbackOutput = await fetchAndProcess(fallbackParsed);
      if (fallbackOutput) {
        return new NextResponse(new Uint8Array(fallbackOutput), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable",
          },
        });
      }
    }

    if (strict) {
      return NextResponse.json({ error: "No real photo available" }, { status: 404 });
    }

    // Nothing usable came back from either URL — fall back to redirecting
    // to the raw primary url rather than breaking the page.
    return NextResponse.redirect(primary.toString());
  } catch {
    if (strict) {
      return NextResponse.json({ error: "No real photo available" }, { status: 404 });
    }
    // If anything about the fetch/trim/resize pipeline fails, fall back to a
    // redirect to the original image rather than breaking the page.
    return NextResponse.redirect(primary.toString());
  }
}
