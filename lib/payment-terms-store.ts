import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { PaymentTermOption } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Payment terms store
// ---------------------------------------------------------------------------
// Admin-editable list of reusable payment-terms presets (e.g. "Pay in
// full", "50% deposit, 50% on pickup") offered on the quote builder's
// "Payment terms" picker (components/AdminQuoteBuilder.tsx). Each preset is
// just a label plus the deposit percentage it implies — 100 means pay in
// full. A one-off custom percentage can still be typed in on a single quote
// without being added here.
//
// Persistence follows the same single-JSON-blob + in-memory-fallback
// pattern as lib/setup-charges-store.ts.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "payment-terms.json";

const SEED_PAYMENT_TERMS: PaymentTermOption[] = [
  { id: "pay-in-full", label: "Pay in full", depositPercent: 100 },
  { id: "50-50", label: "50% deposit, 50% on pickup", depositPercent: 50 },
];

let memory: PaymentTermOption[] | null = null;

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
    console.error(`payment-terms-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<PaymentTermOption[] | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<PaymentTermOption[]>(BLOB_PATHNAME);
}

export async function getPaymentTerms(): Promise<PaymentTermOption[]> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? SEED_PAYMENT_TERMS;
  return memory;
}

export async function setPaymentTerms(
  terms: PaymentTermOption[]
): Promise<{ persisted: boolean }> {
  memory = terms;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(terms), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("payment-terms-store: blob write failed", err);
    return { persisted: false };
  }
}

export type PaymentTermInput = Omit<PaymentTermOption, "id"> & { id?: string };

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return base || "payment-term";
}

export async function createPaymentTerm(
  input: PaymentTermInput
): Promise<{ term: PaymentTermOption; persisted: boolean }> {
  const all = await getPaymentTerms();
  let id = slugify(input.label);
  if (all.some((t) => t.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const term: PaymentTermOption = { ...input, id };
  const { persisted } = await setPaymentTerms([...all, term]);
  return { term, persisted };
}

export async function updatePaymentTerm(
  id: string,
  patch: Partial<Omit<PaymentTermOption, "id">>
): Promise<{ term: PaymentTermOption | null; persisted: boolean }> {
  const all = await getPaymentTerms();
  const existing = all.find((t) => t.id === id);
  if (!existing) return { term: null, persisted: true };
  const updated: PaymentTermOption = { ...existing, ...patch, id };
  const { persisted } = await setPaymentTerms(all.map((t) => (t.id === id ? updated : t)));
  return { term: updated, persisted };
}

export async function deletePaymentTerm(
  id: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getPaymentTerms();
  if (!all.some((t) => t.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await setPaymentTerms(all.filter((t) => t.id !== id));
  return { deleted: true, persisted };
}
