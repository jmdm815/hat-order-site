import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Pitbull Cap (pitbullcap.com, Choice Cap Inc.) — hats JM Media buys blank.
//
// Product info (name, colors, SKUs, photos) comes from the store's public
// Shopify product JSON. JM Media's real cost is NOT public: the public price
// is retail ($16.99 for a PB311) and the wholesale price ($7.50) only shows
// inside the signed-in account, which signs in with an emailed one-time code
// behind a bot check — so there is no login robot. Instead the wholesale
// price per style is kept in a small list here (Admin → quote builder →
// Pitbull Cap, or PUT /api/admin/pitbull/prices), filled from the signed-in
// account (Claude's pitbull-cap-lookup skill, or by hand).
// ---------------------------------------------------------------------------

const STORE = "https://pitbullcap.com";
const BLOB_PATHNAME = "pitbull/prices.json";

export type PitbullColor = { name: string; sku: string; available: boolean; imageUrl?: string; variantId: number };
export type PitbullProduct = {
  style: string; // e.g. "PB311"
  handle: string;
  title: string;
  brand: string; // vendor, e.g. "CAMBRIDGE"
  publicPrice: number; // retail, NOT JM's cost
  imageUrl?: string;
  url: string;
  colors: PitbullColor[];
};
export type PitbullPrice = { price: number; updatedAt: string; note?: string };
export type PitbullPriceList = { byStyle: Record<string, PitbullPrice> };

// Signed-in wholesale prices seen in the JM Media account on Nov 17, 2026.
const SEED: PitbullPriceList = {
  byStyle: {
    PB311: { price: 7.5, updatedAt: "2026-11-17T20:16:00.000Z", note: "signed-in account" },
    PB311W: { price: 8, updatedAt: "2026-11-17T20:16:00.000Z", note: "signed-in account" },
    PB117: { price: 6, updatedAt: "2026-11-17T20:16:00.000Z", note: "signed-in account" },
    PB258: { price: 6, updatedAt: "2026-11-17T20:16:00.000Z", note: "signed-in account" },
    PB315H: { price: 6, updatedAt: "2026-11-17T20:16:00.000Z", note: "signed-in account" },
  },
};

export const normStyle = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

let memory: PitbullPriceList | null = null;

export async function getPitbullPrices(): Promise<PitbullPriceList> {
  if (memory) return memory;
  let fromBlob: PitbullPriceList | null = null;
  if (isPersistent()) {
    try {
      const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
      const b = blobs.find((x) => x.pathname === BLOB_PATHNAME);
      if (b) {
        const r = await fetch(`${b.url}?t=${Date.now()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        });
        if (r.ok) fromBlob = (await r.json()) as PitbullPriceList;
      }
    } catch (e) {
      console.error("pitbull prices: blob read failed", e);
    }
  }
  memory = fromBlob ?? SEED;
  return memory;
}

export async function setPitbullPrices(
  updates: Record<string, { price: number | null; note?: string }>
): Promise<{ list: PitbullPriceList; persisted: boolean }> {
  const cur = await getPitbullPrices();
  const byStyle = { ...cur.byStyle };
  const now = new Date().toISOString();
  for (const [raw, u] of Object.entries(updates)) {
    const style = normStyle(raw);
    if (!style) continue;
    if (u.price == null) delete byStyle[style];
    else byStyle[style] = { price: Math.round(u.price * 100) / 100, updatedAt: now, ...(u.note ? { note: u.note } : {}) };
  }
  memory = { byStyle };
  if (!isPersistent()) return { list: memory, persisted: false };
  await put(BLOB_PATHNAME, JSON.stringify(memory), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return { list: memory, persisted: true };
}

type ShopifyVariant = {
  id: number; title: string; option1?: string | null; sku?: string; available?: boolean;
  featured_image?: { src?: string } | null;
};
type ShopifyProduct = {
  title: string; handle: string; vendor?: string; price: number; featured_image?: string;
  variants: ShopifyVariant[];
};

const abs = (u?: string | null) => (!u ? undefined : u.startsWith("//") ? `https:${u}` : u);

async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (JM Media quote tool)" },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as T | null;
}

function styleFromTitle(title: string) {
  return normStyle(title.split(/\s+/)[0] ?? "");
}

function toProduct(p: ShopifyProduct): PitbullProduct {
  return {
    style: styleFromTitle(p.title),
    handle: p.handle,
    title: p.title,
    brand: p.vendor || "Pitbull Cap",
    publicPrice: p.price / 100,
    imageUrl: abs(p.featured_image),
    url: `${STORE}/products/${p.handle}`,
    colors: p.variants.map((v) => ({
      name: v.option1 || v.title,
      sku: v.sku ?? "",
      available: v.available !== false,
      imageUrl: abs(v.featured_image?.src),
      variantId: v.id,
    })),
  };
}

/** Matching styles for a search box (style number or words). */
export async function searchPitbull(q: string): Promise<{ style: string; title: string; handle: string; imageUrl?: string }[]> {
  const d = await getJson<{ resources?: { results?: { products?: { title: string; handle: string; image?: string; featured_image?: { url?: string } }[] } } }>(
    `${STORE}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`
  );
  return (d?.resources?.results?.products ?? []).map((p) => ({
    style: styleFromTitle(p.title),
    title: p.title,
    handle: p.handle,
    imageUrl: abs(p.image ?? p.featured_image?.url),
  }));
}

/** Full product by style number (e.g. "PB311") or store handle. */
export async function getPitbullProduct(styleOrHandle: string): Promise<PitbullProduct | null> {
  const want = normStyle(styleOrHandle);
  const direct = await getJson<ShopifyProduct>(`${STORE}/products/${encodeURIComponent(styleOrHandle.trim().toLowerCase())}.js`);
  if (direct && styleFromTitle(direct.title) === want) return toProduct(direct);
  const hits = await searchPitbull(styleOrHandle);
  const hit = hits.find((h) => h.style === want) ?? (direct ? null : hits[0]);
  if (!hit) return direct ? toProduct(direct) : null;
  const p = await getJson<ShopifyProduct>(`${STORE}/products/${hit.handle}.js`);
  return p ? toProduct(p) : null;
}
