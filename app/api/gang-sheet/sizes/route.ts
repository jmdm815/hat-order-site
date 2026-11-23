import { NextResponse } from "next/server";
import { FALLBACK_SIZES, MAX_LENGTH_IN, SHEET_WIDTH_IN, SHOPIFY_PRODUCT_HANDLE, SHOPIFY_STORE, type SheetSize } from "@/lib/gang-sheet";

// Live size templates from the Shopify "DTF Gang Sheet" product, so prices and
// variant ids always match the store. Cached for 10 minutes.
let cache: { at: number; sizes: SheetSize[]; live: boolean } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return NextResponse.json(cache);
  try {
    const res = await fetch(`${SHOPIFY_STORE}/products/${SHOPIFY_PRODUCT_HANDLE}.js`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const p = (await res.json()) as { variants: { id: number; title: string; price: number; available: boolean }[] };
    const sizes: SheetSize[] = [];
    for (const v of p.variants) {
      const m = v.title.match(/(\d+(?:\.\d+)?)\s*in\s*x\s*(\d+(?:\.\d+)?)\s*in/i);
      if (!m) continue;
      const w = Number(m[1]), len = Number(m[2]);
      if (w !== SHEET_WIDTH_IN || len > MAX_LENGTH_IN) continue;
      sizes.push({ lengthIn: len, label: `24 × ${len} in`, price: v.price / 100, variantId: v.id, available: v.available });
    }
    if (!sizes.length) throw new Error("no 24in variants");
    sizes.sort((a, b) => a.lengthIn - b.lengthIn);
    cache = { at: Date.now(), sizes, live: true };
  } catch (err) {
    console.error("gang-sheet sizes: Shopify lookup failed", err);
    cache = { at: Date.now() - 9 * 60 * 1000, sizes: FALLBACK_SIZES, live: false };
  }
  return NextResponse.json(cache);
}
