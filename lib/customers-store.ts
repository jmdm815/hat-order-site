import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { Customer } from "./types";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Customer database
// ---------------------------------------------------------------------------
// A simple, manually-maintained address book — an admin adds a customer
// once (name, company, email, phone, notes) and can then pick them from a
// search dropdown when starting a quote in the Quote Builder
// (components/AdminQuoteBuilder.tsx / app/api/admin/customers), instead of
// retyping the same contact info every time that customer places another
// order. This is intentionally separate from lib/orders-store.ts (real
// checkout orders) and lib/quotes-store.ts (saved quotes/invoices) — a
// customer record here is just a contact card, not tied to any specific
// order or quote, and nothing here is customer-facing.
//
// Persistence: Vercel Blob (a JSON file in your Vercel Blob store), same
// pattern as lib/categories-store.ts and every other admin store in this
// codebase. Falls back to an in-memory array so the admin tool still works
// before a Blob store is connected — isPersistent() reports which mode is
// active so the UI can warn you.
// ---------------------------------------------------------------------------

const BLOB_PATHNAME = "customers.json";

let memory: Customer[] | null = null;

async function loadFromBlob(): Promise<Customer[] | null> {
  if (!isPersistent()) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return [];
    const res = await fetch(match.url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Customer[];
    return data ?? [];
  } catch (err) {
    console.error("customers-store: blob read failed", err);
    return null;
  }
}

export async function getCustomers(): Promise<Customer[]> {
  if (memory) return [...memory].sort((a, b) => a.name.localeCompare(b.name));
  const fromBlob = await loadFromBlob();
  memory = fromBlob ?? [];
  return [...memory].sort((a, b) => a.name.localeCompare(b.name));
}

async function setCustomers(customers: Customer[]): Promise<{ persisted: boolean }> {
  memory = customers;

  if (!isPersistent()) {
    return { persisted: false };
  }

  try {
    await put(BLOB_PATHNAME, JSON.stringify(customers), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("customers-store: blob write failed", err);
    return { persisted: false };
  }
}

export type CustomerInput = {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

export async function createCustomer(
  input: CustomerInput
): Promise<{ customer: Customer; persisted: boolean }> {
  const all = await getCustomers();
  const now = new Date().toISOString();
  const customer: Customer = {
    id: uuid(),
    name: input.name,
    company: input.company || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
    notes: input.notes || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const { persisted } = await setCustomers([...all, customer]);
  return { customer, persisted };
}

export async function updateCustomer(
  id: string,
  input: CustomerInput
): Promise<{ customer: Customer | null; persisted: boolean }> {
  const all = await getCustomers();
  const existing = all.find((c) => c.id === id);
  if (!existing) return { customer: null, persisted: true };
  const updated: Customer = {
    ...existing,
    name: input.name,
    company: input.company || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
    notes: input.notes || undefined,
    updatedAt: new Date().toISOString(),
  };
  const { persisted } = await setCustomers(all.map((c) => (c.id === id ? updated : c)));
  return { customer: updated, persisted };
}

export async function deleteCustomer(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getCustomers();
  if (!all.some((c) => c.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await setCustomers(all.filter((c) => c.id !== id));
  return { deleted: true, persisted };
}
