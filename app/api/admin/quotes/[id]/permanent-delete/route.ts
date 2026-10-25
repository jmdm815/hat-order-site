import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { permanentlyDeleteQuote } from "@/lib/quotes-store";

// "Delete permanently" in the admin's "Recently deleted" view — actually
// removes the blob, unlike the regular DELETE on /api/admin/quotes/[id]
// (lib/quotes-store.ts's deleteQuote), which only soft-deletes.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { deleted, persisted } = await permanentlyDeleteQuote(id);
  if (!deleted) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, persisted });
}
