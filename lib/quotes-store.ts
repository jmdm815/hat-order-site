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
  // Human-readable sequential number assigned at creation (e.g. "QT-1001"),
  // distinct from `id` (an opaque uuid used for the blob path/URL) — shown
  // to the admin and on quote PDFs instead of the uuid. See
  // nextQuoteNumber() below. Optional only because records saved before
  // this field existed don't have one; createQuote always sets it on any
  // new record going forward.
  quoteNumber?: string;
  createdAt: string;
  updatedAt: string;
  input: QuoteInput;
  computed: ComputedQuote;
  status: QuoteRecordStatus;
  invoiceNumber?: string;
  invoiceStatus?: InvoicePaymentStatus;
  convertedAt?: string;
  paidAt?: string;
  // Square "Pay online" link — see lib/square-payment-links.ts and
  // app/api/admin/quotes/[id]/payment-link/route.ts. Available on a plain
  // quote now too (not just an invoice), so a deposit can be collected
  // before the order is ever converted — paymentLinkUrl is what gets handed
  // to the customer; paymentLinkId and squareOrderId are kept so a later
  // Square webhook event (app/api/webhooks/square/route.ts) can be matched
  // back to this record and flip invoiceStatus to "paid" automatically once
  // Square confirms the charge, AND so a later edit to this quote/invoice
  // can update that same order's line items in place (same URL, new amount)
  // instead of minting a new link every time — see refreshOrCreatePaymentLink
  // in lib/square-payment-links.ts. squarePaymentId is filled in once a
  // charge actually completes (or once an admin manually enters/confirms
  // one). paymentLinkAmount/paymentLinkKind record what the link's current
  // amount represents, so app/api/admin/quotes/[id]/route.ts's save handler
  // knows whether (and to what) to automatically refresh it after an edit.
  paymentLinkUrl?: string;
  paymentLinkId?: string;
  squareOrderId?: string;
  squarePaymentId?: string;
  paymentLinkAmount?: number;
  paymentLinkKind?: "full" | "deposit-percent" | "deposit-fixed";
  // Running total actually collected on this invoice (dollars), and a log of
  // each individual payment — populated by real card charges made through
  // the branded /pay/[id] page (app/api/pay/[id]/route.ts,
  // recordInvoicePayment() below), which supports partial payments/deposits.
  // The three "Mark paid"/"Mark unpaid" admin buttons also keep this in
  // sync for the unambiguous full-paid/full-unpaid cases (see
  // setInvoicePaymentStatus) so the pay page's balance-due figure never
  // disagrees with what the admin sees. invoiceStatus is still the
  // source of truth for which banner/buttons show in the admin UI and on
  // PDFs; amountPaid is the source of truth for "how much is actually left
  // to pay" on the customer-facing pay page.
  amountPaid?: number;
  payments?: InvoicePaymentEntry[];
  // Soft delete — set by deleteQuote() ("Move to Recently deleted" in the
  // admin UI) instead of removing the blob outright, so a mis-click doesn't
  // instantly lose a quote/invoice. getQuotes() excludes anything with this
  // set; getDeletedQuotes() returns only records with this set, for the
  // admin's "Recently deleted" view. purgeExpiredDeletedQuotes() hard-deletes
  // (permanentlyDeleteQuote) anything that's been sitting here more than
  // DELETED_RETENTION_DAYS — called opportunistically from getDeletedQuotes()
  // and from the scheduled app/api/cron/purge-deleted-quotes route, so it
  // happens on a real cadence even if nobody opens that admin tab.
  deletedAt?: string;
  // Quote -> invoice linking. A quote and the invoice made from it are now
  // two separate records, each with its own full life in its own tab (see
  // AdminQuotesTab), rather than one record that flips its `status` field
  // in place — that let an invoice's own history erase the quote it came
  // from. Conversion is one-directional (quotes convert to invoices, never
  // the reverse) — convertQuoteToInvoice() sets these on both sides. The
  // *Number fields are denormalized copies of the linked record's
  // quoteNumber/invoiceNumber, purely so the admin list/builder can show
  // "from quote QT-1001" without an extra fetch — they're not re-synced if
  // the linked record is later renumbered (never happens today) or deleted
  // (the admin UI treats a dangling link as informational only and doesn't
  // try to navigate to a 404).
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
  linkedQuoteId?: string;
  linkedQuoteNumber?: string;
};

