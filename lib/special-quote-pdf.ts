import PDFDocument from "pdfkit";
import { loadLogoBuffer } from "./quote-pdf";
import { SHOP_TIME_ZONE } from "./quote";
import type { SpecialQuote } from "./special-quotes-store";

// Special quote PDF — same letterhead, title bar and customer box as
// lib/quote-pdf.ts, then a simple pricing-options table (no grand total,
// since each line is an alternative the customer picks from).

const NAVY = "#292e45", RED = "#cd2229", GRAY = "#666666", BORDER = "#c7c2b8", BAR_BG = "#eeece5";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

export async function renderSpecialQuotePdf(q: SpecialQuote): Promise<Buffer> {
  const logo = await loadLogoBuffer();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = 50, W = doc.page.width - 100;

    // Letterhead
    const y = 50;
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(14).text("JM Digital Media LLC", left, y, { width: W - 100 });
    doc.fillColor(GRAY).font("Helvetica").fontSize(8.5);
    doc.text("815 2nd St Rosenberg, TX 77471-2505", left, doc.y + 2, { width: W - 100 });
    doc.text("purchasing@buyjmmedia.com", { width: W - 100 });
    doc.text("(281) 344-1772", { width: W - 100 });
    doc.moveDown(0.5);
    doc.fillColor(NAVY).font("Helvetica-Bold").text("www.buyjmmedia.com", { width: W - 100 });
    if (logo) {
      try {
        doc.image(logo, left + W - 72, y, { fit: [72, 72], align: "center", valign: "center" });
      } catch (err) {
        console.error("special-quote-pdf: logo failed", err);
      }
    }
    doc.y = Math.max(doc.y, y + 72);

    // Title + info bar
    doc.moveDown(0.9);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(22).text(`Quote ${q.number}`, left, doc.y, { width: W });
    doc.moveDown(0.5);
    const cols = [
      { label: "Quote Date", value: fmtDate(q.date) },
      { label: "Terms", value: "Due in full" },
      { label: "Quote #", value: q.number },
    ];
    const barY = doc.y;
    doc.rect(left, barY, W, 34).fill(BAR_BG);
    cols.forEach((c, i) => {
      const cx = left + (i * W) / 3;
      if (i) doc.strokeColor(BORDER).lineWidth(0.5).moveTo(cx, barY + 6).lineTo(cx, barY + 28).stroke();
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(7).text(c.label.toUpperCase(), cx + 10, barY + 6, { width: W / 3 - 20 });
      doc.fillColor(NAVY).font("Helvetica").fontSize(9.5).text(c.value, cx + 10, barY + 17, { width: W / 3 - 20 });
    });
    doc.y = barY + 34;
    doc.moveDown(0.7);

    // Ordered by / contact
    const ident = q.customerCompany ? `${q.customerName}(${q.customerCompany})` : q.customerName;
    const boxTop = doc.y, half = W / 2;
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(8).text("ORDERED BY", left + 10, boxTop + 8, { width: half - 30 });
    doc.text("CONTACT INFO", left + half + 10, boxTop + 8, { width: half - 30 });
    doc.fillColor(NAVY).font("Helvetica").fontSize(9.5).text(ident, left + 10, boxTop + 20, { width: half - 30 });
    const ly = doc.y;
    doc.text(ident, left + half + 10, boxTop + 20, { width: half - 30 });
    if (q.customerEmail) doc.text(q.customerEmail, left + half + 10, doc.y, { width: half - 30 });
    const boxBottom = Math.max(ly, doc.y) + 10;
    doc.strokeColor(BORDER).lineWidth(0.75).rect(left, boxTop, W, boxBottom - boxTop).stroke();
    doc.moveTo(left + half, boxTop).lineTo(left + half, boxBottom).stroke();
    doc.y = boxBottom;
    doc.moveDown(0.7);
    doc.strokeColor(NAVY).lineWidth(1.5).moveTo(left, doc.y).lineTo(left + W, doc.y).stroke();
    doc.moveDown(0.8);

    if (q.intro) {
      doc.fillColor(NAVY).font("Helvetica").fontSize(10).text(q.intro, left, doc.y, { width: W });
      doc.moveDown(0.8);
    }

    // Pricing table
    const cQty = left + 300, cEach = left + 370, cTot = left + W - 90;
    const headY = doc.y;
    doc.rect(left, headY, W, 20).fill(NAVY);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
    doc.text("#", left + 8, headY + 6, { width: 20 });
    doc.text("DESCRIPTION", left + 30, headY + 6, { width: 200 });
    doc.text("QTY", cQty, headY + 6, { width: 50, align: "right" });
    doc.text("PRICE / EACH", cEach, headY + 6, { width: 80, align: "right" });
    doc.text("TOTAL", cTot, headY + 6, { width: 82, align: "right" });
    doc.y = headY + 20;

    q.lines.forEach((l, i) => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      const rowY = doc.y + 8;
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(String(i + 1), left + 8, rowY, { width: 20 });
      doc.text(l.title, left + 30, rowY, { width: 260 });
      if (l.detail) doc.fillColor(GRAY).font("Helvetica").fontSize(8.5).text(l.detail, left + 30, doc.y + 1, { width: 260 });
      const textBottom = doc.y;
      doc.fillColor(NAVY).font("Helvetica").fontSize(10);
      doc.text(String(l.qty), cQty, rowY, { width: 50, align: "right" });
      doc.text(money(l.each), cEach, rowY, { width: 80, align: "right" });
      doc.font("Helvetica-Bold").text(money(l.qty * l.each), cTot, rowY, { width: 82, align: "right" });
      doc.y = Math.max(textBottom, rowY + 14) + 8;
      doc.strokeColor(BORDER).lineWidth(0.5).moveTo(left, doc.y).lineTo(left + W, doc.y).stroke();
    });

    if (q.footnote) {
      doc.moveDown(0.8);
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(9.5).text(q.footnote, left, doc.y, { width: W });
    }
    if (q.notes) {
      doc.moveDown(1.2);
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(9).text("NOTES", left, doc.y, { width: W });
      doc.font("Helvetica").fontSize(9.5).fillColor(NAVY).text(q.notes, left, doc.y, { width: W });
    }
    doc.moveDown(2);
    doc.fillColor(GRAY).font("Helvetica").fontSize(8).text(
      "This quote is valid for 30 days. Final pricing may vary based on artwork and order changes.",
      left,
      doc.y,
      { width: W }
    );

    const r = doc.bufferedPageRange();
    const stamp = `PRINTED ON ${new Date()
      .toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: SHOP_TIME_ZONE })
      .toUpperCase()} — JM DIGITAL MEDIA`;
    for (let i = r.start; i < r.start + r.count; i++) {
      doc.switchToPage(i);
      const sy = doc.page.height - 50 - 18;
      doc.fillColor(GRAY).font("Helvetica").fontSize(7).text(stamp, left, sy, { width: W / 2 });
      doc.text(`PAGE ${i - r.start + 1} OF ${r.count}`, left + W / 2, sy, { width: W / 2, align: "right" });
    }
    doc.end();
  });
}
