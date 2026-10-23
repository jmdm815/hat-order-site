import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { listTasks, createTask, GoogleTasksNotConnectedError } from "@/lib/google-tasks";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const listId = req.nextUrl.searchParams.get("list");
  if (!listId) return NextResponse.json({ error: "Missing ?list=" }, { status: 400 });

  try {
    const tasks = await listTasks(listId);
    return NextResponse.json({ tasks });
  } catch (err) {
    if (err instanceof GoogleTasksNotConnectedError) {
      return NextResponse.json({ error: "Google Tasks isn't connected" }, { status: 409 });
    }
    console.error("GET /api/admin/google-tasks/tasks failed", err);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const listId = typeof body?.listId === "string" ? body.listId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!listId || !title) {
    return NextResponse.json({ error: "Expected { listId, title }" }, { status: 400 });
  }

  try {
    const task = await createTask(listId, {
      title,
      notes: typeof body?.notes === "string" ? body.notes : undefined,
      due: typeof body?.due === "string" ? body.due : undefined,
    });
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof GoogleTasksNotConnectedError) {
      return NextResponse.json({ error: "Google Tasks isn't connected" }, { status: 409 });
    }
    console.error("POST /api/admin/google-tasks/tasks failed", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 502 });
  }
}
