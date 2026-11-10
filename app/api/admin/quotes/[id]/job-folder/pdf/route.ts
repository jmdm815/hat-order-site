import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getJobFolderMockups, getJobFolderPressSettings, getQuote } from "@/lib/quotes-store";
import { renderJobFolderPdf, renderJobFolderPdfSections } from "@/lib/quote-pdf";
import type { ComputedQuote } from "@/lib/quote";
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
  for (const l of record.computed.lines.filter((x) => !x.optional)) {
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
  type Line = ComputedQuote["lines"][number];
  // Same label the job folder modal uses for "Applies to" chips.
  const appliesLabel = (l: Line) => {
    const name = l.customerSupplied
      ? (l.itemDescription || "Customer-supplied item").split("\n")[0]
      : [l.styleNumber, l.colorName].filter(Boolean).join(" ") || l.productName || "Item";
    return `${name} (${l.quantity})`;
  };

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
            lineIds: m.lineIds ?? [],
            itemLabels: m.lineIds?.length
              ? record.computed.lines.filter((l) => l.lineId && m.lineIds!.includes(l.lineId)).map(appliesLabel)
              : undefined,
            lineItemLabel: m.lineItemLabel,
            buffer: Buffer.from(await upstream.arrayBuffer()),
            location: m.location,
            caption: m.lineIds?.length
              ? record.computed.lines
                  .filter((l) => l.lineId && m.lineIds!.includes(l.lineId))
                  .map((l) =>
                    l.customerSupplied
                      ? `${(l.itemDescription || "Customer-supplied item").split("\n")[0]} (${l.quantity})`
                      : `${[l.styleNumber, l.colorName].filter(Boolean).join(" ")} (${l.quantity})`,
                  )
                  .join(", ") || undefined
              : m.lineItemLabel && m.lineItemLabel !== "For reference only"
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

  const toPdfLine = (l: Line) => {
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
  };
  // Older mock-ups store "30 × Jerzees 29M True Red" instead of lineIds.
  const legacyLabel = (l: Line) =>
    `${l.quantity} × ${
      l.customerSupplied
        ? l.itemDescription || "Customer-supplied item"
        : [l.brandName, l.productName, l.colorName].filter(Boolean).join(" ")
    }`;

  const docLabel = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Quote ${record.quoteNumber}`
      : "this job";
  const workOrderMeta = {
    invoiceNumber: record.invoiceNumber,
    invoiceStatus: record.invoiceStatus,
    quoteNumber: record.quoteNumber,
    payPageUrl: `${req.nextUrl.origin}/pay/${record.id}`,
    amountPaid: record.amountPaid,
  };
  const pressSettings = getJobFolderPressSettings(record.jobFolder);
  const printFiles = record.jobFolder?.printFiles ?? [];
  const activeLines = record.computed.lines.filter((x) => !x.optional);
  const stripMockup = ({ buffer, location, caption, itemLabels }: (typeof mockups)[number]) => ({ buffer, location, caption, itemLabels });

  // ?split=decoration — one work order + production sheet per decoration
  // type (Digital Print, Embroidery, …). Falls back to the full packet when
  // the job only has one type.
  const groups = new Map<string, Line[]>();
  for (const l of activeLines) {
    const key = l.decorationLabel?.trim() || "No decoration";
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const split = req.nextUrl.searchParams.get("split") === "decoration" && groups.size > 1;

  try {
    let pdfBuffer: Buffer;
    if (!split) {
      pdfBuffer = await renderJobFolderPdf(record.computed, workOrderMeta, {
        docLabel,
        customerName: record.computed.customerName,
        customerCompany: record.computed.customerCompany,
        dueDate: record.computed.dueDate,
        lines: activeLines.map(toPdfLine),
        pressSettings,
        mockups: mockups.map(stripMockup),
        printFiles,
      });
    } else {
      const entries = [...groups.entries()];
      const sections = entries.map(([section, groupLines], i) => {
        const ids = new Set(groupLines.map((l) => l.lineId).filter(Boolean) as string[]);
        const labels = new Set(groupLines.map(appliesLabel));
        const words = section.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
        // Linked mock-ups go with the sections of their lines; unlinked
        // (reference) ones and legacy single-label ones are matched by label,
        // else shown in every section.
        const groupMockups = mockups.filter((m) => {
          if (m.lineIds.length) return m.lineIds.some((id) => ids.has(id));
          if (m.lineItemLabel && m.lineItemLabel !== "For reference only") {
            return groupLines.some((l) => m.lineItemLabel === legacyLabel(l));
          }
          return true;
        });
        // Settings / files tagged for specific items follow those items;
        // untagged ones ("All items") appear in every section.
        const forGroup = <T extends { appliesTo?: string[] }>(x: T): T | null => {
          if (!x.appliesTo?.length) return x;
          const kept = x.appliesTo.filter((a) => labels.has(a));
          return kept.length ? { ...x, appliesTo: kept } : null;
        };
        const sectionPress = pressSettings.map(forGroup).filter((x): x is NonNullable<typeof x> => x !== null);
        const sectionFiles = printFiles.map(forGroup).filter((x): x is NonNullable<typeof x> => x !== null);
        // Setup items that name a different decoration are left off.
        const otherWords = entries
          .filter(([other]) => other !== section)
          .flatMap(([other]) => other.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !words.includes(w)));
        const setupCharges = record.computed.setupCharges.filter((c) => {
          const label = c.label.toLowerCase();
          if (words.some((w) => label.includes(w.slice(0, 5)))) return true;
          return !otherWords.some((w) => label.includes(w.slice(0, 5)));
        });
        const quote: ComputedQuote = {
          ...record.computed,
          lines: groupLines,
          setupCharges,
          totalQuantity: groupLines.reduce((n, l) => n + l.quantity, 0),
        };
        return {
          quote,
          workOrderMeta: { ...workOrderMeta, workOrderSection: section },
          data: {
            docLabel,
            customerName: record.computed.customerName,
            customerCompany: record.computed.customerCompany,
            dueDate: record.computed.dueDate,
            lines: groupLines.map(toPdfLine),
            pressSettings: sectionPress,
            mockups: groupMockups.map(stripMockup),
            printFiles: sectionFiles,
            section,
            sectionIndex: i + 1,
            sectionCount: entries.length,
          },
        };
      });
      pdfBuffer = await renderJobFolderPdfSections(sections);
    }

    const fileNameSafe = (record.computed.customerName || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // "inline" — see app/api/admin/quotes/[id]/pdf/route.ts's comment.
        "Content-Disposition": `inline; filename="job-folder${split ? "-by-decoration" : ""}-${fileNameSafe}-${record.computed.quoteDate}.pdf"`,
      },
    });
  } catch (err) {
    console.error(`GET /api/admin/quotes/${id}/job-folder/pdf failed`, err);
    return NextResponse.json({ error: "Failed to render job folder PDF" }, { status: 500 });
  }
}
