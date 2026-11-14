import sharp from "sharp";

// Shared by /api/product-image and the server-side mockup renderer.

// Only proxy images from hosts we trust — this keeps the route from being
// abused as an open image-fetching proxy.
const ALLOWED_HOSTS = new Set([
  "cdnm.sanmar.com",
  "images.unsplash.com",
  "www.ssactivewear.com",
  "cdn.ssactivewear.com",
]);

const CANVAS_SIZE = 1000;
// Real product photos trim down to well beyond this. SanMar's 404 handler
// (Image404ErrorHandler.jsp) serves a small placeholder graphic (~300x343
// pre-trim, mostly text/logo) that trims down to something much smaller than
// a real garment photo — treat a suspiciously small trimmed result as
// "broken" and fall back to the original on-model photo when one was given.
const MIN_VALID_DIMENSION = 150;

export function parseAllowedUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchAndProcess(url: URL): Promise<Buffer | null> {
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

