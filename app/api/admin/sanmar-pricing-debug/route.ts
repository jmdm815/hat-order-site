import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { debugSanmarPricing } from "@/lib/sanmar-pricing";

// GET /api/admin/sanmar-pricing-debug?style=BC3413[&color=...]
// Shows what SanMar's live pricing service returns for a style.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const style = req.nextUrl.searchParams.get("style")?.trim();
  if (!style) return NextResponse.json({ error: "style is required" }, { status: 400 });
  const color = req.nextUrl.searchParams.get("color")?.trim() || undefined;
  return NextResponse.json(await debugSanmarPricing(style, color));
}
