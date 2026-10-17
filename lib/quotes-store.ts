import { put, list, del } from "@vercel/blob";
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
// Persistence: ONE JSON blob PER QUOTE (quotes/{id}.json), not a single
// combined quotes.json array the way most other admin stores in this
// codebase work (lib/decoration-types-store.ts, lib/setup-charges-store.ts,
// etc). That single-blob-list design previously used here did a
// non-atomic read-the-whole-list -> modify -> write-the-whole-list-back on
// *every* create/update/delete — so any two saves anywhere in the store
// racing within the same stretch of time would silently lose whichever one
// wrote last (a classic lost update). This was confirmed happening live:
// a quote saved successfully (the API call returned persisted: true) could
// vanish entirely moments later because a second, unrelated save overwrote
// the whole list without it, which is also what produced the "quote not
// found" errors on save/PDF-download the admin ran into. Giving every quote
// its own blob path means two saves to two *different* quotes can never
// race with each other — they touch different files; only two concurrent
// saves of the literal same quote id can still race, a far narrower and
// rarer case. Reads always go straight to Blob (no indefinite in-memory
// cache to go stale across serverless instances); the in-memory fallback
// below is only used when Blob isn't connected at all.
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

const PREFIX = "quotes/";
// The old, pre-migration combined-list blob — see "Legacy migration" below.
const LEGACY_PATHNAME = "quotes.json";

function pathFor(id: string): string {
  return `${PREFIX}${id}.json`;
}

// Non-persistent fallback only (Blob not connected at all) — every write
// still lands here too, just so a same-instance read-after-write works out
// of the box in that mode, same as the rest of this codebase.
let memoryIndex: Map<string, QuoteRecord> | null = null;

function memoryList(): QuoteRecord[] {
  return memoryIndex ? Array.from(memoryIndex.values()) : [];
}

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

// ---------------------------------------------------------------------------
// Legacy migration — one-time, per warm instance (memoized via this
// promise so concurrent calls don't all kick it off at once). Reads the
// old combined quotes.json blob (if it still exists) and writes out any
// record from it that doesn't already have its own quotes/{id}.json yet,
// so quotes saved before this store switched to per-record blobs aren't
// orphaned. Safe to run more than once — it only ever adds a record that's
// missing, never overwrites one that's already been migrated or
// since-updated under the new scheme.
// ---------------------------------------------------------------------------
let legacyMigration: Promise<void> | null = null;

function migrateLegacyIfNeeded(): Promise<void> {
  if (!isPersistent()) return Promise.resolve();
  if (!legacyMigration) {
    legacyMigration = (async () => {
      try {
        const legacy = await fetchBlobJson<QuoteRecord[]>(LEGACY_PATHNAME);
        if (!legacy || legacy.length === 0) return;
        await Promise.all(
          legacy.map(async (record) => {
            if (!record?.id) return;
            const already = await fetchBlobJson<QuoteRecord>(pathFor(record.id));
            if (already) return;
            try {
              await put(pathFor(record.id), JSON.stringify(record), {
                access: "private",
                addRandomSuffix: false,
                allowOverwrite: false,
                contentType: "application/json",
              });
            } catch (err) {
              console.error(`quotes-store: legacy migration write failed for ${record.id}`, err);
            }
          })
        );
      } catch (err) {
        console.error("quotes-store: legacy migration failed", err);
      }
    })();
  }
  return legacyMigration;
}

async function readRecord(id: string): Promise<QuoteRecord | null> {
  await migrateLegacyIfNeeded();
  if (!isPersistent()) return memoryIndex?.get(id) ?? null;
  return fetchBlobJson<QuoteRecord>(pathFor(id));
}

async function writeRecord(record: QuoteRecord): Promise<{ persisted: boolean }> {
  if (!memoryIndex) memoryIndex = new Map();
  memoryIndex.set(record.id, record);
  if (!isPersistent()) return { persisted: false };
  try {
    await put(pathFor(record.id), JSON.stringify(record), {
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

async function removeRecord(id: string): Promise<{ persisted: boolean }> {
  memoryIndex?.delete(id);
  if (!isPersistent()) return { persisted: false };
  try {
    await del(pathFor(id));
    return { persisted: true };
  } catch (err) {
    console.error("quotes-store: blob delete failed", err);
    return { persisted: false };
  }
}

export async function getQuotes(): Promise<QuoteRecord[]> {
  await migrateLegacyIfNeeded();
  if (!isPersistent()) {
    return memoryList().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  try {
    const { blobs } = await list({ prefix: PREFIX });
    const records = await Promise.all(
      blobs.map(async (b) => {
        try {
          const res = await fetch(b.url, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
          });
          if (!res.ok) return null;
          return (await res.json()) as QuoteRecord;
        } catch {
          return null;
        }
      })
    );
    const valid = records.filter((r): r is QuoteRecord => r !== null);
    return valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    console.error("quotes-store: blob list failed", err);
    return memoryList().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export async function getQuote(id: string): Promise<QuoteRecord | undefined> {
  const record = await readRecord(id);
  return record ?? undefined;
}

export async function createQuote(
  input: QuoteInput,
  computed: ComputedQuote
): Promise<{ record: QuoteRecord; persisted: boolean }> {
  const now = new Date().toISOString();
  const record: QuoteRecord = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    input,
    computed,
    status: "quote",
  };
  const { persisted } = await writeRecord(record);
  return { record, persisted };
}

export async function updateQuoteContent(
  id: string,
  input: QuoteInput,
  computed: ComputedQuote
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  const updated: QuoteRecord = {
    ...existing,
    input,
    computed,
    updatedAt: new Date().toISOString(),
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

export async function deleteQuote(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { deleted: false, persisted: true };
  const { persisted } = await removeRecord(id);
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
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  if (existing.status === "invoice") {
    // Already converted — no-op, just return it as-is.
    return { record: existing, persisted: true };
  }
  // Scanning every quote for the current max invoice number (rather than a
  // dedicated counter) means two quotes converted at the exact same instant
  // could theoretically land on the same number — a narrow edge case, and
  // no narrower than the lost-update risk the per-record redesign above
  // specifically set out to close, so left as-is rather than adding a
  // separate counter blob for this one rare case.
  const all = await getQuotes();
  const now = new Date().toISOString();
  const updated: QuoteRecord = {
    ...existing,
    status: "invoice",
    invoiceNumber: nextInvoiceNumber(all),
    invoiceStatus: "unpaid",
    convertedAt: now,
    updatedAt: now,
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

export async function setInvoicePaymentStatus(
  id: string,
  invoiceStatus: InvoicePaymentStatus
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing || existing.status !== "invoice") return { record: null, persisted: true };
  const now = new Date().toISOString();
  const updated: QuoteRecord = {
    ...existing,
    invoiceStatus,
    paidAt: invoiceStatus === "paid" ? now : undefined,
    updatedAt: now,
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}
