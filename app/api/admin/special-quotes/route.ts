import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSpecialQuotes, createSpecialQuote, parseSpecialQuoteInput } from "@/lib/special-quotes-store";

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  return NextResponse.json({ quotes: await getSpecialQuotes() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const input = parseSpecialQuoteInput(await req.json().catch(() => null));
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  return NextResponse.json({ quote: await createSpecialQuote(input) });
}
