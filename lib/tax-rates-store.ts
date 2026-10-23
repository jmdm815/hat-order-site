import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { TaxRateOption } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Tax rates store
// ---------------------------------------------------------------------------
// Admin-editable list of reusable sales-tax rate presets (e.g. "No tax",
// "State sales tax — 8%") offered on the quote builder's "Tax" picker
// (components/AdminQuoteBuilder.tsx). Tax is computed only against items
// marked taxable (see lib/quote.ts) — garment lines, setup charges, and
// other charges can each be marked taxable or not individually.
//
// Persistence follows the same single-JSON-blob + in-memory-fallback
// pattern as lib/payment-terms-store.ts.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "tax-rates.json";

const SEED_TAX_RATES: TaxRateOption[] = [{ id: "no-tax", label: "No tax", ratePercent: 0 }];

let memory: TaxRateOption[] | null = null;

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
    console.error(`tax-rates-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<TaxRateOption[] | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<TaxRateOption[]>(BLOB_PATHNAME);
}

export async function getTaxRates(): Promise<TaxRateOption[]> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? SEED_TAX_RATES;
  return memory;
}

export async function setTaxRates(rates: TaxRateOption[]): Promise<{ persisted: boolean }> {
  memory = rates;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(rates), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("tax-rates-store: blob write failed", err);
    return { persisted: false };
  }
}

export type TaxRateInput = Omit<TaxRateOption, "id"> & { id?: string };

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return base || "tax-rate";
}

export async function createTaxRate(
  input: TaxRateInput
): Promise<{ rate: TaxRateOption; persisted: boolean }> {
  const all = await getTaxRates();
  let id = slugify(input.label);
  if (all.some((r) => r.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const rate: TaxRateOption = { ...input, id };
  const { persisted } = await setTaxRates([...all, rate]);
  return { rate, persisted };
}

export async function updateTaxRate(
  id: string,
  patch: Partial<Omit<TaxRateOption, "id">>
): Promise<{ rate: TaxRateOption | null; persisted: boolean }> {
  const all = await getTaxRates();
  const existing = all.find((r) => r.id === id);
  if (!existing) return { rate: null, persisted: true };
  const updated: TaxRateOption = { ...existing, ...patch, id };
  const { persisted } = await setTaxRates(all.map((r) => (r.id === id ? updated : r)));
  return { rate: updated, persisted };
}

export async function deleteTaxRate(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getTaxRates();
  if (!all.some((r) => r.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await setTaxRates(all.filter((r) => r.id !== id));
  return { deleted: true, persisted };
}
