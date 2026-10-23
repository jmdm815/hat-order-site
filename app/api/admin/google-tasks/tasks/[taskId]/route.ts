import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { setTaskStatus, deleteTask, GoogleTasksNotConnectedError } from "@/lib/google-tasks";

export const runtime = "nodejs";

// `listId` is passed as a query param (rather than inferred) since Google
// Tasks' own API requires the task list id in the path for every
// per-task operation — there's no "look up a task by id alone" endpoint.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { taskId } = await params;
  const listId = req.nextUrl.searchParams.get("list");
  if (!listId) return NextResponse.json({ error: "Missing ?list=" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const status = body?.status === "completed" ? "completed" : body?.status === "needsAction" ? "needsAction" : null;
  if (!status) return NextResponse.json({ error: "Expected { status: 'completed' | 'needsAction' }" }, { status: 400 });

  try {
    const task = await setTaskStatus(listId, taskId, status);
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof GoogleTasksNotConnectedError) {
      return NextResponse.json({ error: "Google Tasks isn't connected" }, { status: 409 });
    }
    console.error("PATCH /api/admin/google-tasks/tasks/[taskId] failed", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { taskId } = await params;
  const listId = req.nextUrl.searchParams.get("list");
  if (!listId) return NextResponse.json({ error: "Missing ?list=" }, { status: 400 });

  try {
    await deleteTask(listId, taskId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GoogleTasksNotConnectedError) {
      return NextResponse.json({ error: "Google Tasks isn't connected" }, { status: 409 });
    }
    console.error("DELETE /api/admin/google-tasks/tasks/[taskId] failed", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 502 });
  }
}
