import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { SetupChargeType } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Setup charges store
// ---------------------------------------------------------------------------
// Admin-editable catalog of named, flat one-time setup/digitization charges
// (e.g. "Digitizing for embroidery" — $35, "Logo vectorization" — $20) used
// by the admin quote builder (lib/quote.ts, components/AdminQuoteBuilder.tsx,
// components/AdminSetupChargesManager.tsx). These are independent of
// decoration types — a quote picks zero or more of them directly, rather
// than one being derived automatically from whichever decoration was chosen.
//
// Persistence follows the same pattern as lib/decoration-types-store.ts: a
// single JSON blob in Vercel Blob storage, with an in-memory fallback so the
// admin tool still works before a Blob store is connected.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "setup-charges.json";

const SEED_SETUP_CHARGES: SetupChargeType[] = [
  { id: "digitizing-embroidery", label: "Digitizing for embroidery", price: 35 },
  { id: "logo-vectorization", label: "Logo vectorization", price: 20 },
  { id: "screen-print-screen-fee", label: "Screen print screen fee (per color)", price: 25 },
];

let memory: SetupChargeType[] | null = null;

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
    console.error(`setup-charges-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<SetupChargeType[] | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<SetupChargeType[]>(BLOB_PATHNAME);
}

export async function getSetupCharges(): Promise<SetupChargeType[]> {
  if (memory) return memory;
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? SEED_SETUP_CHARGES;
  return memory;
}

export async function setSetupCharges(
  charges: SetupChargeType[]
): Promise<{ persisted: boolean }> {
  memory = charges;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(charges), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("setup-charges-store: blob write failed", err);
    return { persisted: false };
  }
}

export type SetupChargeTypeInput = Omit<SetupChargeType, "id"> & { id?: string };

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return base || "setup-charge";
}

export async function createSetupCharge(
  input: SetupChargeTypeInput
): Promise<{ charge: SetupChargeType; persisted: boolean }> {
  const all = await getSetupCharges();
  let id = slugify(input.label);
  if (all.some((c) => c.id === id)) {
    id = `${id}-${uuid().slice(0, 8)}`;
  }
  const charge: SetupChargeType = { ...input, id };
  const { persisted } = await setSetupCharges([...all, charge]);
  return { charge, persisted };
}

export async function updateSetupCharge(
  id: string,
  patch: Partial<Omit<SetupChargeType, "id">>
): Promise<{ charge: SetupChargeType | null; persisted: boolean }> {
  const all = await getSetupCharges();
  const existing = all.find((c) => c.id === id);
  if (!existing) return { charge: null, persisted: true };
  const updated: SetupChargeType = { ...existing, ...patch, id };
  const { persisted } = await setSetupCharges(all.map((c) => (c.id === id ? updated : c)));
  return { charge: updated, persisted };
}

export async function deleteSetupCharge(
  id: string
): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getSetupCharges();
  if (!all.some((c) => c.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await setSetupCharges(all.filter((c) => c.id !== id));
  return { deleted: true, persisted };
}
