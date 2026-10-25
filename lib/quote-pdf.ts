// ---------------------------------------------------------------------------
// Renders a ComputedQuote (see lib/quote.ts) as a PDF using pdfkit — a pure
// JS PDF library with no headless-browser dependency, so it runs fine in a
// Vercel serverless function.
//
// Four render modes:
//   - "customer": the document meant to go out to the customer. Shows only
//     the final per-unit sell price and line totals — never the underlying
//     garment cost, so margin isn't exposed.
//   - "internal": the company-side copy. Same numbers, plus raw garment
//     COST, garment MARKUP, and DECORATION columns so staff can see the
//     complete breakdown behind the sell price. Clearly labeled so it's
//     never mistaken for the customer copy.
//   - "work-order": for production staff. No pricing anywhere — just which
//     garments, sizes, quantities, and decoration methods are needed, so it
//     can be handed to the floor without exposing any dollar figures.
//   - "invoice": a saved quote (see lib/quotes-store.ts) that's been
//     converted to a bill. Same pricing as "customer", but framed as a bill
//     — "BILL TO", an invoice number, a payment-status banner, and "Amount
//     Due" instead of "Grand Total".
// ---------------------------------------------------------------------------

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { ComputedQuote } from "./quote";
import { InvoicePaymentStatus } from "./quotes-store";

const NAVY = "#292e45";
const RED = "#cd2229";
const GREEN = "#1a7f37";
const AMBER = "#b8860b";
const CREAM = "#f7f5f1";
const GRAY = "#666666";
const BORDER = "#c7c2b8";

export type QuotePdfMode = "customer" | "internal" | "work-order" | "invoice";

