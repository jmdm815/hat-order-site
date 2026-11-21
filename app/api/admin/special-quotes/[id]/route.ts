import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSpecialQuote, updateSpecialQuote, deleteSpecialQuote, parseSpecialQuoteInput } from "@/lib/special-quotes-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const quote = await getSpecialQuote((await params).id);
  return quote ? NextResponse.json({ quote }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const input = parseSpecialQuoteInput(await req.json().catch(() => null));
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  const quote = await updateSpecialQuote((await params).id, input);
  return quote ? NextResponse.json({ quote }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  await deleteSpecialQuote((await params).id);
  return NextResponse.json({ ok: true });
}
