import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote, setJobFolderDetails, JobFolderPress, JobFolderPrintFile } from "@/lib/quotes-store";
import { cleanPreset } from "@/lib/press-presets-store";

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
    // Only keep Google Drive/Docs links — this is printed as a QR code and
    // clickable link on the job-folder PDF, so don't accept arbitrary URLs.
    const url =
      typeof raw.url === "string" && /^https:\/\/(drive|docs)\.google\.com\//.test(raw.url.trim())
        ? raw.url.trim()
        : undefined;
    const appliesTo = Array.isArray(raw.appliesTo)
      ? raw.appliesTo
          .filter((x: unknown): x is string => typeof x === "string" && x.trim() !== "")
          .map((x: string) => x.trim().slice(0, 200))
          .slice(0, 50)
      : [];
    printFiles.push({
      id,
      label,
      path,
      ...(url ? { url } : {}),
      ...(appliesTo.length ? { appliesTo } : {}),
    });
  }

  // Press settings (Heat / Press time boxes on the production sheet):
  // an object sets them, null clears them, absent leaves them alone.
  let press: JobFolderPress | null | undefined;
  if (body.press === null) press = null;
  else if (body.press !== undefined) {
    const p = cleanPreset(body.press);
    press = p
      ? {
          heat: p.heat,
          time: p.time,
          ...(p.name ? { name: p.name } : {}),
          ...(p.pressure ? { pressure: p.pressure } : {}),
          ...(p.notes ? { notes: p.notes } : {}),
          ...(typeof body.press.presetId === "string" && body.press.presetId ? { presetId: body.press.presetId.slice(0, 60) } : {}),
        }
      : null;
  }

  // Each mock-up's print-location / line-item labels (edited in the modal).
  const mockupLabels = Array.isArray(body.mockups)
    ? body.mockups
        .filter((m: unknown): m is { id: string } => typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string")
        .map((m: { id: string; location?: unknown; lineItemLabel?: unknown }) => ({
          id: m.id,
          location: typeof m.location === "string" ? m.location.trim().slice(0, 60) : undefined,
          lineItemLabel: typeof m.lineItemLabel === "string" ? m.lineItemLabel.trim().slice(0, 200) : undefined,
        }))
    : undefined;

  const { record: updated, persisted } = await setJobFolderDetails(id, { printFiles, press, mockupLabels });
  if (!updated) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record: updated, persisted });
}
