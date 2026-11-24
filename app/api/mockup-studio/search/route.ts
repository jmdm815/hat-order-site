import { NextRequest, NextResponse } from "next/server";
import { searchAnySanmarStyle } from "@/lib/sanmar";
import { isSsConfigured, searchSsStyles } from "@/lib/ssactivewear";
import { corsHeaders, preflight } from "@/lib/mockup-studio";
import { productImageUrl } from "@/lib/product-image";

export const runtime = "nodejs";
export const OPTIONS = preflight;

// Public garment search for the AI Mockup Studio (names and photos only — no prices).
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] }, { headers });
  const [sanmar, ss] = await Promise.all([
    searchAnySanmarStyle(q, 20).catch(() => []),
    isSsConfigured() ? searchSsStyles(q, 20).catch(() => []) : Promise.resolve([]),
  ]);
  const ql = q.toLowerCase();
  const rank = (s: string) => (s.toLowerCase() === ql ? 0 : s.toLowerCase().startsWith(ql) ? 1 : 2);
  const results = [
    ...sanmar.map((m) => ({ source: "sanmar" as const, styleNumber: m.styleNumber, name: m.name, brand: m.brand, image: m.imageUrl ? productImageUrl(m.imageUrl) : undefined })),
    ...ss.map((m) => ({ source: "ss" as const, styleNumber: m.styleNumber, name: m.name, brand: m.brand, image: m.imageUrl ? productImageUrl(m.imageUrl) : undefined })),
  ].sort((a, b) => rank(a.styleNumber) - rank(b.styleNumber)).slice(0, 30);
  return NextResponse.json({ results }, { headers: { ...headers, "Cache-Control": "public, max-age=300" } });
}
