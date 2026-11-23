// ---------------------------------------------------------------------------
// DTF Gang Sheet Builder — shared types, size templates, packing, checks.
// Used by the customer builder (/gang-sheet), its API routes and the renderer.
//
// Rules (from JM Media):
//   - Sheets are ALWAYS 24" wide (printed on 26" film).
//   - Lengths come from the Shopify "DTF Gang Sheet" product's variants
//     (buyjmmedia.com/products/dtf-gang-sheet); never longer than 192".
//   - Output is a transparent PNG at 300 dpi (7200 px wide).
// ---------------------------------------------------------------------------

export const SHEET_WIDTH_IN = 24;
export const DPI = 300;
export const MAX_LENGTH_IN = 192;
export const DEFAULT_GAP_IN = 0.25;
export const SHOPIFY_STORE = "https://buyjmmedia.com";
export const SHOPIFY_PRODUCT_HANDLE = "dtf-gang-sheet";

export type SheetSize = {
  lengthIn: number;
  label: string; // "24 × 48 in"
  price: number; // dollars
  variantId: number | null; // Shopify variant id (null if Shopify lookup failed)
  available: boolean;
};

// Fallback copy of the Shopify variants (used only if the live lookup fails;
// variant ids are left null then so we never add a wrong item to the cart).
export const FALLBACK_SIZES: SheetSize[] = [
  [24, 12], [36, 18], [48, 24], [60, 30], [72, 35], [84, 40], [96, 45],
  [108, 50], [120, 55], [156, 71.5], [192, 110],
].map(([lengthIn, price]) => ({ lengthIn, price, label: `24 × ${lengthIn} in`, variantId: null, available: true }));

export type Rotation = 0 | 90 | 180 | 270;

export type SheetAsset = {
  id: string;
  name: string;
  url: string; // Vercel Blob URL (private store)
  contentType: string;
  pxW: number; // natural pixel size (SVG: intrinsic size)
  pxH: number;
  isVector: boolean; // SVG — prints sharp at any size
  hasTransparency: boolean;
};

export type SheetItem = {
  id: string;
  assetId: string;
  x: number; // inches from left edge of the sheet (of the rotated box)
  y: number; // inches from top
  w: number; // inches, size of the box as placed (after rotation)
  h: number;
  rot: Rotation;
};

export type SheetCustomer = { name?: string; email?: string; phone?: string; notes?: string };

export type GangSheetRecord = {
  id: string;
  number: string; // GS-XXXXXX, shown to the customer and in the Shopify cart
  mode: "build" | "upload";
  lengthIn: number;
  variantId: number | null;
  price: number;
  quantity: number;
  assets: SheetAsset[];
  items: SheetItem[]; // empty in upload mode
  uploadedSheet?: SheetAsset; // upload mode: the customer's finished sheet
  customer: SheetCustomer;
  status: "rendering" | "ready" | "failed";
  pngUrl?: string; // final 300 dpi print file
  previewUrl?: string; // small preview
  error?: string;
  createdAt: string;
  renderedAt?: string;
};

