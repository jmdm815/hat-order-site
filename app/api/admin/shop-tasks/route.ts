import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { cleanTaskInput, createShopTask, getShopTasks } from "@/lib/shop-tasks-store";

export const runtime = "nodejs";

// GET ?status=open|done|all (default open). Also returns ?dedupeKey= matches
// so the email watcher can check whether an email was already handled.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status") ?? "open";
  const key = req.nextUrl.searchParams.get("dedupeKey");
  let tasks = await getShopTasks();
  if (key) tasks = tasks.filter((t) => t.dedupeKey === key);
  else if (status !== "all") tasks = tasks.filter((t) => t.status === status);
  return NextResponse.json({ tasks });
}

// POST { title, notes?, due?, priority?, account?, from?, subject?, emailUrl?, quoteId?, draftReply?, dedupeKey?, source? }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const input = cleanTaskInput(body);
  if (!input.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const dedupeKey = typeof body.dedupeKey === "string" && body.dedupeKey.trim() ? body.dedupeKey.trim().slice(0, 300) : undefined;
  const { task, created } = await createShopTask({ ...input, title: input.title }, body.source === "email" ? "email" : "manual", dedupeKey);
  return NextResponse.json({ task, created }, { status: created ? 201 : 200 });
}
