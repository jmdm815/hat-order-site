import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/sanmar";
import {
  getHiddenStyleNumbers,
  setHiddenStyleNumbers,
  isPersistent,
} from "@/lib/catalog-selection";
import { isAdminAuthed } from "@/lib/admin-auth";

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const [hats, shirts, hidden] = await Promise.all([
    getCatalog("hat"),
    getCatalog("shirt"),
    getHiddenStyleNumbers(),
  ]);
  const styles = [...hats, ...shirts];
  return NextResponse.json({
    styles,
    hidden: Array.from(hidden),
    persistent: isPersistent(),
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await req.json();
  const hidden: unknown = body?.hidden;
  if (!Array.isArray(hidden) || !hidden.every((h) => typeof h === "string")) {
    return NextResponse.json(
      { error: "Expected { hidden: string[] }" },
      { status: 400 }
    );
  }
  const result = await setHiddenStyleNumbers(hidden);
  return NextResponse.json({ ok: true, ...result });
}
