import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { DecorationOption, ProductType } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Decoration types store
// ---------------------------------------------------------------------------
// Full CRUD, admin-editable replacement for the old hardcoded
// DECORATION_OPTIONS + DECORATION_TYPES_BY_PRODUCT constants. An admin can
// add brand-new decoration types from scratch, rename/edit existing ones
// (label, description, hat/shirt availability, accepted file types,
// turnaround, and pricing), and delete ones they don't use — see
// app/api/admin/decoration-types/route.ts and
// components/AdminDecorationTypesManager.tsx.
//
// Persistence follows the same pattern as the rest of this codebase's admin
// config (lib/pricing-store.ts, lib/item-config-store.ts,
// lib/catalog-selection.ts): a single JSON blob in Vercel Blob storage, with
// an in-memory fallback so the admin tool still works before a Blob store is
// connected (changes just won't survive a redeploy or cold start).
// ---------------------------------------------------------------------------

export type { DecorationOption } from "./types";

const BLOB_PATHNAME = "decoration-types.json";

// Legacy blob key from before decoration types were fully admin-editable —
// only the setup fee + pricing tiers were overridable, keyed by the fixed
// 4 built-in ids. Read once, best-effort, to carry forward any pricing an
// admin had already customized the first time this store initializes.
const LEGACY_PRICING_BLOB_PATHNAME = "pricing-overrides.json";
type LegacyPricingOverride = {
  setupFee: number;
  pricingTiers: { minQty: number; pricePerUnit: number }[];
};

const SEED_DECORATION_TYPES: DecorationOption[] = [
  {
    id: "uv-patch",
    label: "UV Patch",
    shortLabel: "UV Patch",
    description:
      "Full-color logos printed on a durable patch. Textured option available for a premium feel.",
    productTypes: ["hat"],
    minQuantity: 12,
    setupFee: 35,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 6.5 },
      { minQty: 24, pricePerUnit: 5.75 },
      { minQty: 48, pricePerUnit: 5.0 },
      { minQty: 96, pricePerUnit: 4.25 },
      { minQty: 144, pricePerUnit: 3.75 },
    ],
    turnaroundDays: "10-12 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
  {
    id: "engraved-patch",
    label: "Engraved (Laser) Patch",
    shortLabel: "Engraved Patch",
    description:
      "The classic patch. Laser-etched leatherette for a clean, single-tone look.",
    productTypes: ["hat"],
    minQuantity: 12,
    setupFee: 30,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 5.75 },
      { minQty: 24, pricePerUnit: 5.0 },
      { minQty: 48, pricePerUnit: 4.4 },
      { minQty: 96, pricePerUnit: 3.75 },
      { minQty: 144, pricePerUnit: 3.25 },
    ],
    turnaroundDays: "8-10 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
  {
    id: "embroidered",
    label: "Embroidered Design / Patch",
    shortLabel: "Embroidered",
    description: "Classic stitched logo, flat or with 3D puff.",
    productTypes: ["hat", "shirt"],
    minQuantity: 12,
    setupFee: 45,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 7.0 },
      { minQty: 24, pricePerUnit: 6.25 },
      { minQty: 48, pricePerUnit: 5.5 },
      { minQty: 96, pricePerUnit: 4.75 },
      { minQty: 144, pricePerUnit: 4.1 },
    ],
    turnaroundDays: "10-14 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".dst"],
  },
  {
    id: "screen-print",
    label: "Screen Print",
    shortLabel: "Screen Print",
    description:
      "Durable ink printed directly onto the garment. Best for bold single- or multi-color designs at higher quantities.",
    productTypes: ["shirt"],
    minQuantity: 12,
    setupFee: 25,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 4.5 },
      { minQty: 24, pricePerUnit: 3.75 },
      { minQty: 48, pricePerUnit: 3.0 },
      { minQty: 96, pricePerUnit: 2.5 },
      { minQty: 144, pricePerUnit: 2.0 },
    ],
    turnaroundDays: "7-10 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
  {
    id: "laser-engraved",
    label: "Laser Engraved",
    shortLabel: "Laser Engraved",
    description: "Single-tone logo etched directly into the tumbler's finish. Durable, no ink to wear off.",
    productTypes: ["tumbler"],
    minQuantity: 12,
    setupFee: 25,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 4.0 },
      { minQty: 24, pricePerUnit: 3.25 },
      { minQty: 48, pricePerUnit: 2.75 },
      { minQty: 96, pricePerUnit: 2.25 },
      { minQty: 144, pricePerUnit: 1.85 },
    ],
    turnaroundDays: "7-10 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
  {
    id: "uv-print",
    label: "UV Print (Full Color)",
    shortLabel: "UV Print",
    description: "Full-color logo printed directly onto the tumbler — best for multi-color or photo logos.",
    productTypes: ["tumbler"],
    minQuantity: 12,
    setupFee: 35,
    pricingTiers: [
      { minQty: 12, pricePerUnit: 5.5 },
      { minQty: 24, pricePerUnit: 4.5 },
      { minQty: 48, pricePerUnit: 3.75 },
      { minQty: 96, pricePerUnit: 3.0 },
      { minQty: 144, pricePerUnit: 2.5 },
    ],
    turnaroundDays: "8-10 business days",
    acceptedFileTypes: [".png", ".jpg", ".pdf", ".ai", ".svg"],
  },
];

