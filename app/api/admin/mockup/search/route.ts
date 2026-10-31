import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { searchAnySanmarStyle } from "@/lib/sanmar";
import { isSsConfigured, searchSsStyles } from "@/lib/ssactivewear";

export type MockupSearchSource = "sanmar" | "ss";

export type MockupSearchResult = {
  source: MockupSearchSource;
  styleNumber: string;
  name: string;
  brand: string;
  imageUrl?: string; // raw supplier URL — render via productPreviewImageUrl
};

// Garment Mockup Tool typeahead (components/GarmentMockupTool.tsx). Searches
// the ENTIRE SanMar feed and S&S Activewear's live catalog — not the
// storefront's curated/hidden-filtered catalog — since a proof can be for
// any blank. `source` = "sanmar" | "ss" | "all" (default). Each supplier is
// searched independently so one failing doesn't blank out the other.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const source = req.nextUrl.searchParams.get("source") ?? "all";
  if (q.length < 2) return NextResponse.json({ results: [], errors: [] });

  const errors: string[] = [];
  const [sanmar, ss] = await Promise.all([
    source === "ss"
      ? Promise.resolve([] as MockupSearchResult[])
      : searchAnySanmarStyle(q, 30)
          .then((r) => r.map((m): MockupSearchResult => ({ source: "sanmar", ...m })))
          .catch((err) => {
            console.error("mockup search: SanMar failed", err);
            errors.push("SanMar search failed");
            return [] as MockupSearchResult[];
          }),
    source === "sanmar"
      ? Promise.resolve([] as MockupSearchResult[])
      : !isSsConfigured()
        ? (errors.push("S&S isn't connected on this deployment"), Promise.resolve([] as MockupSearchResult[]))
        : searchSsStyles(q, 30)
            .then((r) => r.map((m): MockupSearchResult => ({ source: "ss", ...m })))
            .catch((err) => {
              console.error("mockup search: S&S failed", err);
              errors.push("S&S search failed");
              return [] as MockupSearchResult[];
            }),
  ]);

  // Exact style-number hits first, from either supplier.
  const ql = q.toLowerCase();
  const rank = (r: MockupSearchResult) =>
    r.styleNumber.toLowerCase() === ql ? 0 : r.styleNumber.toLowerCase().startsWith(ql) ? 1 : 2;
  const results = [...sanmar, ...ss].sort((a, b) => rank(a) - rank(b));
  return NextResponse.json({ results, errors });
}
