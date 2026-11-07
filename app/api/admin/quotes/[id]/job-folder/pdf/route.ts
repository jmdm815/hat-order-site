import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getJobFolderMockups, getJobFolderPressSettings, getQuote } from "@/lib/quotes-store";
import { renderJobFolderPdf } from "@/lib/quote-pdf";
import { isTrustedBlobUrl } from "@/lib/item-photo";

export const runtime = "nodejs";

// Admin-only: generates and streams back this quote/invoice's 2-page job
// folder PDF — page 1 is the existing no-pricing work-order document, page
// 2 is the uploaded garment mock-up image plus the saved print-file
// location list (see lib/quote-pdf.ts's renderJobFolderPdf,
// components/AdminJobFolderModal.tsx's "Download Job Folder PDF" button).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  // ?after=<updatedAt> (sent by the modal right after a save): Blob storage
  // can take a few seconds to serve a just-written record everywhere, so
  // wait briefly (up to ~12s) for that version rather than printing the
  // previous one.
  const after = req.nextUrl.searchParams.get("after");
  let record = await getQuote(id);
  if (after && record) {
    for (let i = 0; i < 16 && record && record.updatedAt < after; i++) {
      await new Promise((r) => setTimeout(r, 750));
      record = (await getQuote(id)) ?? record;
    }
  }
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // Mock-ups store the modal's long line label ("30 × Jerzees … True Red");
  // print the compact form instead ("29M True Red (30)") so it fits.
  const shortCaption = new Map<string, string>();
  for (const l of record.computed.lines) {
    const desc = l.customerSupplied
      ? l.itemDescription || "Customer-supplied item"
      : [l.brandName, l.productName, l.colorName].filter(Boolean).join(" ");
    const short = l.customerSupplied
      ? (l.itemDescription || "Customer-supplied item").split("\n")[0]
      : [l.styleNumber, l.colorName].filter(Boolean).join(" ");
    shortCaption.set(`${l.quantity} × ${desc}`, `${short} (${l.quantity})`);
  }

  // Fetch every mock-up image (private Blob) in parallel; a failed one is
  // just left off the sheet rather than failing the whole PDF.
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const mockups = (
    await Promise.all(
      getJobFolderMockups(record.jobFolder).map(async (m) => {
        if (!token || !isTrustedBlobUrl(m.blobUrl)) return null;
        try {
          const upstream = await fetch(m.blobUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          if (!upstream.ok) {
            console.error(`GET /api/admin/quotes/${id}/job-folder/pdf: mock-up fetch returned ${upstream.status}`);
            return null;
          }
          return {
            buffer: Buffer.from(await upstream.arrayBuffer()),
            location: m.location,
            caption:
              m.lineItemLabel && m.lineItemLabel !== "For reference only"
                ? shortCaption.get(m.lineItemLabel) ?? m.lineItemLabel
                : undefined,
          };
        } catch (err) {
          console.error(`GET /api/admin/quotes/${id}/job-folder/pdf: mock-up fetch failed`, err);
          return null;
        }
      })
    )
  ).filter((m): m is NonNullable<typeof m> => m !== null);

  const lines = record.computed.lines.map((l) => {
    const custom = l.customerSupplied;
    const desc = (l.itemDescription || "Customer-supplied item").split("\n")[0];
    return {
      name: custom ? desc : [l.brandName, l.styleNumber].filter(Boolean).join(" ") || l.productName,
      color: custom ? undefined : l.colorName || undefined,
      short: custom ? desc : [l.styleNumber, l.colorName].filter(Boolean).join(" "),
      decoration: [l.decorationLabel, l.priceColumnLabel && !/^0/.test(l.priceColumnLabel) ? `(${l.priceColumnLabel})` : ""]
        .filter(Boolean)
        .join(" ") || undefined,
      sizes: l.sizes.map((s) => ({ size: s.size, quantity: s.quantity })),
      quantity: l.quantity,
    };
  });

  const docLabel = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Quote ${record.quoteNumber}`
      : "this job";

  try {
    const pdfBuffer = await renderJobFolderPdf(
      record.computed,
      {
        invoiceNumber: record.invoiceNumber,
        invoiceStatus: record.invoiceStatus,
        quoteNumber: record.quoteNumber,
        payPageUrl: `${req.nextUrl.origin}/pay/${record.id}`,
        amountPaid: record.amountPaid,
      },
      {
        docLabel,
        customerName: record.computed.customerName,
        customerCompany: record.computed.customerCompany,
        dueDate: record.computed.dueDate,
        lines,
        pressSettings: getJobFolderPressSettings(record.jobFolder),
        mockups,
        printFiles: record.jobFolder?.printFiles ?? [],
      }
    );

    const fileNameSafe = (record.computed.customerName || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // "inline" — see app/api/admin/quotes/[id]/pdf/route.ts's comment.
        "Content-Disposition": `inline; filename="job-folder-${fileNameSafe}-${record.computed.quoteDate}.pdf"`,
      },
    });
  } catch (err) {
    console.error(`GET /api/admin/quotes/${id}/job-folder/pdf failed`, err);
    return NextResponse.json({ error: "Failed to render job folder PDF" }, { status: 500 });
  }
}
