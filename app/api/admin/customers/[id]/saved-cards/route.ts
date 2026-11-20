import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { cardLabel, getSavedCards, removeSavedCard } from "@/lib/saved-cards-store";

export const runtime = "nodejs";

// GET    /api/admin/customers/[id]/saved-cards           — cards on file
// DELETE /api/admin/customers/[id]/saved-cards?cardId=…  — remove one (also disabled at Square)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cards = await getSavedCards((await params).id);
  return NextResponse.json({ cards: cards.map((c) => ({ ...c, label: cardLabel(c) })) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cardId = req.nextUrl.searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "Missing cardId" }, { status: 400 });
  await removeSavedCard((await params).id, cardId);
  return NextResponse.json({ ok: true });
}
