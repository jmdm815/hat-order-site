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
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ComputedQuote } from "./quote";
import { InvoicePaymentStatus } from "./quotes-store";
import { getBrandSettings } from "./pricing-store";

const NAVY = "#292e45";
const RED = "#cd2229";
const GREEN = "#1a7f37";
const AMBER = "#b8860b";
const CREAM = "#f7f5f1";
const GRAY = "#666666";
const BORDER = "#c7c2b8";
// Light gray-cream bar/box background used by the letterhead's info bar,
// the ordered-by/contact box, and the totals box — matches the shaded
// boxes in the "ShopBox"-style reference invoice layout this file's
// renderQuotePdf header/footer/totals are modeled on.
const BAR_BG = "#eeece5";

// ---------------------------------------------------------------------------
// Letterhead — company info (left) + logo (right), shared by every PDF this
// module renders (quote/invoice, payment receipt, job-folder extras) so they
// all read as one consistent branded document set.
// ---------------------------------------------------------------------------
const COMPANY_NAME = "JM Digital Media LLC";
const COMPANY_ADDRESS = "815 2nd St Rosenberg, TX 77471-2505";
const COMPANY_EMAIL = "purchasing@buyjmmedia.com";
const COMPANY_PHONE = "(281) 344-1772";
const COMPANY_WEBSITE = "www.buyjmmedia.com";

// Fetches the admin-uploaded logo (same private Vercel Blob /api/logo
// streams from — see lib/pricing-store.ts's BrandSettings/publicLogoUrl),
// falling back to the bundled placeholder file when nothing's uploaded yet
// or the fetch fails. Downsized with sharp since the uploaded original can
// be several thousand pixels wide (fine for a web <img>, wasteful to embed
// at full resolution in a PDF). SVG uploads are skipped — pdfkit's
// doc.image() can't embed them — rather than rendering with no logo at all
// callers still fall back to the static file in that case... actually a
// skipped SVG just means no logo image this render; that's acceptable
// since SVG uploads aren't common via the admin's PNG/JPG/WebP/SVG picker.
// Cached at module scope for the lifetime of a warm serverless instance —
// the logo changes rarely, so re-fetching/re-resizing on every PDF is
// wasted work.
let cachedLogoBuffer: Promise<Buffer | null> | null = null;

async function loadLogoBuffer(): Promise<Buffer | null> {
  if (cachedLogoBuffer) return cachedLogoBuffer;
  cachedLogoBuffer = (async () => {
    let raw: Buffer | null = null;
    try {
      const brand = await getBrandSettings();
      if (brand.logoUrl) {
        const res = await fetch(brand.logoUrl, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        });
        if (res.ok) raw = Buffer.from(await res.arrayBuffer());
        else console.error(`quote-pdf: uploaded logo fetch returned ${res.status}`);
      }
    } catch (err) {
      console.error("quote-pdf: failed to fetch uploaded logo", err);
    }
    if (!raw) {
      try {
        raw = await fs.readFile(path.join(process.cwd(), "public", "brand", "jm-logo.png"));
      } catch (err) {
        console.error("quote-pdf: failed to read fallback logo file", err);
        return null;
      }
    }
    const looksLikeSvg =
      raw.slice(0, 5).toString("utf8").trim().startsWith("<?xml") ||
      raw.slice(0, 4).toString("utf8").trim().startsWith("<svg");
    if (looksLikeSvg) return null;
    try {
      return await sharp(raw).resize({ width: 300, height: 300, fit: "inside" }).png().toBuffer();
    } catch (err) {
      console.error("quote-pdf: failed to resize logo, embedding original bytes", err);
      return raw;
    }
  })();
  return cachedLogoBuffer;
}

// Company block on the left, logo flush right — returns the y position
// where it's safe to continue drawing (the lower of the two columns'
// bottoms).
function drawCompanyBlock(
  doc: PDFKit.PDFDocument,
  left: number,
  pageWidth: number,
  logoBuffer: Buffer | null
): number {
  const topY = doc.y;
  const textWidth = pageWidth - 100;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(14).text(COMPANY_NAME, left, topY, { width: textWidth });
  doc.fillColor(GRAY).font("Helvetica").fontSize(8.5);
  doc.text(COMPANY_ADDRESS, left, doc.y + 2, { width: textWidth });
  doc.text(COMPANY_EMAIL, left, doc.y, { width: textWidth });
  doc.text(COMPANY_PHONE, left, doc.y, { width: textWidth });
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(8.5).text(COMPANY_WEBSITE, left, doc.y, { width: textWidth });
  const leftBottom = doc.y;

  const logoSize = 72;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, left + pageWidth - logoSize, topY, { fit: [logoSize, logoSize], align: "center", valign: "center" });
    } catch (err) {
      console.error("quote-pdf: failed to embed logo image", err);
    }
  }
  return Math.max(leftBottom, topY + logoSize);
}

