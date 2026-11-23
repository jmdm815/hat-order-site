import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";
import type { GangSheetRecord } from "./gang-sheet";

// One private blob per sheet: gang-sheets/records/<id>.json
const prefix = "gang-sheets/records/";
const memory = new Map<string, GangSheetRecord>();

export async function saveSheet(rec: GangSheetRecord) {
  memory.set(rec.id, rec);
  if (!isPersistent()) return;
  await put(`${prefix}${rec.id}.json`, JSON.stringify(rec), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function getSheet(id: string): Promise<GangSheetRecord | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  if (!isPersistent()) return memory.get(id) ?? null;
  const { blobs } = await list({ prefix: `${prefix}${id}.json`, limit: 1 });
  const b = blobs[0];
  if (!b) return null;
  const res = await fetch(`${b.url}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  return res.ok ? ((await res.json()) as GangSheetRecord) : null;
}

/** Download a private blob (customer uploads, renders). */
export async function fetchPrivateBlob(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
}

export function isOurBlobUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com") && u.pathname.startsWith("/gang-sheets/");
  } catch {
    return false;
  }
}
