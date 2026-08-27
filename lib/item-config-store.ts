import { put, list } from "@vercel/blob";
import { CatalogItemConfig } from "./types";

// ---------------------------------------------------------------------------
// Per-item decoration/placement-zone configuration store
// ---------------------------------------------------------------------------
// The admin tool at /admin lets you choose which decoration types (UV Patch,
// Engraved Patch, Embroidered, Screen Print) are offered for each catalog
// item, and — for each enabled decoration type — draw the placement zones
// (rectangles on the garment photo) customers can choose from. This module
// is a dumb persistence layer for that data, keyed by styleNumber; default
// synthesis for items with no saved config lives in the API route layer
// (app/api/admin/item-config, app/api/products/[styleNumber]), not here.
//
// Persistence: Vercel Blob (a JSON file in your Vercel Blob store), same
// pattern as lib/catalog-selection.ts and lib/pricing-store.ts. Works out of
// the box once the project has a Blob store connected (Vercel dashboard ->
// Storage -> Create Database -> Blob -> Connect to Project), which sets
// BLOB_READ_WRITE_TOKEN automatically.
//
// Until that's connected, this falls back to an in-memory value so the
// admin tool still works for a single running instance/session — but
// changes won't survive a redeploy or a cold serverless instance.
// isPersistent() reports which mode is active so the admin UI can warn you.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "item-config.json";

let memoryConfigs: Record<string, CatalogItemConfig> | null = null;

export function isPersistent(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function loadFromBlob(): Promise<Record<string, CatalogItemConfig> | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return {};
    // The connected Blob store is private, so a plain unauthenticated fetch
    // of the blob URL 403s — pass the same token the SDK itself uses.
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, CatalogItemConfig>;
    return data ?? {};
  } catch (err) {
    console.error("item-config-store: blob read failed", err);
    return null;
  }
}

export async function getAllItemConfigs(): Promise<Record<string, CatalogItemConfig>> {
  if (memoryConfigs) return memoryConfigs;
  const fromBlob = await loadFromBlob();
  memoryConfigs = fromBlob ?? {};
  return memoryConfigs;
}

export async function getItemConfig(
  styleNumber: string
): Promise<CatalogItemConfig | undefined> {
  const all = await getAllItemConfigs();
  return all[styleNumber];
}

export async function setItemConfig(
  styleNumber: string,
  config: CatalogItemConfig
): Promise<{ persisted: boolean }> {
  const all = await getAllItemConfigs();
  const next = { ...all, [styleNumber]: config };
  memoryConfigs = next;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(next), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("item-config-store: blob write failed", err);
    return { persisted: false };
  }
}
