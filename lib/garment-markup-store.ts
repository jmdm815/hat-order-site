import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { GarmentMarkupSettings } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Garment markup store
// ---------------------------------------------------------------------------
// Admin-editable matrix of cost-based markup breakpoints applied to garment
// (blank) cost in the admin quote builder (lib/quote.ts,
// components/AdminQuoteBuilder.tsx, components/AdminGarmentMarkupManager.tsx)
// — and, as of the fix that added lib/garment-markup.ts's
// applyGarmentMarkupToProduct(), every customer-facing surface too
// (app/api/products/[styleNumber]/route.ts, app/api/catalog/route.ts,
// lib/curated-catalog.ts): the catalog listing, the homepage "Starting at"
// price, the live designer/cart, and the customer quote tools. A garment
// whose vendor cost falls in a breakpoint's [from, to] range is marked up by
// that breakpoint's percentage before decoration cost is added — e.g. cost
// $2.00 at a 100% breakpoint sells for $2.00 + (100% * $2.00) = $4.00.
// Before that fix, every customer-facing surface priced garments straight
// from raw SanMar cost with no markup at all — only the admin quote builder
// applied it, which is what caused a real customer quote generated outside
// this site to disagree with a manually-computed one.
//
// Persistence follows the same pattern as lib/setup-charges-store.ts: a
// single JSON blob in Vercel Blob storage, with an in-memory fallback so the
// admin tool still works before a Blob store is connected.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "garment-markup.json";

const SEED_SETTINGS: GarmentMarkupSettings = {
  breakpoints: [
    { id: "bp-1", from: 0, to: 35, markupPercent: 30 },
    { id: "bp-2", from: 35, to: 60, markupPercent: 45 },
    { id: "bp-3", from: 61, to: 100, markupPercent: 65 },
  ],
  lookupMode: "per-style-quantity",
};

let memory: GarmentMarkupSettings | null = null;

async function fetchBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    const match = blobs.find((b) => b.pathname === pathname);
    if (!match) return null;
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`garment-markup-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<GarmentMarkupSettings | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<GarmentMarkupSettings>(BLOB_PATHNAME);
}

export async function getGarmentMarkupSettings(): Promise<GarmentMarkupSettings> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? SEED_SETTINGS;
  return memory;
}

export async function setGarmentMarkupSettings(
  settings: GarmentMarkupSettings
): Promise<{ persisted: boolean }> {
  // Backfill ids for any breakpoint the client sent without one (e.g. a
  // freshly-added row).
  const withIds: GarmentMarkupSettings = {
    ...settings,
    breakpoints: settings.breakpoints.map((bp) => ({ ...bp, id: bp.id || uuid() })),
  };
  memory = withIds;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(withIds), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("garment-markup-store: blob write failed", err);
    return { persisted: false };
  }
}