// How long a soft-deleted quote/invoice stays in "Recently deleted" before
// it's purged for good.
export const DELETED_RETENTION_DAYS = 5;

export type InvoicePaymentEntry = {
  id: string;
  amount: number; // dollars
  method: "square_card" | "manual";
  squarePaymentId?: string;
  // How a "manual" payment was actually collected (cash in hand, a check,
  // etc.) — unset/irrelevant for method: "square_card" since that's always a
  // card charge. Shown in the admin payment-history list.
  tender?: "cash" | "check" | "other";
  createdAt: string;
  note?: string;
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

// Every record, soft-deleted or not — the shared fetch-all used by
// getQuotes() (live records), getDeletedQuotes() ("Recently deleted"), and
// purgeExpiredDeletedQuotes(). Not exported: callers always want one of
// those three, which make the "what counts as visible" decision explicit.
async function getAllRecordsRaw(): Promise<QuoteRecord[]> {
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

// Live quotes/invoices — what every existing list/number-assignment call
// expects (anything soft-deleted via deleteQuote() is hidden here, same as
// if it had actually been removed).
export async function getQuotes(): Promise<QuoteRecord[]> {
  const all = await getAllRecordsRaw();
  return all.filter((r) => !r.deletedAt);
}

// "Recently deleted" admin view — opportunistically purges anything past
// DELETED_RETENTION_DAYS first (see purgeExpiredDeletedQuotes), so simply
// opening this list is enough to keep it tidy even if the scheduled cron
// route never fires for some reason.
export async function getDeletedQuotes(): Promise<QuoteRecord[]> {
  await purgeExpiredDeletedQuotes();
  const all = await getAllRecordsRaw();
  return all
    .filter((r): r is QuoteRecord & { deletedAt: string } => Boolean(r.deletedAt))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// Hard-deletes every soft-deleted record older than DELETED_RETENTION_DAYS.
// Called from getDeletedQuotes() (so the admin's own "Recently deleted" tab
// self-cleans) and from the scheduled app/api/cron/purge-deleted-quotes
// route (so it also happens on a real daily cadence without anyone opening
// that tab). Best-effort per record — one failed delete doesn't block the
// rest.
export async function purgeExpiredDeletedQuotes(): Promise<{ purged: number }> {
  const all = await getAllRecordsRaw();
  const cutoff = Date.now() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = all.filter((r) => r.deletedAt && new Date(r.deletedAt).getTime() <= cutoff);
  let purged = 0;
  for (const r of expired) {
    try {
      await removeRecord(r.id);
      purged++;
    } catch (err) {
      console.error(`quotes-store: purge failed for ${r.id}`, err);
    }
  }
  return { purged };
}

export async function getQuote(id: string): Promise<QuoteRecord | undefined> {
  const record = await readRecord(id);
  return record ?? undefined;
}

// Scanning every existing quote for the current max number (rather than a
// dedicated counter blob) mirrors nextInvoiceNumber() below — see its
// comment for the narrow race-condition tradeoff this accepts. Starts at
// 1001 so numbers read like a real sequence rather than starting at 1.
function nextQuoteNumber(all: QuoteRecord[]): string {
  let max = 1000;
  for (const q of all) {
    const match = q.quoteNumber?.match(/^QT-(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `QT-${max + 1}`;
}

export async function createQuote(
  input: QuoteInput,
  computed: ComputedQuote
): Promise<{ record: QuoteRecord; persisted: boolean }> {
  const all = await getQuotes();
  const now = new Date().toISOString();
  const record: QuoteRecord = {
    id: uuid(),
    quoteNumber: nextQuoteNumber(all),
    createdAt: now,
    updatedAt: now,
    input,
    computed,
    status: "quote",
  };
  const { persisted } = await writeRecord(record);
  return { record, persisted };
}

// Creates a brand-new INVOICE directly — no quote step first. Used by the
// admin's "+ New invoice" button (as opposed to "+ New quote", which calls
// createQuote above), so a record can start life as an invoice the same way
// convertQuoteToInvoice's output does, just without a linked quote. There's
// no way back to a quote — conversion only runs quote -> invoice.
export async function createInvoice(
  input: QuoteInput,
  computed: ComputedQuote
): Promise<{ record: QuoteRecord; persisted: boolean }> {
  const all = await getQuotes();
  const now = new Date().toISOString();
  const record: QuoteRecord = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    input,
    computed,
    status: "invoice",
    invoiceNumber: nextInvoiceNumber(all),
    invoiceStatus: "unpaid",
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

// Soft delete — "Move to Recently deleted" in the admin UI. The record
// still exists (readRecord/getQuote can still find it) but drops out of
// getQuotes(), so it's gone from the normal Quotes/Invoices tabs. See
// restoreQuote() to undo this and permanentlyDeleteQuote() to actually
// remove it — purgeExpiredDeletedQuotes() calls the latter automatically
// after DELETED_RETENTION_DAYS.
export async function deleteQuote(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { deleted: false, persisted: true };
  const updated: QuoteRecord = { ...existing, deletedAt: new Date().toISOString() };
  const { persisted } = await writeRecord(updated);
  return { deleted: true, persisted };
}

// Pulls a record back out of "Recently deleted". A no-op (but still
// succeeds) if it wasn't deleted in the first place.
export async function restoreQuote(id: string): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  const updated: QuoteRecord = { ...existing, deletedAt: undefined, updatedAt: new Date().toISOString() };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

// Actually removes the blob — the "Delete permanently" button in
// "Recently deleted", and what purgeExpiredDeletedQuotes() calls once a
// soft-deleted record ages out. Unlike deleteQuote(), this works whether or
// not the record is currently soft-deleted (the admin can always hard-delete
// something from Recently deleted, which by definition already is).
export async function permanentlyDeleteQuote(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
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

// Converts a quote into an invoice by creating a brand-new, separate invoice
// record (rather than flipping `status` on the same one) and linking the two
// — see the QuoteRecord.linkedInvoiceId/linkedQuoteId comment. This is what
// lets "Quotes" and "Invoices" live as genuinely separate admin tabs: the
// original quote keeps existing (and keeps showing up under Quotes) even
// after it's been invoiced, instead of disappearing into the invoice.
//
// Any Square payment-link/payment state already on the quote (a pre-invoice
// deposit — see recordInvoicePayment's comment) MOVES to the new invoice
// rather than being copied: the invoice is now the live financial document
// for this order, and leaving the same squareOrderId on two records would
// make findQuoteBySquareOrderId's webhook lookup ambiguous. The quote record
// is left with the garment/pricing content and the link back to its
// invoice, but no payment data of its own once this runs.
//
// Idempotent: calling this again on a quote that's already been converted
// just returns the existing linked invoice (unless that invoice was itself
// since deleted, in which case a new one is created, same as the first
// time) rather than minting a second invoice or erroring.
export async function convertQuoteToInvoice(
  id: string
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };

  if (existing.linkedInvoiceId) {
    const linked = await readRecord(existing.linkedInvoiceId);
    if (linked && !linked.deletedAt) {
      return { record: linked, persisted: true };
    }
  }

  // Scanning every quote for the current max invoice number (rather than a
  // dedicated counter) means two quotes converted at the exact same instant
  // could theoretically land on the same number — a narrow edge case, and
  // no narrower than the lost-update risk the per-record redesign above
  // specifically set out to close, so left as-is rather than adding a
  // separate counter blob for this one rare case.
  const all = await getQuotes();
  const now = new Date().toISOString();
  // A deposit may already have been collected on this record while it was
  // still a quote (see recordInvoicePayment's pre-invoice support) — carry
  // that over into the new invoice's status instead of resetting to
  // "unpaid" and losing track of money already in hand.
  const amountPaid = existing.amountPaid ?? 0;
  const grandTotal = existing.computed.grandTotal;
  const invoiceStatus: InvoicePaymentStatus =
    amountPaid <= 0 ? "unpaid" : amountPaid >= grandTotal - 0.005 ? "paid" : "partially_paid";

  const invoice: QuoteRecord = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    input: existing.input,
    computed: existing.computed,
    status: "invoice",
    invoiceNumber: nextInvoiceNumber(all),
    invoiceStatus,
    convertedAt: now,
    paidAt: invoiceStatus === "paid" ? now : existing.paidAt,
    amountPaid: existing.amountPaid,
    payments: existing.payments,
    paymentLinkUrl: existing.paymentLinkUrl,
    paymentLinkId: existing.paymentLinkId,
    squareOrderId: existing.squareOrderId,
    squarePaymentId: existing.squarePaymentId,
    paymentLinkAmount: existing.paymentLinkAmount,
    paymentLinkKind: existing.paymentLinkKind,
    linkedQuoteId: existing.id,
    linkedQuoteNumber: existing.quoteNumber,
  };
  const updatedQuote: QuoteRecord = {
    ...existing,
    linkedInvoiceId: invoice.id,
    linkedInvoiceNumber: invoice.invoiceNumber,
    amountPaid: undefined,
    payments: undefined,
    paymentLinkUrl: undefined,
    paymentLinkId: undefined,
    squareOrderId: undefined,
    squarePaymentId: undefined,
    paymentLinkAmount: undefined,
    paymentLinkKind: undefined,
    updatedAt: now,
  };

  const [invoiceWrite, quoteWrite] = await Promise.all([writeRecord(invoice), writeRecord(updatedQuote)]);
  return { record: invoice, persisted: invoiceWrite.persisted && quoteWrite.persisted };
}

// Creates an independent copy of a quote/invoice as a brand-new record of
// the requested kind — not a conversion and not a link back to the
// original (see convertQuoteToInvoice above for that); this is a plain
// "Create a copy" admin action for a repeat order or a near-duplicate quote
// for a different customer. The copy carries over the garments/pricing
// (input + computed) as a starting point the admin can then edit freely,
// but starts completely clean otherwise: its own new quote/invoice number,
// no payment history, no payment link, and no soft-delete state.
export async function duplicateQuote(
  id: string,
  kind: QuoteRecordStatus
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const source = await readRecord(id);
  if (!source) return { record: null, persisted: true };

  const all = await getQuotes();
  const now = new Date().toISOString();
  const record: QuoteRecord = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    input: source.input,
    computed: source.computed,
    status: kind,
    ...(kind === "invoice"
      ? { invoiceNumber: nextInvoiceNumber(all), invoiceStatus: "unpaid" as InvoicePaymentStatus }
      : { quoteNumber: nextQuoteNumber(all) }),
  };
  const { persisted } = await writeRecord(record);
  return { record, persisted };
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
    // Keep amountPaid in sync for the two unambiguous cases — "paid" means
    // the full total was collected (by whatever means, e.g. cash/check),
    // "unpaid" means none of it was — so the /pay/[id] page's balance-due
    // figure never disagrees with what the admin just set here. For
    // "partially_paid" there's no dollar figure attached to this manual
    // button, so amountPaid is left as whatever recordInvoicePayment() has
    // already tracked from real payments (possibly 0, if this was set by
    // hand for an off-platform partial payment not tracked here).
    amountPaid:
      invoiceStatus === "paid"
        ? existing.computed.grandTotal
        : invoiceStatus === "unpaid"
          ? 0
          : existing.amountPaid,
    paidAt: invoiceStatus === "paid" ? now : undefined,
    updatedAt: now,
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

// Stores a freshly-created (or refreshed-in-place) Square "Pay online"
// payment link on a record — a quote (for a pre-invoice deposit) or an
// invoice. paymentLinkId/orderId are kept (not just the url) so a later
// Square webhook event, or a later edit's auto-refresh, can be matched back
// to this exact record/order.
export async function setInvoicePaymentLink(
  id: string,
  link: {
    url: string;
    paymentLinkId: string;
    orderId?: string;
    amount: number;
    kind: "full" | "deposit-percent" | "deposit-fixed";
  }
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  const updated: QuoteRecord = {
    ...existing,
    paymentLinkUrl: link.url,
    paymentLinkId: link.paymentLinkId,
    squareOrderId: link.orderId ?? existing.squareOrderId,
    paymentLinkAmount: link.amount,
    paymentLinkKind: link.kind,
    updatedAt: new Date().toISOString(),
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

// Used by the Square webhook handler to map an incoming payment/order event
// back to the invoice it belongs to. Scans getQuotes() rather than keeping a
// separate index — invoice volume here is small and this keeps the store's
// one-blob-per-record design simple; revisit if that stops being true.
export async function findQuoteBySquareOrderId(orderId: string): Promise<QuoteRecord | undefined> {
  const all = await getQuotes();
  return all.find((r) => r.squareOrderId === orderId);
}

// Records one real payment against a record — used by the branded
// customer-facing pay page (app/api/pay/[id]/route.ts) right after a Square
// card charge succeeds, by the admin's manual "Record payment" action, and
// now also usable on a plain quote (not just an invoice) so a deposit can be
// collected and tracked before the order is ever converted. Appends to
// `payments` and bumps `amountPaid`, then derives invoiceStatus from the new
// running total vs the record's grandTotal (a small epsilon avoids floating-
// point dust leaving a fully-paid invoice stuck at "partially_paid") —
// invoiceStatus itself is only meaningful once a record is an invoice, so
// it's left untouched on a quote; amountPaid/payments are what the admin UI
// and PDFs read for a quote's deposit progress. Idempotent on
// squarePaymentId: if this exact Square payment was already recorded (e.g. a
// retried request), it's a no-op rather than double-counted.
export async function recordInvoicePayment(
  id: string,
  payment: {
    amount: number;
    method: InvoicePaymentEntry["method"];
    squarePaymentId?: string;
    tender?: InvoicePaymentEntry["tender"];
    note?: string;
  }
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };

  if (
    payment.squarePaymentId &&
    existing.payments?.some((p) => p.squarePaymentId === payment.squarePaymentId)
  ) {
    return { record: existing, persisted: true };
  }

  const now = new Date().toISOString();
  const entry: InvoicePaymentEntry = {
    id: uuid(),
    amount: payment.amount,
    method: payment.method,
    squarePaymentId: payment.squarePaymentId,
    tender: payment.tender,
    createdAt: now,
    note: payment.note,
  };
  const newAmountPaid = Math.round(((existing.amountPaid ?? 0) + payment.amount) * 100) / 100;
  const grandTotal = existing.computed.grandTotal;
  // invoiceStatus is only a meaningful concept once a record is an invoice
  // (it's what the admin "Unpaid/Partially paid/Paid" badge reads) — a
  // deposit paid on a plain quote still bumps amountPaid/payments above so
  // the balance is tracked correctly, it just doesn't set this flag until
  // convertQuoteToInvoice() runs, which starts a fresh invoiceStatus anyway.
  const invoiceStatus: InvoicePaymentStatus | undefined =
    existing.status === "invoice"
      ? newAmountPaid <= 0
        ? "unpaid"
        : newAmountPaid >= grandTotal - 0.005
          ? "paid"
          : "partially_paid"
      : existing.invoiceStatus;

  const updated: QuoteRecord = {
    ...existing,
    amountPaid: newAmountPaid,
    payments: [...(existing.payments ?? []), entry],
    invoiceStatus,
    paidAt: invoiceStatus === "paid" ? now : existing.paidAt,
    updatedAt: now,
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

// Clears every recorded payment and resets a record back to unpaid — the
// "Reset to unpaid" escape hatch in the admin payment modal, for when a
// manual entry (including a pre-invoice deposit) was recorded by mistake.
// Not exposed anywhere customer-facing.
export async function resetInvoicePayments(
  id: string
): Promise<{ record: QuoteRecord | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  const updated: QuoteRecord = {
    ...existing,
    amountPaid: 0,
    payments: [],
    invoiceStatus: existing.status === "invoice" ? "unpaid" : existing.invoiceStatus,
    paidAt: undefined,
    updatedAt: new Date().toISOString(),
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}
