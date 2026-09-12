import { put, list } from "@vercel/blob";
import { v4 as uuid } from "uuid";
import { ComputedQuote, QuoteInput } from "./quote";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Saved quotes / invoices store
// ---------------------------------------------------------------------------
// Persists quotes built in the admin Quote Builder so they live on the site
// instead of only existing for as long as the browser tab stays open. A
// saved record keeps BOTH the raw input (so it can be reopened and edited)
// and a computed pricing snapshot from the moment it was last saved — the
// snapshot is what PDFs are rendered from, so a quote or invoice a customer
// already received never silently changes if catalog/decoration pricing is
// edited later.
//
// A record starts life as a "quote". Converting it to an "invoice" assigns
// a sequential invoice number and an unpaid payment status; from there its
// payment status can be updated (unpaid / partially_paid / paid).
//
// Persistence follows the same pattern as lib/decoration-types-store.ts /
// lib/setup-charges-store.ts: a single JSON blob in Vercel Blob storage,
// with an in-memory fallback so the tool still works before a Blob store is
// connected (changes just won't survive a redeploy or cold start).
// ---------------------------------------------------------------------------

export type QuoteRecordStatus = "quote" | "invoice";
export type InvoicePaymentStatus = "unpaid" | "partially_paid" | "paid";

export type QuoteRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: QuoteInput;
  computed: ComputedQuote;
  status: QuoteRecordStatus;
  invoiceNumber?: string;
  invoiceStatus?: InvoicePaymentStatus;
  convertedAt?: string;
  paidAt?: string;
};

const BLOB_PATHNAME = "quotes.json";

let memory: QuoteRecord[] | null = null;

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
    console.error(`quotes-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function loadFromBlob(): Promise<QuoteRecord[] | null> {
  if (!isPersistent()) return null;
  return fetchBlobJson<QuoteRecord[]>(BLOB_PATHNAME);
}

async function getAll(): Promise<QuoteRecord[]> {
  if (memory) return memory;
  memory = (await loadFromBlob()) ?? [];
  return memory;
}

async function saveAll(records: QuoteRecord[]): Promise<{ persisted: boolean }> {
  memory = records;
  if (!isPersistent()) {
    return { persisted: false };
  }
  try {
    await put(BLOB_PATHNAME, JSON.stringify(records), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { persisted: true };
  } catch (err) {
    console.error("quotes-store: blob write failed", err);
    return { persisted: false };
  }
}

export async function getQuotes(): Promise<QuoteRecord[]> {
  const all = await getAll();
  // Newest first.
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getQuote(id: string): Promise<QuoteRecord | undefined> {
  const all = await getAll();
  return all.find((q) => q.id === id);
}

export async function createQuote(
  input: QuoteInput,
  computed: ComputedQuote
): Promise<{ record: QuoteRecord; persisted: boolean }> {
  const all = await getAll();
  const now = new Date().toISOString();
  const record: QuoteRecord = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    input,
    computed,
    status: "quote",
  };
  const { persisted } = await saveAll([...all, record]);
  return { record, persisted };
}

export async function updateQuoteContent(
  id: string,
  input: QuoteInput,
  computed: ComputedQuote
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const all = await getAll();
  const existing = all.find((q) => q.id === id);
  if (!existing) return { record: null, persisted: true };
  const updated: QuoteRecord = {
    ...existing,
    input,
    computed,
    updatedAt: new Date().toISOString(),
  };
  const { persisted } = await saveAll(all.map((q) => (q.id === id ? updated : q)));
  return { record: updated, persisted };
}

export async function deleteQuote(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const all = await getAll();
  if (!all.some((q) => q.id === id)) return { deleted: false, persisted: true };
  const { persisted } = await saveAll(all.filter((q) => q.id !== id));
  return { deleted: true, persisted };
}

function nextInvoiceNumber(all: QuoteRecord[]): string {
  let max = 0;
  for (const q of all) {
    const match = q.invoiceNumber?.match(/^INV-(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `INV-${String(max + 1).padStart(4, "0")}`;
}

export async function convertQuoteToInvoice(
  id: string
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const all = await getAll();
  const existing = all.find((q) => q.id === id);
  if (!existing) return { record: null, persisted: true };
  if (existing.status === "invoice") {
    // Already converted — no-op, just return it as-is.
    return { record: existing, persisted: true };
  }
  const now = new Date().toISOString();
  const updated: QuoteRecord = {
    ...existing,
    status: "invoice",
    invoiceNumber: nextInvoiceNumber(all),
    invoiceStatus: "unpaid",
    convertedAt: now,
    updatedAt: now,
  };
  const { persisted } = await saveAll(all.map((q) => (q.id === id ? updated : q)));
  return { record: updated, persisted };
}

export async function setInvoicePaymentStatus(
  id: string,
  invoiceStatus: InvoicePaymentStatus
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const all = await getAll();
  const existing = all.find((q) => q.id === id);
  if (!existing || existing.status !== "invoice") return { record: null, persisted: true };
  const now = new Date().toISOString();
  const updated: QuoteRecord = {
    ...existing,
    invoiceStatus,
    paidAt: invoiceStatus === "paid" ? now : undefined,
    updatedAt: now,
  };
  const { persisted } = await saveAll(all.map((q) => (q.id === id ? updated : q)));
  return { record: updated, persisted };
}
