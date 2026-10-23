import { put, list, del } from "@vercel/blob";
import { ComputedQuote } from "./quote";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Production jobs store
// ---------------------------------------------------------------------------
// A "job" is one quote/invoice line item sent to production, assigned to a
// station (the line's decoration type — Embroidery, Digital Print, etc.) so
// the admin can see everything queued per station and track it through
// Not Started -> In Progress -> Done. Created from a saved quote/invoice via
// the "Send to Jobs" button (AdminSavedQuotesList.tsx ->
// app/api/admin/quotes/[id]/send-to-jobs/route.ts), never automatically —
// the admin decides when a quote's items are ready for production,
// independent of its quote/invoice or payment status.
//
// Each job snapshots what's being produced (garment, color, decoration,
// size breakdown, customer) at the moment it was sent to production, rather
// than reading live off the quote — so editing or re-pricing the quote
// afterward never silently changes a job already in progress. `quoteId`/
// `lineIndex` just trace it back to its source for reference.
//
// Same one-blob-per-record design as lib/quotes-store.ts, for the same
// reason (see that file's header comment) — jobs/{id}.json, not a single
// combined list, so two unrelated writes can never race and clobber each
// other.
// ---------------------------------------------------------------------------

export type JobStatus = "not_started" | "in_progress" | "done";

export type JobSize = { name: string; quantity: number };

export type Job = {
  id: string; // `${quoteId}::${lineIndex}` — see createJobsFromQuote; stable
  // so re-running "Send to Jobs" on the same quote only creates jobs for
  // lines that don't already have one, instead of duplicating.
  jobNumber: string; // e.g. "JOB-1001" — shown to the admin, see nextJobNumber
  quoteId: string;
  quoteNumber?: string;
  invoiceNumber?: string;
  lineIndex: number;
  customerName?: string;
  customerCompany?: string;
  styleNumber?: string;
  brandName?: string;
  productName?: string;
  colorName?: string;
  customerSupplied?: boolean;
  itemDescription?: string;
  // The station this job is queued under — a decoration type's label
  // (e.g. "Embroidery"). Absent for a garment-only line with no decoration
  // — the board groups those into its own "No Decoration" column rather
  // than dropping them, so nothing sent to production silently disappears.
  decorationId?: string;
  decorationLabel?: string;
  quantity: number;
  sizes: JobSize[];
  status: JobStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

const PREFIX = "jobs/";

function pathFor(id: string): string {
  return `${PREFIX}${encodeURIComponent(id)}.json`;
}

let memoryIndex: Map<string, Job> | null = null;

function memoryList(): Job[] {
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
    console.error(`jobs-store: blob read failed (${pathname})`, err);
    return null;
  }
}

async function readRecord(id: string): Promise<Job | null> {
  if (!isPersistent()) return memoryIndex?.get(id) ?? null;
  return fetchBlobJson<Job>(pathFor(id));
}

async function writeRecord(record: Job): Promise<{ persisted: boolean }> {
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
    console.error("jobs-store: blob write failed", err);
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
    console.error("jobs-store: blob delete failed", err);
    return { persisted: false };
  }
}

export async function getJobs(): Promise<Job[]> {
  if (!isPersistent()) {
    return memoryList().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
          return (await res.json()) as Job;
        } catch {
          return null;
        }
      })
    );
    const valid = records.filter((r): r is Job => r !== null);
    return valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (err) {
    console.error("jobs-store: blob list failed", err);
    return memoryList().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export async function getJob(id: string): Promise<Job | undefined> {
  const record = await readRecord(id);
  return record ?? undefined;
}

function nextJobNumber(all: Job[]): string {
  let max = 1000;
  for (const j of all) {
    const match = j.jobNumber.match(/^JOB-(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `JOB-${max + 1}`;
}

// Creates a job for every line in `computed` that doesn't already have one
// from this quote (keyed by `${quoteId}::${lineIndex}`), so clicking "Send
// to Jobs" again after adding new lines only sends the new ones — an
// existing job's status/notes are never touched. Returns the jobs actually
// created (not the ones skipped as already-existing).
export async function createJobsFromQuote(
  quoteId: string,
  quoteNumber: string | undefined,
  invoiceNumber: string | undefined,
  computed: ComputedQuote
): Promise<{ created: Job[]; skipped: number; persisted: boolean }> {
  const all = await getJobs();
  const now = new Date().toISOString();
  const created: Job[] = [];
  let skipped = 0;
  let persistedAll = true;
  let numberCursor = all;

  for (let i = 0; i < computed.lines.length; i++) {
    const id = `${quoteId}::${i}`;
    if (all.some((j) => j.id === id)) {
      skipped++;
      continue;
    }
    const line = computed.lines[i];
    const job: Job = {
      id,
      jobNumber: nextJobNumber(numberCursor),
      quoteId,
      quoteNumber,
      invoiceNumber,
      lineIndex: i,
      customerName: computed.customerName,
      customerCompany: computed.customerCompany,
      styleNumber: line.customerSupplied ? undefined : line.styleNumber,
      brandName: line.customerSupplied ? undefined : line.brandName,
      productName: line.customerSupplied ? undefined : line.productName,
      colorName: line.customerSupplied ? undefined : line.colorName,
      customerSupplied: line.customerSupplied,
      itemDescription: line.itemDescription,
      decorationId: line.decorationId,
      decorationLabel: line.decorationLabel,
      quantity: line.quantity,
      sizes: line.sizes.map((s) => ({ name: s.size, quantity: s.quantity })),
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    };
    const { persisted } = await writeRecord(job);
    if (!persisted) persistedAll = false;
    created.push(job);
    numberCursor = [...numberCursor, job];
  }

  return { created, skipped, persisted: persistedAll };
}

export async function updateJobStatus(
  id: string,
  status: JobStatus
): Promise<{ record: Job | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  const now = new Date().toISOString();
  const updated: Job = {
    ...existing,
    status,
    startedAt: status === "in_progress" && !existing.startedAt ? now : existing.startedAt,
    completedAt: status === "done" ? now : status === "not_started" ? undefined : existing.completedAt,
    updatedAt: now,
  };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

export async function updateJobNotes(
  id: string,
  notes: string
): Promise<{ record: Job | null; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { record: null, persisted: true };
  const updated: Job = { ...existing, notes, updatedAt: new Date().toISOString() };
  const { persisted } = await writeRecord(updated);
  return { record: updated, persisted };
}

export async function deleteJob(id: string): Promise<{ deleted: boolean; persisted: boolean }> {
  const existing = await readRecord(id);
  if (!existing) return { deleted: false, persisted: true };
  const { persisted } = await removeRecord(id);
  return { deleted: true, persisted };
}
