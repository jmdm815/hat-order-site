import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getQuote } from "@/lib/quotes-store";
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
  const record = await getQuote(id);
  if (!record) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  let mockupImageBuffer: Buffer | undefined;
  const mockupBlobUrl = record.jobFolder?.mockupImageBlobUrl;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (mockupBlobUrl && isTrustedBlobUrl(mockupBlobUrl) && token) {
    try {
      const upstream = await fetch(mockupBlobUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (upstream.ok) {
        mockupImageBuffer = Buffer.from(await upstream.arrayBuffer());
      } else {
        console.error(`GET /api/admin/quotes/${id}/job-folder/pdf: mock-up fetch returned ${upstream.status}`);
      }
    } catch (err) {
      console.error(`GET /api/admin/quotes/${id}/job-folder/pdf: mock-up fetch failed`, err);
    }
  }

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
        mockupImageBuffer,
        mockupLineItemLabel: record.jobFolder?.mockupLineItemLabel,
        printFiles: record.jobFolder?.printFiles ?? [],
      }
    );

    const fileNameSafe = (record.computed.customerName || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="job-folder-${fileNameSafe}-${record.computed.quoteDate}.pdf"`,
      },
    });
  } catch (err) {
    console.error(`GET /api/admin/quotes/${id}/job-folder/pdf failed`, err);
    return NextResponse.json({ error: "Failed to render job folder PDF" }, { status: 500 });
  }
}
