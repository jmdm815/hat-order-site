import { put, list, del } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Sewout library store
// ---------------------------------------------------------------------------
// A searchable record of every logo JM has embroidered: a photo of the
// physical sew-out plus the details staff need to run it again (customer,
// stitch count, size, thread colors, placement, where the stitch file lives
// in Google Drive). Browsed at /admin/sewouts (components/AdminSewoutLibrary).
//
// Same one-blob-per-record design as lib/jobs-store.ts / quotes-store.ts —
// sewouts/{id}.json — so two people adding sew-outs at the same time can
// never clobber each other. Photos live in the private Blob store under
// sewout-photos/ and are served through the /api/item-photo proxy.
// ---------------------------------------------------------------------------

export type SewoutPhoto = { blobUrl: string; addedAt: string };

export type Sewout = {
  id: string;
  customerId?: string;
  customerName: string;
  designName: string;
  photos: SewoutPhoto[];
  // Square crop of just the stitched swatch, shown on library cards so they
  // look clean (no worksheet/paper around it). Made with the crop tool.
  coverBlobUrl?: string;
  stitchCount?: number;
  widthIn?: number;
  heightIn?: number;
  threadColors?: string; // free text, e.g. "Navy 1967, White 1001"
  placement?: string; // e.g. "Left chest", "Cap front"
  fileLocation?: string; // Drive path to the .DST/.EMB, e.g. "My Drive/Embroidery/…"
  fileUrl?: string; // Drive link to it
  notes?: string;
  tags?: string; // extra search words
  createdAt: string;
  updatedAt: string;
};

export type SewoutFields = Omit<Sewout, "id" | "photos" | "createdAt" | "updatedAt">;

const PREFIX = "sewouts/";
const pathFor = (id: string) => `${PREFIX}${encodeURIComponent(id)}.json`;

let memoryIndex: Map<string, Sewout> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getSewouts(): Promise<Sewout[]> {
  let records: Sewout[];
  if (!isPersistent()) {
    records = memoryIndex ? Array.from(memoryIndex.values()) : [];
  } else {
    try {
      const blobs = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const found = await Promise.all(blobs.map((b) => fetchJson<Sewout>(b.url)));
      records = found.filter((r): r is Sewout => r !== null);
    } catch (err) {
      console.error("sewouts-store: list failed", err);
      records = [];
    }
  }
  return records.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.designName.localeCompare(b.designName));
}

export async function getSewout(id: string): Promise<Sewout | null> {
  if (!isPersistent()) return memoryIndex?.get(id) ?? null;
  try {
    const { blobs } = await list({ prefix: pathFor(id), limit: 1 });
    const match = blobs.find((b) => b.pathname === pathFor(id));
    return match ? fetchJson<Sewout>(match.url) : null;
  } catch {
    return null;
  }
}

async function writeSewout(record: Sewout): Promise<{ persisted: boolean }> {
  if (!memoryIndex) memoryIndex = new Map();
  memoryIndex.set(record.id, record);
  if (!isPersistent()) return { persisted: false };
  await put(pathFor(record.id), JSON.stringify(record), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return { persisted: true };
}

function clean(fields: Partial<SewoutFields>): Partial<SewoutFields> {
  const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return {
    customerId: str(fields.customerId, 80),
    customerName: str(fields.customerName, 120) ?? "",
    designName: str(fields.designName, 120) ?? "",
    stitchCount: num(fields.stitchCount),
    widthIn: num(fields.widthIn),
    heightIn: num(fields.heightIn),
    threadColors: str(fields.threadColors),
    placement: str(fields.placement, 80),
    fileLocation: str(fields.fileLocation, 500),
    fileUrl: str(fields.fileUrl, 500)?.match(/^https:\/\/(drive|docs)\.google\.com\//) ? str(fields.fileUrl, 500) : undefined,
    notes: str(fields.notes, 2000),
    tags: str(fields.tags),
  };
}

export async function createSewout(id: string, fields: Partial<SewoutFields>, photos: SewoutPhoto[], coverBlobUrl?: string) {
  const now = new Date().toISOString();
  const record: Sewout = {
    ...(clean(fields) as SewoutFields),
    id,
    photos,
    ...(coverBlobUrl ? { coverBlobUrl } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const { persisted } = await writeSewout(record);
  return { record, persisted };
}

export async function updateSewout(id: string, fields: Partial<SewoutFields>, base?: Sewout) {
  const existing = base ?? (await getSewout(id));
  if (!existing) return { record: null, persisted: true };
  const record: Sewout = { ...existing, ...(clean(fields) as SewoutFields), updatedAt: new Date().toISOString() };
  const { persisted } = await writeSewout(record);
  return { record, persisted };
}

export async function setSewoutCover(id: string, coverBlobUrl: string | undefined) {
  const existing = await getSewout(id);
  if (!existing) return { record: null, previous: undefined, persisted: true };
  const record: Sewout = { ...existing, coverBlobUrl, updatedAt: new Date().toISOString() };
  const { persisted } = await writeSewout(record);
  return { record, previous: existing.coverBlobUrl, persisted };
}

export async function setSewoutPhotos(id: string, photos: SewoutPhoto[]) {
  const existing = await getSewout(id);
  if (!existing) return { record: null, persisted: true };
  const record: Sewout = { ...existing, photos, updatedAt: new Date().toISOString() };
  const { persisted } = await writeSewout(record);
  return { record, persisted };
}

export async function deleteSewout(id: string) {
  const existing = await getSewout(id);
  memoryIndex?.delete(id);
  if (!isPersistent()) return { deleted: !!existing };
  await del(pathFor(id)).catch(() => {});
  for (const p of existing?.photos ?? []) await del(p.blobUrl).catch(() => {});
  if (existing?.coverBlobUrl) await del(existing.coverBlobUrl).catch(() => {});
  return { deleted: !!existing };
}

export { normalizeSearch, scoreSewout, sewoutSearchText } from "./sewout-search";
