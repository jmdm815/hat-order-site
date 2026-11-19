import { NextRequest, NextResponse } from "next/server";
import { isPartnerAuthed } from "@/lib/partner-auth";
import { searchAnySanmarStyle } from "@/lib/sanmar";
import { isSsConfigured, searchSsStyles } from "@/lib/ssactivewear";

type Result = { source: "sanmar" | "ss"; styleNumber: string; name: string; brand: string; imageUrl?: string };

// GET /api/partner/search?q=&source=sanmar|ss|all — style typeahead across
// the full SanMar and S&S catalogs.
export async function GET(req: NextRequest) {
  if (!(await isPartnerAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const source = req.nextUrl.searchParams.get("source") ?? "all";
  if (q.length < 2) return NextResponse.json({ results: [], errors: [] });
  const errors: string[] = [];
  const [sanmar, ss] = await Promise.all([
    source === "ss"
      ? Promise.resolve([] as Result[])
      : searchAnySanmarStyle(q, 30)
          .then((r) => r.map((m): Result => ({ source: "sanmar", ...m })))
          .catch(() => (errors.push("SanMar search failed"), [] as Result[])),
    source === "sanmar" || !isSsConfigured()
      ? Promise.resolve([] as Result[])
      : searchSsStyles(q, 30)
          .then((r) => r.map((m): Result => ({ source: "ss", ...m })))
          .catch(() => (errors.push("S&S search failed"), [] as Result[])),
  ]);
  const ql = q.toLowerCase();
  const rank = (r: Result) =>
    r.styleNumber.toLowerCase() === ql ? 0 : r.styleNumber.toLowerCase().startsWith(ql) ? 1 : 2;
  return NextResponse.json({ results: [...sanmar, ...ss].sort((a, b) => rank(a) - rank(b)), errors });
}
