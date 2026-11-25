import { createHash } from "crypto";
import { headers } from "next/headers";
import { list, put } from "@vercel/blob";

// Weekly AI allowance for white-label partners (AI drawn garments and colour
// suggestions). Counted per partner API key; weeks start Monday (Houston time).
// PARTNER_AI_WEEKLY_LIMIT overrides the default of 20. Cached drawings don't
// count. Blob: partner-ai-usage.json → { [partnerId]: { week, used } }.
const PATH = "partner-ai-usage.json";
type Usage = Record<string, { week: string; used: number }>;

export const weeklyLimit = () => Math.max(0, Number(process.env.PARTNER_AI_WEEKLY_LIMIT ?? 20) || 20);

const TZ = "America/Chicago";
/** Monday of the current week, as a calendar date in Houston time. */
function weekStart(now = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
const weekKey = () => weekStart().toISOString().slice(0, 10);
/** Next Monday 00:00 in Houston (≈06:00 UTC; 05:00 during daylight time). */
export const resetsAt = () => {
  const next = new Date(weekStart().getTime() + 7 * 86400000);
  const probe = new Date(next.getTime() + 12 * 3600000);
  const offH = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(probe)) - 12; // -6 or -5
  return new Date(next.getTime() - offH * 3600000).toISOString();
};

export async function partnerId(): Promise<string> {
  const token = ((await headers()).get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

let memory: Usage = {};
async function read(): Promise<Usage> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return memory;
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1 });
    const hit = blobs.find((b) => b.pathname === PATH);
    if (!hit) return {};
    const res = await fetch(`${hit.url}?t=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    return res.ok ? ((await res.json()) as Usage) : {};
  } catch { return {}; }
}
async function write(u: Usage) {
  memory = u;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(PATH, JSON.stringify(u), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
}

export async function usageFor(id: string) {
  const u = (await read())[id];
  const used = u && u.week === weekKey() ? u.used : 0;
  return { used, limit: weeklyLimit(), remaining: Math.max(0, weeklyLimit() - used), resetsAt: resetsAt() };
}

export class QuotaError extends Error { status = 429; }

/** Count one AI use (call before the OpenAI request); refund() if it fails. */
export async function reserve(id: string) {
  const all = await read();
  const cur = all[id]?.week === weekKey() ? all[id].used : 0;
  if (cur >= weeklyLimit()) throw new QuotaError(`You've used all ${weeklyLimit()} AI uses for this week. They reset ${new Date(resetsAt()).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" })}.`);
  all[id] = { week: weekKey(), used: cur + 1 };
  await write(all);
}
export async function refund(id: string) {
  const all = await read();
  if (all[id]?.week === weekKey() && all[id].used > 0) { all[id].used--; await write(all); }
}