// Big document-type heading + a light-gray 3-column info bar underneath
// (date / terms / document number, mode-dependent) — the "Invoice 1655"
// heading-plus-metadata-bar pattern from the reference layout.
function drawTitleBar(
  doc: PDFKit.PDFDocument,
  left: number,
  pageWidth: number,
  title: string,
  columns: { label: string; value: string }[]
): void {
  doc.moveDown(0.9);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(22).text(title, left, doc.y, { width: pageWidth });
  doc.moveDown(0.5);

  const barY = doc.y;
  const barH = 34;
  doc.rect(left, barY, pageWidth, barH).fill(BAR_BG);
  const colW = pageWidth / columns.length;
  columns.forEach((col, i) => {
    const cx = left + i * colW;
    if (i > 0) {
      doc.strokeColor(BORDER).lineWidth(0.5).moveTo(cx, barY + 6).lineTo(cx, barY + barH - 6).stroke();
    }
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(7).text(col.label.toUpperCase(), cx + 10, barY + 6, { width: colW - 20 });
    doc.fillColor(NAVY).font("Helvetica").fontSize(9.5).text(col.value, cx + 10, barY + 17, { width: colW - 20 });
  });
  doc.y = barY + barH;
  doc.moveDown(0.7);
}

// Boxed, bordered two-column block (ordered-by / contact info) that
// replaces the old plain-text "PREPARED FOR"/"BILL TO"/"ORDER FOR" line.
// Returns without drawing anything if both columns are empty.
function drawOrderedByBox(
  doc: PDFKit.PDFDocument,
  left: number,
  pageWidth: number,
  labelLeft: string,
  labelRight: string,
  leftLines: string[],
  rightLines: string[]
): void {
  if (leftLines.length === 0 && rightLines.length === 0) return;
  const boxTop = doc.y;
  const colW = pageWidth / 2;

  doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(8).text(labelLeft.toUpperCase(), left + 10, boxTop + 8, { width: colW - 30 });
  doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(8).text(labelRight.toUpperCase(), left + colW + 10, boxTop + 8, { width: colW - 30 });

  doc.fillColor(NAVY).font("Helvetica").fontSize(9.5);
  let ly = boxTop + 20;
  for (const line of leftLines) {
    doc.text(line, left + 10, ly, { width: colW - 30 });
    ly = doc.y;
  }
  let ry = boxTop + 20;
  for (const line of rightLines) {
    doc.text(line, left + colW + 10, ry, { width: colW - 30 });
    ry = doc.y;
  }

  const boxBottom = Math.max(ly, ry) + 10;
  doc.strokeColor(BORDER).lineWidth(0.75);
  doc.rect(left, boxTop, pageWidth, boxBottom - boxTop).stroke();
  doc.moveTo(left + colW, boxTop).lineTo(left + colW, boxBottom).stroke();
  doc.y = boxBottom;
  doc.moveDown(0.7);
}

export type QuotePdfMode = "customer" | "internal" | "work-order" | "invoice";