export type InvoiceMeta = {
  invoiceNumber?: string;
  invoiceStatus?: InvoicePaymentStatus;
  // Square-hosted "Pay online" checkout link (lib/square-payment-links.ts).
  // No longer rendered on the PDF itself (see payPageUrl below) — kept here
  // because the admin UI still independently offers a "Create/Copy Square
  // link" action elsewhere, unrelated to what shows on the PDF.
  paymentLinkUrl?: string;
  // The site's own branded pay page (/pay/[id]) — always computable for any
  // invoice record regardless of whether a Square link has ever been
  // created, and always reflects the invoice's current total/line items
  // since the page reads the record fresh on every load. This is what's
  // rendered as the clickable "Pay online" line + QR code on the invoice
  // PDF when present and the invoice isn't already paid in full.
  payPageUrl?: string;
  // Running total already collected (dollars) — see lib/quotes-store.ts's
  // QuoteRecord.amountPaid. Used to show "Paid to date" / "Balance
  // remaining" instead of (or alongside) the flat deposit/balance split
  // from quote.depositPercent, once a payment has actually come in.
  amountPaid?: number;
  // The record's human-readable quote number (see lib/quotes-store.ts's
  // QuoteRecord.quoteNumber) — shown as "Quote #: ..." on a non-invoice PDF,
  // the same way invoiceNumber shows as "Invoice #: ..." on an invoice one.
  quoteNumber?: string;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const TITLE: Record<QuotePdfMode, string> = {
  customer: "QUOTE",
  internal: "INTERNAL QUOTE",
  "work-order": "WORK ORDER",
  invoice: "INVOICE",
};

export async function renderQuotePdf(
  quote: ComputedQuote,
  mode: QuotePdfMode = "customer",
  invoiceMeta?: InvoiceMeta
): Promise<Buffer> {
  // Which link (if any) this PDF should show as a clickable "Pay online"
  // line plus a scannable QR code: an invoice not yet paid in full points at
  // this site's own branded pay page (payPageUrl, which supports partial
  // payments); a plain quote — not yet converted — has no pay page of its
  // own, but may have a Square-hosted deposit link an admin created for it
  // (paymentLinkUrl), which gets shown instead whenever one exists. Set
  // automatically the moment a link is created or refreshed — no separate
  // step to remember.
  const linkForPdf =
    mode === "invoice"
      ? invoiceMeta?.invoiceStatus !== "paid"
        ? invoiceMeta?.payPageUrl
        : undefined
      : invoiceMeta?.paymentLinkUrl;

  // Generated up front (QRCode.toBuffer is async; pdfkit's drawing calls
  // below are not) so the PNG bytes are ready by the time doc.image() needs
  // them. Scannable on a phone — points straight at the same "Pay online"
  // link already rendered as text. Failing to generate it (should be rare)
  // just means the PDF ships without the QR code, not without the link.
  const paymentQrPng = linkForPdf
    ? await QRCode.toBuffer(linkForPdf, {
        type: "png",
        margin: 1,
        width: 240,
        color: { dark: NAVY, light: "#ffffff" },
      }).catch((err) => {
        console.error("renderQuotePdf: failed to generate payment QR code", err);
        return null;
      })
    : null;

  return new Promise((resolve, reject) => {
    const internal = mode === "internal";
    const workOrder = mode === "work-order";
    const invoice = mode === "invoice";
    const showPricing = !workOrder;
    const showCostColumns = internal;

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- Header ---------------------------------------------------------
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("JM Digital Media", left, doc.y, { continued: false });
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(9)
      .text("Look the Part. Mean Business.", left, doc.y + 2);
    doc.moveDown(0.3);
    doc
      .fillColor(GRAY)
      .fontSize(9)
      .text("buyjmmedia.com", left, doc.y);
    const leftColumnEndY = doc.y;

    doc
      .fillColor(RED)
      .font("Helvetica-Bold")
      .fontSize(internal ? 18 : 22)
      .text(TITLE[mode], left, 50, { width: pageWidth, align: "right" });
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(9)
      .text(`Date: ${formatDate(quote.quoteDate)}`, { width: pageWidth, align: "right" });
    if (invoice && invoiceMeta?.invoiceNumber) {
      doc.text(`Invoice #: ${invoiceMeta.invoiceNumber}`, { width: pageWidth, align: "right" });
    } else if (!invoice && invoiceMeta?.quoteNumber) {
      doc.text(`Quote #: ${invoiceMeta.quoteNumber}`, { width: pageWidth, align: "right" });
    }

    // The header has two independently-flowing columns (brand block on the
    // left, title/date on the right, the latter drawn at a fixed y=50) — use
    // whichever column ended lower so the banner/rule below never overlaps
    // the taller of the two.
    doc.y = Math.max(doc.y, leftColumnEndY);
    doc.moveDown(1.2);

    if (internal || workOrder) {
      const bannerText = internal
        ? "INTERNAL USE ONLY — includes garment cost. Do not send to customer."
        : "PRODUCTION COPY — no pricing shown.";
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
      const bannerY = doc.y;
      doc.rect(left, bannerY, pageWidth, 20).fill(internal ? RED : NAVY);
      doc.fillColor("#ffffff").text(bannerText, left, bannerY + 5, {
        width: pageWidth,
        align: "center",
      });
      doc.y = bannerY + 20;
      doc.moveDown(0.6);
    } else if (invoice && invoiceMeta?.invoiceStatus) {
      const paid = invoiceMeta.invoiceStatus === "paid";
      const partial = invoiceMeta.invoiceStatus === "partially_paid";
      const bannerColor = paid ? GREEN : partial ? AMBER : RED;
      const bannerText = paid
        ? "PAID — thank you!"
        : partial
          ? "PARTIALLY PAID — balance due"
          : "UNPAID — payment due upon receipt";
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
      const bannerY = doc.y;
      doc.rect(left, bannerY, pageWidth, 20).fill(bannerColor);
      doc.fillColor("#ffffff").text(bannerText, left, bannerY + 5, {
        width: pageWidth,
        align: "center",
      });
      doc.y = bannerY + 20;
      doc.moveDown(0.6);

      if (invoiceMeta?.payPageUrl && !paid) {
        doc
          .fillColor(NAVY)
          .font("Helvetica-Bold")
          .fontSize(10)
          .text("Pay online: ", left, doc.y, { continued: true })
          .font("Helvetica")
          .fillColor("#1a56cd")
          .text(invoiceMeta.payPageUrl, { link: invoiceMeta.payPageUrl, underline: true });
        doc.moveDown(0.5);

        if (paymentQrPng) {
          const qrSize = 72;
          const qrY = doc.y;
          doc.image(paymentQrPng, left, qrY, { width: qrSize, height: qrSize });
          // Make the whole QR image clickable too, not just scannable.
          doc.link(left, qrY, qrSize, qrSize, invoiceMeta.payPageUrl);
          doc
            .fillColor(GRAY)
            .font("Helvetica")
            .fontSize(7.5)
            .text("Scan to pay", left, qrY + qrSize + 3, { width: qrSize, align: "center" });
          doc.y = qrY + qrSize + 14;
        }
        doc.moveDown(0.3);
      }
    } else if (!workOrder && !internal && invoiceMeta?.paymentLinkUrl) {
      // A plain quote (not yet converted to an invoice) with a Square
      // deposit link an admin created for it — see
      // app/api/admin/quotes/[id]/payment-link/route.ts. No paid/unpaid
      // banner here (a quote has no invoiceStatus), just the link + QR so
      // the customer can put a deposit down and get the order started.
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("Pay deposit online: ", left, doc.y, { continued: true })
        .font("Helvetica")
        .fillColor("#1a56cd")
        .text(invoiceMeta.paymentLinkUrl, { link: invoiceMeta.paymentLinkUrl, underline: true });
      doc.moveDown(0.5);

      if (paymentQrPng) {
        const qrSize = 72;
        const qrY = doc.y;
        doc.image(paymentQrPng, left, qrY, { width: qrSize, height: qrSize });
        doc.link(left, qrY, qrSize, qrSize, invoiceMeta.paymentLinkUrl);
        doc
          .fillColor(GRAY)
          .font("Helvetica")
          .fontSize(7.5)
          .text("Scan to pay", left, qrY + qrSize + 3, { width: qrSize, align: "center" });
        doc.y = qrY + qrSize + 14;
      }
      doc.moveDown(0.3);
    }

    doc
      .strokeColor(NAVY)
      .lineWidth(1.5)
      .moveTo(left, doc.y)
      .lineTo(left + pageWidth, doc.y)
      .stroke();
    doc.moveDown(0.8);

    // --- Customer block ---------------------------------------------------
    if (quote.customerName || quote.customerCompany || (!workOrder && quote.customerEmail)) {
      doc
        .fillColor(GRAY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(workOrder ? "ORDER FOR" : invoice ? "BILL TO" : "PREPARED FOR");
      doc.font("Helvetica").fontSize(10).fillColor(NAVY);
      if (quote.customerName) doc.text(quote.customerName);
      if (quote.customerCompany) doc.text(quote.customerCompany);
      if (!workOrder && quote.customerEmail) doc.fillColor(GRAY).fontSize(9).text(quote.customerEmail);
      doc.moveDown(1);
    }

    // --- Line items ---------------------------------------------------------
    // Compact "card" per garment/color — a small brand/style/color label on
    // the left, and a horizontal grid on the right (Size / Quantity / price
    // rows as columns, one per size) instead of one full-width row per size.
    // Much shorter vertically than the old per-size table, and matches the
    // live site's cart-line layout. No product photo (admin-only PDF).
    const CARD_TEXT_WIDTH = 150;
    const CARD_GRID_GAP = 12;
    const GRID_LABEL_WIDTH = 58;
    const GRID_ROW_H = 15;

    function estimateCardHeight(): number {
      const rows = 2 + (showCostColumns ? 3 : 0) + 1; // size + qty [+ cost + markup + decoration] + price/pulled
      return Math.max(rows * GRID_ROW_H, 40) + 14;
    }

    function drawGarmentCard(line: (typeof quote.lines)[number], sameStyle: boolean) {
      const cardTop = doc.y;
      const gridX = left + CARD_TEXT_WIDTH + CARD_GRID_GAP;
      const gridWidth = pageWidth - CARD_TEXT_WIDTH - CARD_GRID_GAP;
      const n = line.sizes.length;
      const valuesWidth = gridWidth - GRID_LABEL_WIDTH;
      // Cap each size column's width so a line with only a size or two
      // doesn't stretch its cells across the full remaining page width.
      const colW = n > 0 ? Math.min(valuesWidth / n, 65) : valuesWidth;

      // Left text block: just the color when the group heading above already
      // named the product (same style throughout), otherwise the full
      // brand/style/color so a mixed-style group stays unambiguous.
      if (sameStyle) {
        doc
          .fillColor(NAVY)
          .font("Helvetica-Bold")
          .fontSize(9.5)
          .text(line.colorName, left, cardTop, { width: CARD_TEXT_WIDTH });
      } else {
        doc
          .fillColor(NAVY)
          .font("Helvetica-Bold")
          .fontSize(9.5)
          .text(`${line.brandName} ${line.productName}`, left, cardTop, { width: CARD_TEXT_WIDTH });
        doc
          .fillColor(GRAY)
          .font("Helvetica")
          .fontSize(8)
          .text(`Style ${line.styleNumber}`, left, doc.y, { width: CARD_TEXT_WIDTH });
        doc.text(line.colorName, left, doc.y, { width: CARD_TEXT_WIDTH });
      }
      const textBottom = doc.y;

      function gridRow(
        y: number,
        label: string,
        renderCell: (index: number, cx: number, cy: number, w: number) => void,
        shade = false
      ) {
        const labelCellW = GRID_LABEL_WIDTH - 4;
        doc
          .strokeColor(BORDER)
          .lineWidth(0.5)
          .rect(gridX, y, labelCellW, GRID_ROW_H)
          .stroke();
        doc
          .font("Helvetica")
          .fontSize(6.5)
          .fillColor(GRAY)
          .text(label.toUpperCase(), gridX + 3, y + 5, { width: labelCellW - 6 });
        for (let i = 0; i < n; i++) {
          const cx = gridX + GRID_LABEL_WIDTH + i * colW;
          if (shade) {
            doc.rect(cx, y, colW - 2, GRID_ROW_H).fill(CREAM);
          }
          doc.strokeColor(BORDER).lineWidth(0.5).rect(cx, y, colW - 2, GRID_ROW_H).stroke();
          renderCell(i, cx, y, colW - 2);
        }
      }

      let y = cardTop;
      gridRow(
        y,
        "Size",
        (i, cx, cy, w) =>
          doc
            .fillColor(NAVY)
            .font("Helvetica-Bold")
            .fontSize(8)
            .text(line.sizes[i].size, cx, cy + 4, { width: w, align: "center" }),
        true
      );
      y += GRID_ROW_H;

      gridRow(
        y,
        "Qty",
        (i, cx, cy, w) =>
          doc
            .fillColor(NAVY)
            .font("Helvetica")
            .fontSize(8)
            .text(String(line.sizes[i].quantity), cx, cy + 4, { width: w, align: "center" }),
        true
      );
      y += GRID_ROW_H;

      if (showCostColumns) {
        gridRow(y, "Garment Cost", (i, cx, cy, w) => {
          // Backward-compatible fallback for saved quotes created before
          // raw cost and markup were stored separately.
          const cost = line.sizes[i].garmentCost ?? line.sizes[i].garmentUnitPrice;
          doc
            .fillColor(NAVY)
            .font("Helvetica")
            .fontSize(8)
            .text(money(cost), cx, cy + 4, { width: w, align: "center" });
        });
        y += GRID_ROW_H;

        gridRow(y, "Markup", (i, cx, cy, w) => {
          const markup = line.sizes[i].garmentMarkupAmount ?? 0;
          doc
            .fillColor(NAVY)
            .font("Helvetica")
            .fontSize(8)
            .text(markup > 0 ? `+${money(markup)}` : "—", cx, cy + 4, { width: w, align: "center" });
        });
        y += GRID_ROW_H;

        gridRow(y, "Decoration", (i, cx, cy, w) => {
          const dec = line.sizes[i].decorationUnitPrice;
          doc
            .fillColor(NAVY)
            .font("Helvetica")
            .fontSize(8)
            .text(dec > 0 ? `+${money(dec)}` : "—", cx, cy + 4, { width: w, align: "center" });
        });
        y += GRID_ROW_H;
      }

      if (showPricing) {
        gridRow(y, "Item Price", (i, cx, cy, w) =>
          doc
            .fillColor(NAVY)
            .font("Helvetica-Bold")
            .fontSize(8)
            .text(money(line.sizes[i].unitPrice), cx, cy + 4, { width: w, align: "center" })
        );
      } else {
        gridRow(y, "Pulled", (i, cx, cy, w) => {
          const box = 9;
          doc.rect(cx + w / 2 - box / 2, cy + (GRID_ROW_H - box) / 2, box, box).stroke(NAVY);
        });
      }
      y += GRID_ROW_H;

      let bottom = Math.max(y, textBottom);
      if (showPricing) {
        doc
          .fillColor(GRAY)
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .text(`Line total: ${money(line.subtotal)}`, gridX, bottom + 2, { width: gridWidth, align: "right" });
        bottom = doc.y;
      }

      doc.y = bottom + 10;
    }

    // Group lines that share the same decoration + pricing column (i.e. the
    // same logo/stitch band) under a single banner + table header, rather
    // than repeating that heavy navy block once per color. Preserves the
    // original relative order of first appearance.
    type Group = { key: string; lines: typeof quote.lines };
    const groups: Group[] = [];
    const groupIndexByKey = new Map<string, number>();
    for (const line of quote.lines) {
      const key = `${line.decorationId ?? ""}::${line.priceColumnId ?? ""}`;
      let idx = groupIndexByKey.get(key);
      if (idx === undefined) {
        idx = groups.length;
        groupIndexByKey.set(key, idx);
        groups.push({ key, lines: [] });
      }
      groups[idx].lines.push(line);
    }

    for (const group of groups) {
      const first = group.lines[0];
      const sameStyle = group.lines.every(
        (l) => l.styleNumber === first.styleNumber && l.productName === first.productName
      );

      // Keep the group heading + at least one card together.
      if (doc.y > doc.page.height - doc.page.margins.bottom - (60 + estimateCardHeight())) {
        doc.addPage();
      }

      // Group heading: product name (only when every line in the group is
      // the same style/product) and the shared decoration.
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(
          sameStyle ? `${first.brandName} ${first.productName}` : "Multiple garments",
          left,
          doc.y
        );
      doc
        .fillColor(GRAY)
        .font("Helvetica")
        .fontSize(9)
        .text(
          first.decorationLabel
            ? `${first.decorationLabel}${first.priceColumnLabel ? ` (${first.priceColumnLabel})` : ""}`
            : "No decoration — garment only"
        );
      doc.moveDown(0.4);

      for (const line of group.lines) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - estimateCardHeight()) {
          doc.addPage();
        }
        drawGarmentCard(line, sameStyle);
      }

      doc.moveDown(0.5);
    }

    // --- Setup charges ----------------------------------------------------
    // Named, flat one-time charges attached to the quote as a whole (not
    // tied to any decoration/line) — e.g. "Digitizing for embroidery",
    // "Logo vectorization". Listed here for visibility, but their dollar
    // amount is already folded into the subtotal below rather than added a
    // second time as its own totals row.
    if (quote.setupCharges.length > 0) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
      }
      doc
        .fillColor(GRAY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(workOrder ? "SETUP REQUIRED" : "SETUP CHARGES", left, doc.y, { width: pageWidth });
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(9.5);
      for (const charge of quote.setupCharges) {
        doc.fillColor(NAVY).text(
          showPricing ? `${charge.label} — ${money(charge.price)}` : charge.label,
          left,
          doc.y
        );
      }
      doc.moveDown(1);
    }

    // --- Miscellaneous fees ------------------------------------------------
    // Ad-hoc, one-off charges entered on this quote only (a rush fee, a
    // shipping surcharge, etc.) — see lib/quote.ts's QuoteInput.miscFees.
    // Like setup charges, the dollar amount is already folded into the
    // subtotal below; this is just an itemized breakdown. Skipped on the
    // work order — these are billing line items, not production ones.
    if (quote.miscFees.length > 0 && showPricing) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
      }
      doc
        .fillColor(GRAY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("OTHER", left, doc.y, { width: pageWidth });
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(9.5);
      for (const fee of quote.miscFees) {
        const qtyLabel = fee.quantity > 1 ? ` x${fee.quantity} @ ${money(fee.amount)}` : "";
        doc.fillColor(NAVY).text(`${fee.label}${qtyLabel} — ${money(fee.lineTotal)}`, left, doc.y);
      }
      doc.moveDown(1);
    }

    // --- Totals -------------------------------------------------------
    if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage();
    }
    doc
      .strokeColor(NAVY)
      .lineWidth(1)
      .moveTo(left, doc.y)
      .lineTo(left + pageWidth, doc.y)
      .stroke();
    doc.moveDown(0.5);

    const totalsX = left + pageWidth - 220;
    function totalRow(label: string, value: string, bold = false) {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(bold ? 12 : 10)
        .fillColor(bold ? RED : NAVY)
        .text(label, totalsX, doc.y, { width: 130 })
        .text(value, totalsX + 130, doc.y - doc.currentLineHeight(), { width: 80, align: "right" });
    }

    if (showPricing) {
      // Setup charges and misc fees are already folded into subtotalBeforeTax
      // (see quote.subtotalBeforeTax) — they're itemized above, in their own
      // sections, rather than shown again as a separate addend here.
      // Garment quantity alone reads as "0 units" (misleadingly implying an
      // empty invoice) when a quote/invoice is made up only of misc fees
      // (shipping, a rush fee, etc.) with no garment lines — fold the misc
      // fees' own quantities in so the count always reflects everything
      // actually being billed.
      const miscFeeQuantity = quote.miscFees.reduce((sum, fee) => sum + fee.quantity, 0);
      const totalItemCount = quote.totalQuantity + miscFeeQuantity;
      totalRow(`Subtotal (${totalItemCount} item${totalItemCount === 1 ? "" : "s"})`, money(quote.subtotalBeforeTax));
      if (quote.taxAmount > 0) {
        doc.moveDown(0.4);
        totalRow(`Tax (${quote.taxRatePercent}%)`, money(quote.taxAmount));
      }
      doc.moveDown(0.4);
      totalRow(invoice ? "Amount Due" : "Grand Total", money(quote.grandTotal), true);

      const amountPaid = invoice ? invoiceMeta?.amountPaid ?? 0 : 0;
      if (invoice && amountPaid > 0) {
        const remaining = Math.max(0, quote.grandTotal - amountPaid);
        doc.moveDown(0.4);
        totalRow("Paid to date", money(amountPaid));
        doc.moveDown(0.2);
        totalRow("Balance remaining", money(remaining), true);
      } else if (quote.depositPercent && quote.depositPercent < 100) {
        const depositAmount = quote.grandTotal * (quote.depositPercent / 100);
        const balanceAmount = quote.grandTotal - depositAmount;
        doc.moveDown(0.4);
        totalRow(`Deposit due now (${quote.depositPercent}%)`, money(depositAmount));
        doc.moveDown(0.2);
        totalRow("Balance due at pickup", money(balanceAmount));
      }
    } else {
      totalRow("Total units", String(quote.totalQuantity), true);
    }

    // --- Notes + footer -------------------------------------------------
    if (quote.notes) {
      doc.moveDown(1.5);
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("NOTES", left, doc.y, { width: pageWidth });
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(NAVY)
        .text(quote.notes, left, doc.y, { width: pageWidth });
    }

    doc.moveDown(2);
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(8)
      .text(
        invoice
          ? "Payment is due upon receipt. Thank you for your business!"
          : showPricing
            ? "This quote is an estimate based on current supplier pricing and is valid for 30 days. " +
                "Final pricing may vary based on artwork, exact stitch/print specifications, and order changes."
            : "Production work order — verify sizes, quantities, and decoration details against the customer's " +
                "approved artwork before starting.",
        left,
        doc.y,
        { width: pageWidth }
      );

    doc.end();
  });
}
