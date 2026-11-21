import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getSpecialQuote } from "@/lib/special-quotes-store";
import { renderSpecialQuotePdf } from "@/lib/special-quote-pdf";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const quote = await getSpecialQuote((await params).id);
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdf = await renderSpecialQuotePdf(quote);
  const who = (quote.customerCompany || quote.customerName).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${quote.number}-${who}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
