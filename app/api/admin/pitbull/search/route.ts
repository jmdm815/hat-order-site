import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getPitbullPrices, searchPitbull } from "@/lib/pitbull";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    const [results, prices] = await Promise.all([searchPitbull(q), getPitbullPrices()]);
    return NextResponse.json({ results: results.map((r) => ({ ...r, wholesale: prices.byStyle[r.style]?.price ?? null })) });
  } catch (e) {
    return NextResponse.json({ results: [], error: (e as Error).message }, { status: 502 });
  }
}