export type InvoiceMeta = {
  invoiceNumber?: string;
  invoiceStatus?: InvoicePaymentStatus;
  // Legacy Square-hosted "Pay online" checkout link
  // (lib/square-payment-links.ts) — no longer created by the admin UI and no
  // longer rendered on the PDF (see payPageUrl below, and
  // lib/quotes-store.ts's comment on QuoteRecord.paymentLinkUrl). Kept in
  // this type only so old callers/snapshots that still pass it don't error.
  paymentLinkUrl?: string;
  // The site's own permanent, branded pay page (/pay/[id]) — always
  // computable for ANY record, quote or invoice, regardless of whether a
  // deposit amount has ever been set, and always reflects the record's
  // current total/line items/balance since the page reads it fresh on
  // every load. This is what's rendered as the clickable "Pay online" (or
  // "Pay deposit online" for a plain quote) line + QR code on the PDF, once
  // the record isn't already paid off in full.
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

export async function renderQuotePdf(
  quote: ComputedQuote,
  mode: QuotePdfMode = "customer",
  invoiceMeta?: InvoiceMeta
): Promise<Buffer> {
  // Which link (if any) this PDF should show as a clickable "Pay online"
  // line plus a scannable QR code: this site's own permanent, branded pay
  // page (payPageUrl) — same URL for a plain quote's pre-invoice deposit as
  // for a converted invoice's balance, which supports both (see
  // app/api/pay/[id]/route.ts). Hidden once the record is fully paid off
  // (an "invoice" PDF already has invoiceStatus to check; any other mode
  // falls back to comparing amountPaid against the quote's own grandTotal).
  const paidInFull =
    mode === "invoice"
      ? invoiceMeta?.invoiceStatus === "paid"
      : (invoiceMeta?.amountPaid ?? 0) >= quote.grandTotal - 0.005;
  const linkForPdf = paidInFull ? undefined : invoiceMeta?.payPageUrl;

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

  const logoBuffer = await loadLogoBuffer();

  return new Promise((resolve, reject) => {
    const internal = mode === "internal";
    const workOrder = mode === "work-order";
    const invoice = mode === "invoice";
    const showPricing = !workOrder;
    const showCostColumns = internal;

    const doc = new PDFDocument({ size: "LETTER", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- Header / letterhead ---------------------------------------------
    doc.y = 50;
    drawCompanyBlock(doc, left, pageWidth, logoBuffer);

    const isPartialDeposit = Boolean(quote.depositPercent && quote.depositPercent < 100);
    const titleText = internal
      ? `Internal Quote${invoiceMeta?.quoteNumber ? ` ${invoiceMeta.quoteNumber}` : ""}`
      : workOrder
        ? `Work Order${invoiceMeta?.quoteNumber ? ` ${invoiceMeta.quoteNumber}` : ""}`
        : invoice
          ? `Invoice${invoiceMeta?.invoiceNumber ? ` ${invoiceMeta.invoiceNumber}` : ""}`
          : `Quote${invoiceMeta?.quoteNumber ? ` ${invoiceMeta.quoteNumber}` : ""}`;

    const barColumns = workOrder
      ? [
          { label: "Order Date", value: formatDate(quote.quoteDate) },
          { label: "Status", value: "Production" },
          { label: "Order #", value: invoiceMeta?.quoteNumber || "—" },
        ]
      : invoice
        ? [
            { label: "Invoice Date", value: formatDate(quote.quoteDate) },
            {
              label: "Terms",
              value:
                invoiceMeta?.invoiceStatus === "paid"
                  ? "Paid"
                  : invoiceMeta?.invoiceStatus === "partially_paid"
                    ? "Balance due"
                    : "Due on receipt",
            },
            { label: "Invoice #", value: invoiceMeta?.invoiceNumber || "—" },
          ]
        : [
            { label: "Quote Date", value: formatDate(quote.quoteDate) },
            { label: "Terms", value: isPartialDeposit ? `${quote.depositPercent}% deposit` : "Due in full" },
            { label: "Quote #", value: invoiceMeta?.quoteNumber || "—" },
          ];

    drawTitleBar(doc, left, pageWidth, titleText, barColumns);

    // --- Ordered by / contact info ----------------------------------------
    const identityLine =
      quote.customerName && quote.customerCompany
        ? `${quote.customerName}(${quote.customerCompany})`
        : quote.customerName || quote.customerCompany || "";
    const orderedByLines = identityLine ? [identityLine] : [];
    const contactLines = identityLine ? [identityLine] : [];
    if (!workOrder && quote.customerEmail) contactLines.push(quote.customerEmail);

    drawOrderedByBox(
      doc,
      left,
      pageWidth,
      workOrder ? "ORDER FOR" : invoice ? "BILL TO" : "ORDERED BY",
      "CONTACT INFO",
      orderedByLines,
      contactLines
    );

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
    } else if (!workOrder && !internal && linkForPdf) {
      // A plain quote (not yet converted to an invoice) — the same branded
      // pay page an invoice uses, just reached before conversion so an order
      // can be gotten started. No paid/unpaid banner here (a quote has no
      // invoiceStatus), just the link + QR. Only call it a "deposit" when
      // the quote actually has a partial depositPercent set — a quote on
      // "pay in full" terms (depositPercent undefined/100) is paid in full
      // through this same link, so it says just "Pay online" instead.
      const isPartialDeposit = Boolean(quote.depositPercent && quote.depositPercent < 100);
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(isPartialDeposit ? "Pay deposit online: " : "Pay online: ", left, doc.y, { continued: true })
        .font("Helvetica")
        .fillColor("#1a56cd")
        .text(linkForPdf, { link: linkForPdf, underline: true });
      doc.moveDown(0.5);

      if (paymentQrPng) {
        const qrSize = 72;
        const qrY = doc.y;
        doc.image(paymentQrPng, left, qrY, { width: qrSize, height: qrSize });
        doc.link(left, qrY, qrSize, qrSize, linkForPdf);
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
        if (line.colorName) {
          doc
            .fillColor(NAVY)
            .font("Helvetica-Bold")
            .fontSize(9.5)
            .text(line.colorName, left, cardTop, { width: CARD_TEXT_WIDTH });
        } else {
          // Nothing to show above the grid (e.g. a Custom non-hat item with
          // no style/color) — still need doc.y to land at cardTop so the
          // grid rows below start at the right height.
          doc.y = cardTop;
        }
      } else {
        doc
          .fillColor(NAVY)
          .font("Helvetica-Bold")
          .fontSize(9.5)
          .text(
            [line.brandName, line.productName].filter(Boolean).join(" ") || line.productName,
            left,
            cardTop,
            { width: CARD_TEXT_WIDTH }
          );
        if (line.styleNumber) {
          doc
            .fillColor(GRAY)
            .font("Helvetica")
            .fontSize(8)
            .text(`Style ${line.styleNumber}`, left, doc.y, { width: CARD_TEXT_WIDTH });
        }
        if (line.colorName) {
          doc
            .fillColor(GRAY)
            .font("Helvetica")
            .fontSize(8)
            .text(line.colorName, left, doc.y, { width: CARD_TEXT_WIDTH });
        }
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
    if (doc.y > doc.page.height - doc.page.margins.bottom - 150) {
      doc.addPage();
    }
    doc
      .strokeColor(NAVY)
      .lineWidth(1)
      .moveTo(left, doc.y)
      .lineTo(left + pageWidth, doc.y)
      .stroke();
    doc.moveDown(0.6);

    // Build the row list first, then size a single bordered/shaded box to
    // fit them — the "boxed totals, bottom-right" look from the reference
    // layout — rather than the old plain right-aligned rows with no box.
    const totalsRows: { label: string; value: string; bold?: boolean }[] = [];
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
      totalsRows.push({
        label: `Subtotal (${totalItemCount} item${totalItemCount === 1 ? "" : "s"})`,
        value: money(quote.subtotalBeforeTax),
      });
      if (quote.taxAmount > 0) {
        totalsRows.push({ label: `Tax (${quote.taxRatePercent}%)`, value: money(quote.taxAmount) });
      }
      totalsRows.push({ label: invoice ? "Amount Due" : "Grand Total", value: money(quote.grandTotal), bold: true });

      const amountPaid = invoice ? invoiceMeta?.amountPaid ?? 0 : 0;
      if (invoice && amountPaid > 0) {
        const remaining = Math.max(0, quote.grandTotal - amountPaid);
        totalsRows.push({ label: "Paid to date", value: money(amountPaid) });
        totalsRows.push({ label: "Balance remaining", value: money(remaining), bold: true });
      } else if (quote.depositPercent && quote.depositPercent < 100) {
        const depositAmount = quote.grandTotal * (quote.depositPercent / 100);
        const balanceAmount = quote.grandTotal - depositAmount;
        totalsRows.push({ label: `Deposit due now (${quote.depositPercent}%)`, value: money(depositAmount) });
        totalsRows.push({ label: "Balance due at pickup", value: money(balanceAmount) });
      }
    } else {
      totalsRows.push({ label: "Total units", value: String(quote.totalQuantity), bold: true });
    }

    const totalsBoxWidth = 240;
    const totalsBoxX = left + pageWidth - totalsBoxWidth;
    const totalsRowH = 20;
    const totalsBoxTop = doc.y;
    const totalsBoxHeight = totalsRows.length * totalsRowH + 16;
    doc.rect(totalsBoxX, totalsBoxTop, totalsBoxWidth, totalsBoxHeight).fill(BAR_BG);
    doc.strokeColor(BORDER).lineWidth(0.75).rect(totalsBoxX, totalsBoxTop, totalsBoxWidth, totalsBoxHeight).stroke();

    let totalsRowY = totalsBoxTop + 8;
    for (const row of totalsRows) {
      doc
        .font(row.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(row.bold ? 12 : 10)
        .fillColor(row.bold ? RED : NAVY)
        .text(row.label, totalsBoxX + 12, totalsRowY, { width: totalsBoxWidth - 120 })
        .text(row.value, totalsBoxX + totalsBoxWidth - 108, totalsRowY, { width: 96, align: "right" });
      totalsRowY += totalsRowH;
    }
    doc.y = totalsBoxTop + totalsBoxHeight;

    // --- Notes + footer -------------------------------------------------
    // Reserve enough room for the notes block plus the closing disclaimer
    // paragraph above the fixed page-footer stamp drawn below — otherwise
    // a quote with enough line items/fees to push doc.y down near the
    // bottom margin can land this text right on top of that stamp.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
      doc.addPage();
    }

    if (quote.notes) {
      doc.moveDown(1.5);
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("NOTES", left, doc.y, { width: pageWidth });
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(NAVY)
        .text(quote.notes, left, doc.y, { width: pageWidth });

      if (doc.y > doc.page.height - doc.page.margins.bottom - 50) {
        doc.addPage();
      }
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

    // --- Page-footer stamp (every page) ------------------------------------
    const pageRange = doc.bufferedPageRange();
    const printedStamp = `PRINTED ON ${new Date()
      .toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      .toUpperCase()} — JM DIGITAL MEDIA`;
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      // Stay inside the printable area (above the bottom margin) — pdfkit
      // auto-inserts a new page for any text() call positioned past the
      // margin boundary, even with an explicit y, which would otherwise
      // spawn extra blank trailing pages just from stamping the footer.
      const stampY = doc.page.height - doc.page.margins.bottom - 18;
      doc
        .fillColor(GRAY)
        .font("Helvetica")
        .fontSize(7)
        .text(printedStamp, left, stampY, { width: pageWidth / 2, align: "left" })
        .text(
          `PAGE ${i - pageRange.start + 1} OF ${pageRange.count}`,
          left + pageWidth / 2,
          stampY,
          { width: pageWidth / 2, align: "right" }
        );
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// A standalone receipt for ONE payment — distinct from renderQuotePdf's
// "invoice"/"customer" modes above, which always render the record's
// current, whole-order snapshot (every line item, the running total paid,
// etc.) rather than a single transaction. That's the right document once
// something is paid in full, but it means a customer who put down a 50%
// deposit and comes back later for a record of *that* payment specifically
// — e.g. for their own bookkeeping — had nothing to point at: downloading
// "the receipt" always produced the same whole-order document no matter
// which payment they meant. This renders a small, dedicated receipt for
// exactly one entry in QuoteRecord.payments, used by
// app/api/pay/[id]/payments/[paymentId]/receipt-pdf/route.ts and linked
// from each row of the payment-history list in InvoicePayClient.tsx /
// AdminInvoicePaymentModal.tsx.
// ---------------------------------------------------------------------------

export type PaymentReceiptData = {
  docLabel: string; // e.g. "Quote QT-1004" or "Invoice INV-0002"
  customerName?: string;
  customerCompany?: string;
  payment: {
    amount: number;
    methodLabel: string; // already resolved to a display string — "Card", "Cash", "Check", "Other"
    createdAt: string; // ISO datetime
    note?: string;
  };
  // Cumulative total paid THROUGH this payment (i.e. including it), and the
  // balance remaining as of right after it — not necessarily today's
  // current balance, so a receipt for an old payment stays historically
  // accurate even if more has been paid (or the order total has changed)
  // since.
  paidToDate: number;
  grandTotal: number;
  balanceAfter: number;
  payPageUrl: string;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export async function renderPaymentReceiptPdf(data: PaymentReceiptData): Promise<Buffer> {
  const paidInFull = data.balanceAfter <= 0.005;
  const logoBuffer = await loadLogoBuffer();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- Header -----------------------------------------------------------
    doc.y = 50;
    drawCompanyBlock(doc, left, pageWidth, logoBuffer);
    drawTitleBar(doc, left, pageWidth, "Payment Receipt", [
      { label: "Date", value: formatDateTime(data.payment.createdAt) },
      { label: "For", value: data.docLabel },
      { label: "Method", value: data.payment.methodLabel },
    ]);
    doc.moveDown(0.3);

    doc
      .strokeColor(NAVY)
      .lineWidth(1.5)
      .moveTo(left, doc.y)
      .lineTo(left + pageWidth, doc.y)
      .stroke();
    doc.moveDown(0.8);

    // --- Billed to ----------------------------------------------------------
    if (data.customerName || data.customerCompany) {
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("RECEIVED FROM", left, doc.y);
      doc
        .fillColor(NAVY)
        .font("Helvetica")
        .fontSize(10)
        .text([data.customerName, data.customerCompany].filter(Boolean).join(" — "), left, doc.y);
      doc.moveDown(1);
    }

    // --- Amount paid, front and center ------------------------------------
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("AMOUNT PAID", left, doc.y);
    doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(28).text(money(data.payment.amount), left, doc.y);
    doc.moveDown(0.6);

    doc.fillColor(CREAM);
    const boxY = doc.y;
    doc.rect(left, boxY, pageWidth, 70).fill(CREAM);
    doc.fillColor(NAVY).font("Helvetica").fontSize(10);
    let rowY = boxY + 10;
    const col2 = left + pageWidth / 2;
    doc.text("Payment method", left + 12, rowY);
    doc.font("Helvetica-Bold").text(data.payment.methodLabel, col2, rowY, { width: pageWidth / 2 - 24, align: "right" });
    rowY += 18;
    doc.font("Helvetica").text("Paid to date", left + 12, rowY);
    doc
      .font("Helvetica-Bold")
      .text(`${money(data.paidToDate)} of ${money(data.grandTotal)}`, col2, rowY, {
        width: pageWidth / 2 - 24,
        align: "right",
      });
    rowY += 18;
    doc.font("Helvetica").text("Balance after this payment", left + 12, rowY);
    doc
      .fillColor(paidInFull ? GREEN : NAVY)
      .font("Helvetica-Bold")
      .text(paidInFull ? "Paid in full" : money(data.balanceAfter), col2, rowY, {
        width: pageWidth / 2 - 24,
        align: "right",
      });
    doc.y = boxY + 70;
    doc.moveDown(1);

    if (data.payment.note) {
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("NOTE", left, doc.y);
      doc.fillColor(NAVY).font("Helvetica").fontSize(9.5).text(data.payment.note, left, doc.y, { width: pageWidth });
      doc.moveDown(1);
    }

    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("View online: ", left, doc.y, { continued: true })
      .font("Helvetica")
      .fillColor("#1a56cd")
      .text(data.payPageUrl, { link: data.payPageUrl, underline: true });

    doc.moveDown(2);
    doc
      .fillColor(GRAY)
      .font("Helvetica")
      .fontSize(8)
      .text("Thank you for your business! Keep this receipt for your records.", left, doc.y, { width: pageWidth });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Job folder — a production packet handed to the floor: page 1 is the
// existing no-pricing "work order" rendering above (mode "work-order",
// unchanged), page 2 is a garment mock-up image plus a plain-text list of
// where to find each print file (e.g. a path on a mounted Google Drive
// folder, or a Drive share link — see
// lib/quotes-store.ts's JobFolderPrintFile doc comment for why this is just
// text rather than a true file reference). Built as two independent pdfkit
// documents merged with pdf-lib rather than one shared PDFDocument instance,
// so this never has to duplicate (or risk drifting from) the work-order
// layout above — renderQuotePdf's full multi-page item-list logic runs
// exactly as it does for the existing "Download work order" button.
// ---------------------------------------------------------------------------

export type JobFolderPdfPrintFile = {
  label: string;
  path: string;
};

export type JobFolderPdfData = {
  docLabel: string; // e.g. "Quote QT-1004" or "Invoice INV-0002"
  customerName?: string;
  customerCompany?: string;
  // Pre-fetched bytes of the uploaded mock-up image (the route handler
  // fetches these from Blob before calling in — this module doesn't know
  // about Blob/network at all). pdfkit's doc.image() auto-detects
  // PNG/JPEG from the buffer itself, so no content-type is needed here.
  mockupImageBuffer?: Buffer;
  // See lib/quotes-store.ts's JobFolderData.mockupLineItemLabel — which
  // line item this mock-up depicts, or "For reference only". Only shown
  // when an image is actually present.
  mockupLineItemLabel?: string;
  printFiles: JobFolderPdfPrintFile[];
};

async function renderJobFolderExtrasPdf(data: JobFolderPdfData): Promise<Buffer> {
  const logoBuffer = await loadLogoBuffer();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- Header -------------------------------------------------------------
    doc.y = 50;
    drawCompanyBlock(doc, left, pageWidth, logoBuffer);
    drawTitleBar(doc, left, pageWidth, "Mock-Up & Print Files", [
      { label: "For", value: data.docLabel },
      {
        label: "Customer",
        value: [data.customerName, data.customerCompany].filter(Boolean).join(" — ") || "—",
      },
    ]);
    doc.moveDown(0.3);

    // --- Mock-up image --------------------------------------------------
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("GARMENT MOCK-UP", left, doc.y);
    doc.moveDown(0.4);

    const maxImageHeight = 320;
    if (data.mockupImageBuffer) {
      try {
        // fit keeps aspect ratio within the box; pdfkit centers neither
        // axis by default, so an explicit x/width + a centered y below
        // mimics a basic "fit and center" without pre-measuring the image.
        doc.image(data.mockupImageBuffer, left, doc.y, {
          fit: [pageWidth, maxImageHeight],
          align: "center",
        });
        doc.y += maxImageHeight + 6;
        doc
          .fillColor(GRAY)
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text(`For: ${data.mockupLineItemLabel || "For reference only"}`, left, doc.y, {
            width: pageWidth,
            align: "center",
          });
        doc.moveDown(0.6);
      } catch (err) {
        console.error("renderJobFolderExtrasPdf: failed to embed mock-up image", err);
        doc
          .fillColor(RED)
          .font("Helvetica")
          .fontSize(9)
          .text("(The uploaded mock-up image couldn't be rendered.)", left, doc.y);
        doc.moveDown(1);
      }
    } else {
      doc
        .fillColor(GRAY)
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text("No mock-up image has been uploaded for this job.", left, doc.y);
      doc.moveDown(1);
    }

    // --- Print file locations --------------------------------------------
    doc.moveDown(0.4);
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("PRINT FILE LOCATIONS", left, doc.y);
    doc.moveDown(0.5);

    if (data.printFiles.length === 0) {
      doc
        .fillColor(GRAY)
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text("No print file locations have been added for this job.", left, doc.y);
    } else {
      const rowPadding = 8;
      for (const file of data.printFiles) {
        // Keep each row's label+path together — pdfkit has no native
        // "don't break this block across pages" so this just checks the
        // (generously estimated) block height against the remaining page
        // space first and adds a page if it won't fit.
        const estimatedHeight = rowPadding * 2 + 14 + 12;
        if (doc.y + estimatedHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
        const rowTop = doc.y;
        doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(file.label || "Untitled", left + rowPadding, rowTop + rowPadding, {
          width: pageWidth - rowPadding * 2,
        });
        doc
          .fillColor(GRAY)
          .font("Helvetica")
          .fontSize(9)
          .text(file.path || "(no path entered)", left + rowPadding, doc.y + 2, {
            width: pageWidth - rowPadding * 2,
          });
        const rowBottom = doc.y + rowPadding;
        doc.strokeColor(BORDER).lineWidth(1).rect(left, rowTop, pageWidth, rowBottom - rowTop).stroke();
        doc.y = rowBottom + 8;
      }
    }

    doc.end();
  });
}

async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PdfLibDocument.create();
  for (const buf of buffers) {
    const src = await PdfLibDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  const bytes = await merged.save();
  return Buffer.from(bytes);
}

// Public entry point — app/api/admin/quotes/[id]/job-folder/pdf/route.ts.
// Page 1 is produced by the unmodified work-order renderer above; page 2 (or
// more, if the print-file list runs long) is the mock-up/print-files page
// built just above. workOrderMeta is passed straight through to
// renderQuotePdf — same shape the existing work-order download already uses.
export async function renderJobFolderPdf(
  quote: ComputedQuote,
  workOrderMeta: InvoiceMeta | undefined,
  jobFolderData: JobFolderPdfData
): Promise<Buffer> {
  const workOrderPdf = await renderQuotePdf(quote, "work-order", workOrderMeta);
  const extrasPdf = await renderJobFolderExtrasPdf(jobFolderData);
  return mergePdfBuffers([workOrderPdf, extrasPdf]);
}
