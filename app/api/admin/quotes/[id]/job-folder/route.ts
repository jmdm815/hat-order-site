import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, setJobFolderPrintFiles, JobFolderPrintFile } from "@/lib/quotes-store";

// Admin-only: saves this quote/invoice's job-folder print-file list — a
// short, freeform "where to find the file" list (label + a path/link the
// admin pastes in themselves) used by AdminJobFolderModal.tsx. Always
// replaces the whole list (not a single add/remove), since it's a short
// admin-edited list with no concurrent-edit concern — see
// lib/quotes-store.ts's setJobFolderPrintFiles.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.printFiles)) {
    return NextResponse.json({ error: "Expected a printFiles array" }, { status: 400 });
  }

  const printFiles: JobFolderPrintFile[] = [];
  for (const raw of body.printFiles) {
    if (typeof raw !== "object" || raw === null) continue;
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const path = typeof raw.path === "string" ? raw.path.trim() : "";
    if (!label && !path) continue; // drop fully-blank rows silently
    const id = typeof raw.id === "string" && raw.id ? raw.id : uuid();
    printFiles.push({ id, label, path });
  }

  const { record: updated, persisted } = await setJobFolderPrintFiles(id, printFiles);
  if (!updated) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record: updated, persisted });
}
