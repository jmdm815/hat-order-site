import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { Product } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Custom products store
// ---------------------------------------------------------------------------
// The catalog is otherwise 100% sourced from the live SanMar feed (see
// lib/sanmar.ts) — this store is the one place an admin can add a product by
// hand instead, for two reasons: (1) some product types (Tumblers) aren't in
// that feed at all, and (2) even for hats/shirts an admin may want to sell
// something SanMar doesn't carry. A custom product is a full Product object,
// so it flows through every existing catalog/customize/cart code path
// exactly like a SanMar one — the only tell is `isCustom: true` and a
// generated "custom-<id>" styleNumber standing in for a real SanMar style
// number (see lib/item-config-store.ts, which is happy to key decoration
// config off any string).
//
// Persistence follows the same pattern as the rest of this codebase's admin
// config: a single JSON blob in Vercel Blob storage, with an in-memory
// fallback so the admin tool still works before a Blob store is connected.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "custom-products.json";

let memory: Product[] | null = null;

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
    console.error(`custom-products-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<Product[] | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<Product[]>(BLOB_PATHNAME);
}

export async function getCustomProducts(): Promise<Product[]> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? [];
  return memory;
}

export async function getCustomProductsForType(productType: Product["productType"]): Promise<Product[]> {
  const all = await getCustomProducts();
  return all.filter((p) => p.productType === productType);
}

export async function getCustomProductByStyleNumber(styleNumber: string): Promise<Product | undefined> {
  const all = await getCustomProducts();
  return all.find((p) => p.styleNumber === styleNumber);
}

async function setCustomProducts(products: Product[]): Promise<{ persisted: boolean }> {
  memory = products;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(products), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("custom-products-store: blob write failed", err);
    return { persisted: false };
  }
}

export type CustomProductInput = Omit<Product, "styleNumber" | "isCustom"> & {
  styleNumber?: string;
};

export async function createCustomProduct(
  input: CustomProductInput
): Promise<{ product: Product; persisted: boolean }> {
  const all = await getCustomProducts();
  // The admin UI generates an id up front (see components/AdminCatalogManager.tsx)
  // so it can upload photos — keyed by that id — before the product itself
  // exists; honor it here if given (de-duped against a collision, which
  // should never actually happen with a uuid) rather than generating a
  // fresh one that wouldn't match the already-uploaded photos.
  let styleNumber = input.styleNumber?.startsWith("custom-")
    ? input.styleNumber
    : `custom-${uuid().slice(0, 8)}`;
  if (all.some((p) => p.styleNumber === styleNumber)) {
    styleNumber = `custom-${uuid().slice(0, 8)}`;
  }
  const product: Product = { ...input, styleNumber, isCustom: true };
  const { persisted } = await setCustomProducts([...all, product]);
  return { product, persisted };
}

export async function updateCustomProduct(
  styleNumber: string,
  patch: Partial<Omit<Product, "styleNumber" | "isCustom">>
): Promise<{ product: Product | null; persisted: boolean }> {
  const all = await getCustomProducts();
  const existing = all.find((p) => p.styleNumber === styleNumber);
  if (!existing) return { product: null, persisted: true };
  const updated: Product = { ...existing, ...patch, styleNumber, isCustom: true };
  const { persisted } = await setCustomProducts(
    all.map((p) => (p.styleNumber === styleNumber ? updated : p))
  );
  return { product: updated, persisted };
}

export async function deleteCustomProduct(
  styleNumber: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getCustomProducts();
  if (!all.some((p) => p.styleNumber === styleNumber)) return { deleted: false, persisted: true };
  const { persisted } = await setCustomProducts(all.filter((p) => p.styleNumber !== styleNumber));
  return { deleted: true, persisted };
}
