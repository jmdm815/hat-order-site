import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getDeletedQuotes } from "@/lib/quotes-store";
import { isPersistent } from "@/lib/pricing-store";

// "Recently deleted" admin view — every soft-deleted quote/invoice that
// hasn't aged out yet (see lib/quotes-store.ts's DELETED_RETENTION_DAYS).
// getDeletedQuotes() also opportunistically purges anything past that
// retention window before returning, so simply loading this list is enough
// to keep it tidy even between scheduled cron runs.
export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const quotes = await getDeletedQuotes();
  return NextResponse.json({ quotes, persistent: isPersistent() });
}