let memory: DecorationOption[] | null = null;

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
    console.error(`decoration-types-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function seedWithLegacyPricing(): Promise<DecorationOption[]> {
  if (!isPersistent()) return SEED_DECORATION_TYPES;
  const legacy = await fetchBlobJson<Partial<Record<string, LegacyPricingOverride>>>(
    LEGACY_PRICING_BLOB_PATHNAME
  );
  if (!legacy) return SEED_DECORATION_TYPES;
  return SEED_DECORATION_TYPES.map((d) => {
    const override = legacy[d.id];
    if (!override) return d;
    return { ...d, setupFee: override.setupFee, pricingTiers: override.pricingTiers };
  });
}

async function loadFromBlob(): Promise<DecorationOption[] | null> {
  if (!isPersistent()) return null;
  const data = await fetchBlobJson<DecorationOption[]>(BLOB_PATHNAME);
  return data;
}

export async function getDecorationTypes(): Promise<DecorationOption[]> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? (await seedWithLegacyPricing());
  return memory;
}

export async function getDecorationTypesForProduct(
  productType: ProductType
): Promise<DecorationOption[]> {
  const all = await getDecorationTypes();
  return all.filter((d) => d.productTypes.includes(productType));
}

export async function getDecorationTypeIdsForProduct(
  productType: ProductType
): Promise<string[]> {
  const forProduct = await getDecorationTypesForProduct(productType);
  return forProduct.map((d) => d.id);
}

export async function setDecorationTypes(
  types: DecorationOption[]
): Promise<{ persisted: boolean }> {
  memory = types;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(types), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("decoration-types-store: blob write failed", err);
    return { persisted: false };
  }
}

export type DecorationTypeInput = Omit<DecorationOption, "id"> & { id?: string };

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return base || "decoration";
}

export async function createDecorationType(
  input: DecorationTypeInput
): Promise<{ decoration: DecorationOption; persisted: boolean }> {
  const all = await getDecorationTypes();
  let id = slugify(input.label);
  if (all.some((d) => d.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const decoration: DecorationOption = { ...input, id };
  const { persisted } = await setDecorationTypes([...all, decoration]);
  return { decoration, persisted };
}

export async function updateDecorationType(
  id: string,
  patch: Partial<Omit<DecorationOption, "id">>
): Promise<{ decoration: DecorationOption | null; persisted: boolean }> {
  const all = await getDecorationTypes();
  const existing = all.find((d) => d.id === id);
  if (!existing) return { decoration: null, persisted: true };
  const updated: DecorationOption = { ...existing, ...patch, id };
  const { persisted } = await setDecorationTypes(
    all.map((d) => (d.id === id ? updated : d))
  );
  return { decoration: updated, persisted };
}

export async function deleteDecorationType(
  id: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getDecorationTypes();
  if (!all.some((d) => d.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await setDecorationTypes(all.filter((d) => d.id !== id));
  return { deleted: true, persisted };
}
