import { NextRequest, NextResponse } from "next/server";
import { verifyPdfLink } from "@/lib/pdf-link";

// Serves a quote/invoice PDF for a signed, 15-minute link made by the JM Admin
// connector (lib/pdf-link.ts). It renders through the regular admin PDF route,
// so the document is identical to the one the admin downloads.

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") ?? "";
  if (!verifyPdfLink(id, mode, sp.get("exp") ?? "", sp.get("sig") ?? "")) {
    return NextResponse.json({ error: "This PDF link has expired or isn't valid." }, { status: 403 });
  }
  const res = await fetch(`${req.nextUrl.origin}/api/admin/quotes/${encodeURIComponent(id)}/pdf?mode=${mode}`, {
    headers: { Authorization: `Bearer ${process.env.AGENT_API_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ error: (data as { error?: string }).error ?? "Couldn't make the PDF." }, { status: res.status });
  }
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": res.headers.get("content-disposition") ?? `inline; filename="quote-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
