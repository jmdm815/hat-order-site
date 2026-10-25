import { NextRequest, NextResponse } from "next/server";
import { purgeExpiredDeletedQuotes } from "@/lib/quotes-store";

export const runtime = "nodejs";

// Scheduled daily by vercel.json's `crons` entry — Vercel automatically
// signs cron-triggered requests with `Authorization: Bearer $CRON_SECRET`
// when that project env var is set, which is what's checked below (see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// Hard-deletes any quote/invoice that's been sitting in "Recently deleted"
// longer than DELETED_RETENTION_DAYS (lib/quotes-store.ts) — the admin's own
// "Recently deleted" tab also triggers this opportunistically on load, so
// this route is really just the backstop that makes the 5-day window real
// even if nobody opens that tab.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { purged } = await purgeExpiredDeletedQuotes();
  return NextResponse.json({ ok: true, purged });
}
