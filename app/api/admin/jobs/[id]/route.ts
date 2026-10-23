import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { updateJobStatus, updateJobNotes, deleteJob, JobStatus } from "@/lib/jobs-store";

export const runtime = "nodejs";

const VALID_STATUSES: JobStatus[] = ["not_started", "in_progress", "done"];

// Admin-only: update a job's status and/or notes. Separate from the quote
// record entirely — this never touches the source quote/invoice, it's
// purely production tracking.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);

  if (typeof body?.status === "string") {
    if (!VALID_STATUSES.includes(body.status as JobStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const { record, persisted } = await updateJobStatus(id, body.status as JobStatus);
    if (!record) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (typeof body?.notes === "string") {
      const notesResult = await updateJobNotes(id, body.notes);
      return NextResponse.json({ job: notesResult.record ?? record, persisted });
    }
    return NextResponse.json({ job: record, persisted });
  }

  if (typeof body?.notes === "string") {
    const { record, persisted } = await updateJobNotes(id, body.notes);
    if (!record) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ job: record, persisted });
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { deleted, persisted } = await deleteJob(id);
  if (!deleted) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ ok: true, persisted });
}
