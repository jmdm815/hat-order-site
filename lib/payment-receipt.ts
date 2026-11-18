import type { QuoteRecord } from "./quotes-store";
import { renderPaymentReceiptPdf } from "./quote-pdf";

// One payment's receipt (PDF + the numbers shown on it), shared by the
// public receipt-pdf route and the admin "email this receipt" route.

export const TENDER_LABEL: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  shopvox: "ShopVox",
  zelle: "Zelle",
  other: "Other",
};

export async function buildPaymentReceipt(record: QuoteRecord, paymentId: string, origin: string) {
  const payments = record.payments ?? [];
  const index = payments.findIndex((p) => p.id === paymentId);
  if (index === -1) return null;
  const payment = payments[index];
  const paidToDate = Math.round(payments.slice(0, index + 1).reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const grandTotal = record.computed.grandTotal;
  const balanceAfter = Math.max(0, Math.round((grandTotal - paidToDate) * 100) / 100);
  const docLabel = record.invoiceNumber
    ? `Invoice ${record.invoiceNumber}`
    : record.quoteNumber
      ? `Quote ${record.quoteNumber}`
      : "your order";
  const methodLabel =
    payment.method === "square_card"
      ? "Card"
      : TENDER_LABEL[payment.tender ?? "other"] +
        (payment.tender === "check" && payment.checkNumber ? ` #${payment.checkNumber}` : "");
  const payPageUrl = `${origin}/pay/${record.id}`;
  const pdf = await renderPaymentReceiptPdf({
    docLabel,
    customerName: record.computed.customerName,
    customerCompany: record.computed.customerCompany,
    payment: {
      amount: payment.amount,
      methodLabel,
      createdAt: payment.createdAt,
      note: payment.note,
      transactionId: payment.transactionId,
    },
    paidToDate,
    grandTotal,
    balanceAfter,
    payPageUrl,
  });
  const fileNameSafe = (record.computed.customerName || "receipt").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return {
    pdf,
    filename: `receipt-${fileNameSafe}-${payment.createdAt.slice(0, 10)}.pdf`,
    payment,
    methodLabel,
    paidToDate,
    grandTotal,
    balanceAfter,
    payPageUrl,
    docLabel,
  };
}

/** Emails one payment's receipt (receipt PDF + invoice PDF) to each address. */
export async function emailPaymentReceipt(
  record: QuoteRecord,
  paymentId: string,
  origin: string,
  emails: string[],
  opts: { preview?: boolean } = {}
) {
  const { renderQuotePdf } = await import("./quote-pdf");
  const { loadLineMockups } = await import("./mockup-links");
  const { sendInvoiceReceiptEmail } = await import("./email");
  const r = await buildPaymentReceipt(record, paymentId, origin);
  if (!r) throw new Error("Payment not found");
  const invoicePdf = await renderQuotePdf(record.computed, record.status === "invoice" ? "invoice" : "customer", {
    lineMockups: await loadLineMockups(record, "customer"),
    invoiceNumber: record.invoiceNumber,
    invoiceStatus: record.invoiceStatus,
    quoteNumber: record.quoteNumber,
    paymentLinkUrl: record.paymentLinkUrl,
    payPageUrl: r.payPageUrl,
    amountPaid: record.amountPaid,
  });
  for (const to of emails) {
    await sendInvoiceReceiptEmail({
      to,
      invoiceNumber: record.invoiceNumber,
      quoteNumber: record.quoteNumber,
      customerName: record.computed.customerName,
      customerCompany: record.computed.customerCompany,
      amount: r.payment.amount,
      method: r.payment.method,
      methodLabel: r.methodLabel,
      transactionId: r.payment.transactionId,
      grandTotal: r.grandTotal,
      amountPaid: r.paidToDate,
      balance: r.balanceAfter,
      payPageUrl: r.payPageUrl,
      pdf: { filename: r.filename, content: r.pdf },
      extraAttachments: [
        { filename: `${record.invoiceNumber ?? record.quoteNumber ?? "invoice"}.pdf`, content: invoicePdf },
      ],
      subjectPrefix: opts.preview ? "[Preview] " : undefined,
    });
  }
}
