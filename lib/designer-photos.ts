import { searchSsStyles, getSsStyleAsProduct, isSsConfigured } from "./ssactivewear";

// ---------------------------------------------------------------------------
// Extra real garment photos for the customer designer. SanMar doesn't shoot
// a flat (no-model) photo for every style/color; S&S Activewear often carries
// the same style with flat front/back photos. Looks the style up on S&S by
// style number (+ brand) and returns photos keyed by normalized color name.
// Flat product shots only — never on-model photos.
// ---------------------------------------------------------------------------

export type AltPhotos = Record<string, { front?: string; back?: string }>;
const cache = new Map<string, { at: number; photos: AltPhotos }>();
const TTL = 12 * 60 * 60 * 1000;

export const colorKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function getAltPhotos(style: string, brand?: string): Promise<AltPhotos> {
  const k = `${norm(style)}|${norm(brand ?? "")}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.photos;
  let photos: AltPhotos = {};
  try {
    if (isSsConfigured() && style.trim()) {
      const results = await searchSsStyles(style, 15);
      const match =
        results.find((r) => norm(r.name.split(" — ")[0]) === norm(style) && (!brand || norm(r.brand) === norm(brand))) ??
        results.find((r) => norm(r.name.split(" — ")[0]) === norm(style));
      if (match) {
        const product = await getSsStyleAsProduct(match.styleNumber);
        for (const c of product?.colors ?? []) {
          // S&S colorFrontImage/colorBackImage are flat product shots.
          if (!c.imageUrl || /swatch/i.test(c.imageUrl)) continue;
          photos[colorKey(c.colorName)] = { front: c.imageUrl, back: c.backImageUrl };
        }
      }
    }
  } catch (err) {
    console.error("designer-photos: S&S lookup failed", err);
    photos = {};
  }
  cache.set(k, { at: Date.now(), photos });
  return photos;
}
