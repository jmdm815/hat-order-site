import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Special quotes — one-off PDF quotes with hand-set pricing, outside the
// normal price tables (e.g. "12 hats at $13.75, 24 at $12.50…"). Each line is
// a pricing option the customer chooses from, so there's no grand total.
// Numbered SQ-1001, SQ-1002… so they never collide with QT numbers.
// Blob: special-quotes.json → SpecialQuote[].
// ---------------------------------------------------------------------------

export type SpecialQuoteLine = { title: string; detail?: string; qty: number; each: number };

export type SpecialQuote = {
  id: string;
  number: string;
  date: string; // YYYY-MM-DD
  customerId?: string;
  customerName: string;
  customerCompany?: string;
  customerEmail?: string;
  intro?: string;
  footnote?: string;
  notes?: string;
  lines: SpecialQuoteLine[];
  createdAt: string;
  updatedAt: string;
};

export type SpecialQuoteInput = Omit<SpecialQuote, "id" | "number" | "createdAt" | "updatedAt">;

const BLOB_PATHNAME = "special-quotes.json";
let memory: SpecialQuote[] | null = null;

async function readAll(): Promise<SpecialQuote[]> {
  if (!isPersistent()) return memory ?? [];
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return [];
    const res = await fetch(`${match.url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    return res.ok ? ((await res.json()) as SpecialQuote[]) : [];
  } catch (err) {
    console.error("special-quotes-store: read failed", err);
    return [];
  }
}

async function writeAll(data: SpecialQuote[]) {
  memory = data;
  if (!isPersistent()) return;
  await put(BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function getSpecialQuotes(): Promise<SpecialQuote[]> {
  return (await readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSpecialQuote(id: string): Promise<SpecialQuote | undefined> {
  return (await readAll()).find((q) => q.id === id);
}

export async function createSpecialQuote(input: SpecialQuoteInput): Promise<SpecialQuote> {
  const all = await readAll();
  const maxNo = all.reduce((m, q) => Math.max(m, Number(q.number.replace(/\D/g, "")) || 0), 1000);
  const now = new Date().toISOString();
  const rec: SpecialQuote = { ...input, id: crypto.randomUUID(), number: `SQ-${maxNo + 1}`, createdAt: now, updatedAt: now };
  await writeAll([...all, rec]);
  return rec;
}

export async function updateSpecialQuote(id: string, input: SpecialQuoteInput): Promise<SpecialQuote | null> {
  const all = await readAll();
  const i = all.findIndex((q) => q.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...input, updatedAt: new Date().toISOString() };
  await writeAll(all);
  return all[i];
}

export async function deleteSpecialQuote(id: string): Promise<void> {
  await writeAll((await readAll()).filter((q) => q.id !== id));
}

export function parseSpecialQuoteInput(body: unknown): SpecialQuoteInput | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const customerName = str(b.customerName);
  if (!customerName) return "Customer name is required";
  const date = str(b.date) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Date must be YYYY-MM-DD";
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  const lines: SpecialQuoteLine[] = [];
  for (const l of rawLines as Record<string, unknown>[]) {
    const qty = Number(l?.qty);
    const each = Number(l?.each);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(each) || each < 0) continue;
    lines.push({ title: str(l.title) ?? `${qty} Items`, detail: str(l.detail), qty, each: Math.round(each * 100) / 100 });
  }
  if (lines.length === 0) return "Add at least one line with a quantity and price";
  return {
    date,
    customerId: str(b.customerId),
    customerName,
    customerCompany: str(b.customerCompany),
    customerEmail: str(b.customerEmail),
    intro: str(b.intro),
    footnote: str(b.footnote),
    notes: str(b.notes),
    lines,
  };
}
