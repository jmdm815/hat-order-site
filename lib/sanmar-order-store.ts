import { list, put } from "@vercel/blob";

// ---------------------------------------------------------------------------
// The working SanMar order list (app/admin/sanmar-order) — what still needs
// to go into the sanmar.com shopping box. One small JSON blob so the admin
// page and Claude (via GET /api/admin/sanmar-order) see the same list.
// ---------------------------------------------------------------------------

export type SanmarOrderSource = { quoteId: string; label: string; qty: number };
export type SanmarOrderItem = {
  style: string;
  color: string;
  size: string;
  qty: number;
  sources: SanmarOrderSource[]; // which quotes this quantity came from (empty = added by hand)
};
export type SanmarOrderList = {
  items: SanmarOrderItem[];
  status: "draft" | "in-shopping-box";
  updatedAt: string;
  addedToBoxAt?: string;
  note?: string;
};

const PATHNAME = "sanmar-order/current.json";
const EMPTY: SanmarOrderList = { items: [], status: "draft", updatedAt: new Date(0).toISOString() };
let memory: SanmarOrderList | null = null;

function persistent() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function getSanmarOrder(): Promise<SanmarOrderList> {
  if (!persistent()) return memory ?? EMPTY;
  try {
    const { blobs } = await list({ prefix: PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === PATHNAME);
    if (!match) return EMPTY;
    const res = await fetch(`${match.url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return memory ?? EMPTY;
    const data = (await res.json()) as SanmarOrderList;
    return Array.isArray(data?.items) ? data : EMPTY;
  } catch (err) {
    console.error("sanmar-order-store: read failed", err);
    return memory ?? EMPTY;
  }
}

export async function saveSanmarOrder(order: SanmarOrderList): Promise<{ order: SanmarOrderList; persisted: boolean }> {
  const clean: SanmarOrderList = {
    ...order,
    items: mergeItems(order.items).filter((i) => i.qty > 0),
    updatedAt: new Date().toISOString(),
  };
  memory = clean;
  if (!persistent()) return { order: clean, persisted: false };
  try {
    await put(PATHNAME, JSON.stringify(clean), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { order: clean, persisted: true };
  } catch (err) {
    console.error("sanmar-order-store: write failed", err);
    return { order: clean, persisted: false };
  }
}

const key = (i: { style: string; color: string; size: string }) =>
  `${i.style.trim().toUpperCase()}|${i.color.trim().toLowerCase()}|${i.size.trim().toUpperCase()}`;

/** Combine rows for the same style/color/size, adding quantities and sources. */
export function mergeItems(items: SanmarOrderItem[]): SanmarOrderItem[] {
  const map = new Map<string, SanmarOrderItem>();
  for (const raw of items) {
    const item: SanmarOrderItem = {
      style: String(raw.style || "").trim().toUpperCase(),
      color: String(raw.color || "").trim(),
      size: String(raw.size || "").trim().toUpperCase(),
      qty: Math.max(0, Math.round(Number(raw.qty) || 0)),
      sources: Array.isArray(raw.sources) ? raw.sources : [],
    };
    if (!item.style || !item.color || !item.size) continue;
    const k = key(item);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, item);
      continue;
    }
    existing.qty += item.qty;
    for (const s of item.sources) {
      const same = existing.sources.find((x) => x.quoteId === s.quoteId);
      if (same) same.qty += s.qty;
      else existing.sources.push({ ...s });
    }
  }
  return Array.from(map.values());
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "4XL", "5XL", "6XL", "OSFA"];
export function sizeRank(size: string): number {
  const s = size.toUpperCase();
  const i = SIZE_ORDER.indexOf(s === "XXL" ? "2XL" : s);
  return i === -1 ? 50 : i;
}
