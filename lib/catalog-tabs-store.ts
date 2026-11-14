import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";
import type { ProductType } from "./types";

// ---------------------------------------------------------------------------
// Which product-type tabs (Hats / T-Shirts / Polos / Tumblers) the customer
// catalog shows. Admin → Catalog → "Catalog tabs". Each save is a new file
// (newest wins) so a change is visible right away, with no storage cache lag.
// ---------------------------------------------------------------------------

export const CATALOG_TYPES: ProductType[] = ["hat", "shirt", "polo", "tumbler"];
const PREFIX = "catalog-tabs/";
let memory: ProductType[] = [];

export async function getHiddenCatalogTypes(): Promise<ProductType[]> {
  if (!isPersistent()) return memory;
  try {
    const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
    const newest = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname))[0];
    if (!newest) return [];
    const r = await fetch(newest.url, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    if (!r.ok) return [];
    const j = (await r.json()) as { hidden?: string[] };
    return (j.hidden ?? []).filter((t): t is ProductType => (CATALOG_TYPES as string[]).includes(t));
  } catch {
    return [];
  }
}

export async function setHiddenCatalogTypes(hidden: ProductType[]): Promise<ProductType[]> {
  const clean = CATALOG_TYPES.filter((t) => hidden.includes(t));
  // Never hide every tab — the catalog would be empty.
  const safe = clean.length >= CATALOG_TYPES.length ? clean.slice(0, -1) : clean;
  memory = safe;
  if (isPersistent()) {
    await put(`${PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ hidden: safe }), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  }
  return safe;
}