// ---------------------------------------------------------------- geometry
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Size of the artwork box when rotated. */
export function rotatedBox(w: number, h: number, rot: Rotation) {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Effective print resolution of an item (pixels per inch along its width). */
export function effectiveDpi(asset: SheetAsset, item: Pick<SheetItem, "w" | "h" | "rot">): number {
  if (asset.isVector) return Infinity;
  const artW = item.rot === 90 || item.rot === 270 ? item.h : item.w; // width of the unrotated art
  return artW > 0 ? asset.pxW / artW : 0;
}

export function itemsOverlap(a: SheetItem, b: SheetItem, tol = 0.01) {
  return a.x < b.x + b.w - tol && b.x < a.x + a.w - tol && a.y < b.y + b.h - tol && b.y < a.y + a.h - tol;
}

export function outOfBounds(it: SheetItem, lengthIn: number, tol = 0.005) {
  return it.x < -tol || it.y < -tol || it.x + it.w > SHEET_WIDTH_IN + tol || it.y + it.h > lengthIn + tol;
}

/** Bottom edge of the lowest item (inches). */
export function usedLength(items: SheetItem[]) {
  return items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
}

/** Smallest template that fits `needIn` inches. */
export function sizeFor(sizes: SheetSize[], needIn: number): SheetSize | null {
  return [...sizes].sort((a, b) => a.lengthIn - b.lengthIn).find((s) => s.lengthIn + 0.001 >= needIn) ?? null;
}

// ---------------------------------------------------------------- packing
export type PackRequest = { assetId: string; w: number; h: number; rot?: Rotation; key?: string };

/**
 * Shelf packer: tallest pieces first, left to right across the 24" width,
 * new row when a piece doesn't fit. A piece that's too wide for the sheet
 * (or packs better) is rotated 90°. Returns placed items (inches).
 */
export function packItems(reqs: PackRequest[], gap = DEFAULT_GAP_IN, newId: () => string): SheetItem[] {
  const W = SHEET_WIDTH_IN;
  const pieces = reqs.map((r) => {
    let { w, h } = r;
    let rot: Rotation = r.rot ?? 0;
    // Keep long side horizontal when it helps rows stay short, but never exceed 24".
    if (w > W + 1e-6 && h <= W) { [w, h] = [h, w]; rot = ((rot + 90) % 360) as Rotation; }
    return { ...r, w, h, rot };
  });
  pieces.sort((a, b) => b.h - a.h || b.w - a.w);
  const placed: SheetItem[] = [];
  type Shelf = { y: number; h: number; x: number };
  const shelves: Shelf[] = [];
  let nextY = 0;
  for (const p of pieces) {
    let shelf = shelves.find((s) => p.h <= s.h + 1e-6 && s.x + p.w <= W + 1e-6);
    if (!shelf) {
      // Try rotated into an existing shelf.
      const rw = p.h, rh = p.w;
      const rs = rw <= W ? shelves.find((s) => rh <= s.h + 1e-6 && s.x + rw <= W + 1e-6) : undefined;
      if (rs) {
        placed.push({ id: newId(), assetId: p.assetId, x: round3(rs.x), y: round3(rs.y), w: rw, h: rh, rot: ((p.rot + 90) % 360) as Rotation });
        rs.x += rw + gap;
        continue;
      }
      shelf = { y: nextY, h: p.h, x: 0 };
      shelves.push(shelf);
      nextY = round3(nextY + p.h + gap);
    }
    placed.push({ id: newId(), assetId: p.assetId, x: round3(shelf.x), y: round3(shelf.y), w: p.w, h: p.h, rot: p.rot });
    shelf.x += p.w + gap;
  }
  return placed;
}

// ---------------------------------------------------------------- checks
export type Issue = { level: "error" | "warn"; itemId?: string; assetId?: string; message: string };

export function checkSheet(items: SheetItem[], assets: SheetAsset[], lengthIn: number): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  items.forEach((it, i) => {
    const a = byId.get(it.assetId);
    if (!a) return;
    if (outOfBounds(it, lengthIn)) issues.push({ level: "error", itemId: it.id, message: `“${a.name}” hangs off the sheet.` });
    for (let j = i + 1; j < items.length; j++) {
      if (itemsOverlap(it, items[j])) { issues.push({ level: "error", itemId: it.id, message: `“${a.name}” overlaps another design.` }); break; }
    }
    const dpi = effectiveDpi(a, it);
    if (dpi < 150) issues.push({ level: "error", itemId: it.id, message: `“${a.name}” is low resolution at this size (${Math.round(dpi)} dpi). It will print blurry — make it smaller or upload a bigger file.` });
    else if (dpi < 250) issues.push({ level: "warn", itemId: it.id, message: `“${a.name}” is ${Math.round(dpi)} dpi at this size. 300 dpi prints sharpest.` });
  });
  const seen = new Set<string>();
  for (const it of items) {
    const a = byId.get(it.assetId);
    if (a && !a.hasTransparency && !seen.has(a.id)) {
      seen.add(a.id);
      issues.push({ level: "warn", assetId: a.id, message: `“${a.name}” has no transparent background, so the whole rectangle will print. Use a PNG with a transparent background unless you want the box.` });
    }
  }
  return issues;
}

export function sheetNumber(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `GS-${s}`;
}
