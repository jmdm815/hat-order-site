import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuotes } from "@/lib/quotes-store";
import { buildSalesTaxReport } from "@/lib/sales-tax-report";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> sales tax report for invoices dated in that range.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    return NextResponse.json({ error: "Pick a valid date range." }, { status: 400 });
  }
  const report = buildSalesTaxReport(await getQuotes(), from, to);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
