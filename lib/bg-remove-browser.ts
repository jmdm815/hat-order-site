// Browser wrapper around lib/bg-remove.ts: image URL in, transparent PNG
// object URL out (when a solid background was found and removed).

import { removeUniformBackground, type CutoutStatus } from "./bg-remove";

const MAX_PX = 16_000_000; // skip giant images rather than freeze the tab

export async function cutoutImageInBrowser(
  src: string,
  opts: { holes?: boolean } = {}
): Promise<{ status: CutoutStatus | "skipped"; url?: string; blob?: Blob }> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
  if (!img || !img.naturalWidth) return { status: "skipped" };
  const w = img.naturalWidth, h = img.naturalHeight;
  if (w * h > MAX_PX) return { status: "skipped" };
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { status: "skipped" };
  ctx.drawImage(img, 0, 0);
  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    return { status: "skipped" }; // cross-origin
  }
  const r = removeUniformBackground(pixels.data, w, h, { holes: opts.holes });
  if (r.status !== "removed") return { status: r.status };
  ctx.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) return { status: "skipped" };
  return { status: "removed", url: URL.createObjectURL(blob), blob };
}
