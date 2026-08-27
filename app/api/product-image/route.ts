import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

// Only proxy images from hosts we trust — this keeps the route from being
// abused as an open image-fetching proxy.
const ALLOWED_HOSTS = new Set([
  "cdnm.sanmar.com",
  "images.unsplash.com",
]);

const CANVAS_SIZE = 1000;
// Real product photos trim down to well beyond this. SanMar's 404 handler
// (Image404ErrorHandler.jsp) serves a small placeholder graphic (~300x343
// pre-trim, mostly text/logo) that trims down to something much smaller than
// a real garment photo — treat a suspiciously small trimmed result as
// "broken" and fall back to the original on-model photo when one was given.
const MIN_VALID_DIMENSION = 150;

function parseAllowedUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchAndProcess(url: URL): Promise<Buffer | null> {
  const upstream = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!upstream.ok) return null;
  const inputBuffer = Buffer.from(await upstream.arrayBuffer());

  // Product photos from SanMar are shot on a white canvas but the product
  // itself is rarely centered in that canvas — there's often extra
  // whitespace on one side. Flatten any transparency onto white, trim the
  // uniform white/near-white border down to the actual product, then pad
  // it back out onto a fresh centered square canvas so every image lines
  // up the same way regardless of how the source photo was framed.
  const trimmed = await sharp(inputBuffer)
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 12 })
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  if ((meta.width ?? 0) < MIN_VALID_DIMENSION && (meta.height ?? 0) < MIN_VALID_DIMENSION) {
    return null; // looks like a broken/placeholder image
  }

  return sharp(trimmed)
    .resize(CANVAS_SIZE, CANVAS_SIZE, {
      fit: "contain",
      background: "#ffffff",
    })
    .jpeg({ quality: 88 })
    .toBuffer();
}

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
