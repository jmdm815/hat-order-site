import { put, list, del } from "@vercel/blob";
import { isPersistent } from "./pricing-store";

// ---------------------------------------------------------------------------
// Shop tasks (built-in task list on the admin Tasks tab)
// ---------------------------------------------------------------------------
// Works without Google Tasks. The scheduled email watcher (Claude) creates a
// task for every email that needs attention, linking the Gmail thread and
// any draft quote it started. One blob per task — shop-tasks/{id}.json — so
// concurrent writers never clobber each other. `dedupeKey` (e.g.
// "email:<account>:<messageId>") makes creation idempotent: posting the same
// key twice returns the existing task instead of a duplicate.
// ---------------------------------------------------------------------------

export type ShopTask = {
  id: string;
  title: string;
  notes?: string;
  due?: string; // YYYY-MM-DD
  priority: "high" | "normal" | "low";
  source: "email" | "manual";
  account?: string; // inbox the email arrived in
  from?: string;
  subject?: string;
  emailUrl?: string; // Gmail link to the thread
  quoteId?: string; // draft quote started for this email
  draftReply?: boolean; // a Gmail draft reply is waiting
  dedupeKey?: string;
  status: "open" | "done";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const PREFIX = "shop-tasks/";
const pathFor = (id: string) => `${PREFIX}${encodeURIComponent(id)}.json`;
let memory: Map<string, ShopTask> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function getShopTasks(): Promise<ShopTask[]> {
  let items: ShopTask[];
  if (!isPersistent()) items = memory ? [...memory.values()] : [];
  else {
    const blobs = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    items = (await Promise.all(blobs.map((b) => fetchJson<ShopTask>(b.url)))).filter((t): t is ShopTask => !!t);
  }
  const rank = { high: 0, normal: 1, low: 2 };
  return items.sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) ||
      rank[a.priority] - rank[b.priority] ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

export async function getShopTask(id: string): Promise<ShopTask | null> {
  if (!isPersistent()) return memory?.get(id) ?? null;
  const { blobs } = await list({ prefix: pathFor(id), limit: 1 });
  const b = blobs.find((x) => x.pathname === pathFor(id));
  return b ? fetchJson<ShopTask>(b.url) : null;
}

async function write(t: ShopTask) {
  if (!memory) memory = new Map();
  memory.set(t.id, t);
  if (!isPersistent()) return;
  await put(pathFor(t.id), JSON.stringify(t), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function cleanTaskInput(b: Record<string, unknown>): Partial<ShopTask> {
  const pr = b.priority === "high" || b.priority === "low" ? b.priority : b.priority === "normal" ? "normal" : undefined;
  const due = str(b.due, 10);
  const emailUrl = str(b.emailUrl, 500);
  return {
    title: str(b.title, 200),
    notes: str(b.notes, 4000),
    due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : undefined,
    priority: pr,
    account: str(b.account, 120),
    from: str(b.from, 200),
    subject: str(b.subject, 300),
    emailUrl: emailUrl && /^https:\/\/mail\.google\.com\//.test(emailUrl) ? emailUrl : undefined,
    quoteId: str(b.quoteId, 80),
    draftReply: typeof b.draftReply === "boolean" ? b.draftReply : undefined,
  };
}

export async function createShopTask(input: Partial<ShopTask> & { title: string }, source: ShopTask["source"], dedupeKey?: string) {
  if (dedupeKey) {
    const existing = (await getShopTasks()).find((t) => t.dedupeKey === dedupeKey);
    if (existing) return { task: existing, created: false };
  }
  const now = new Date().toISOString();
  const task: ShopTask = {
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    id: crypto.randomUUID(),
    title: input.title,
    priority: input.priority ?? "normal",
    source,
    dedupeKey,
    status: "open",
    createdAt: now,
    updatedAt: now,
  } as ShopTask;
  await write(task);
  return { task, created: true };
}

export async function updateShopTask(id: string, patch: Partial<ShopTask>) {
  const t = await getShopTask(id);
  if (!t) return null;
  const now = new Date().toISOString();
  const next: ShopTask = {
    ...t,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    updatedAt: now,
  };
  if (patch.status === "done" && t.status !== "done") next.completedAt = now;
  if (patch.status === "open") delete next.completedAt;
  await write(next);
  return next;
}

export async function deleteShopTask(id: string) {
  memory?.delete(id);
  if (isPersistent()) await del(pathFor(id)).catch(() => {});
}
