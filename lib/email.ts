import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Transactional email (Resend) — currently just the admin payment
// notification sent from app/api/pay/[id]/route.ts after a successful
// online invoice payment (card, Apple Pay, or Google Pay).
//
// To go live:
//   1. Create a Resend account at https://resend.com and generate an API key.
//   2. Set RESEND_API_KEY in your host's secret manager.
//   3. Verify a sending domain in Resend's dashboard (Domains > Add Domain)
//      and add the DNS records it gives you. Until a domain is verified,
//      Resend's default sender (onboarding@resend.dev) can only deliver to
//      the email address on the Resend account itself — not to
//      ADMIN_NOTIFICATION_EMAIL below — so this will silently fail to
//      reach the admin inbox until that's done.
//   4. Set EMAIL_FROM to an address on that verified domain (e.g.
//      "Hat Order Site <notifications@buyjmmedia.com>"). Falls back to
//      Resend's onboarding@resend.dev sender if unset, for early testing.
//   5. Set ADMIN_NOTIFICATION_EMAIL to where payment notifications should
//      land (purchasing@buyjmmedia.com).
// ---------------------------------------------------------------------------

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ADMIN_NOTIFICATION_EMAIL);
}

function getResendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY ?? "");
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export type InvoicePaymentNotification = {
  invoiceId: string;
  invoiceNumber?: string;
  customerName?: string;
  customerCompany?: string;
  amount: number; // this payment, dollars
  method: "square_card" | "square_apple_pay" | "square_google_pay" | string;
  grandTotal: number;
  amountPaid: number; // running total after this payment
  balance: number; // remaining after this payment
  payPageUrl: string;
};

const METHOD_LABEL: Record<string, string> = {
  square_card: "Card",
  square_apple_pay: "Apple Pay",
  square_google_pay: "Google Pay",
};

// Fire-and-forget from the caller's point of view — failures are logged,
// never thrown, so a flaky email provider can never block a payment that
// Square has already successfully charged.
export async function sendInvoicePaymentNotification(notice: InvoicePaymentNotification): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn(
      "sendInvoicePaymentNotification: RESEND_API_KEY / ADMIN_NOTIFICATION_EMAIL not set, skipping email"
    );
    return;
  }

  const who = [notice.customerName, notice.customerCompany].filter(Boolean).join(" — ") || "A customer";
  const label = notice.invoiceNumber ? `Invoice ${notice.invoiceNumber}` : `Invoice ${notice.invoiceId.slice(0, 8)}`;
  const methodLabel = METHOD_LABEL[notice.method] ?? notice.method;
  const paidInFull = notice.balance <= 0.01;

  const subject = `Payment received — ${label} (${money(notice.amount)})`;

  const html = `
    <div style="font-family: Helvetica, Arial, sans-serif; color: #1a2332; max-width: 480px;">
      <h2 style="margin: 0 0 4px;">Payment received</h2>
      <p style="margin: 0 0 16px; color: #666;">${who} paid ${label} online.</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 4px 0; color: #666;">Amount paid</td><td style="padding: 4px 0; text-align: right; font-weight: bold;">${money(notice.amount)}</td></tr>
        <tr><td style="padding: 4px 0; color: #666;">Method</td><td style="padding: 4px 0; text-align: right;">${methodLabel}</td></tr>
        <tr><td style="padding: 4px 0; color: #666;">Paid to date</td><td style="padding: 4px 0; text-align: right;">${money(notice.amountPaid)} of ${money(notice.grandTotal)}</td></tr>
        <tr><td style="padding: 4px 0; color: #666;">Balance remaining</td><td style="padding: 4px 0; text-align: right;">${paidInFull ? "Paid in full" : money(notice.balance)}</td></tr>
      </table>
      <p style="margin: 20px 0 0;"><a href="${notice.payPageUrl}" style="color: #1a56cd;">View the invoice</a></p>
    </div>
  `.trim();

  const text = [
    `${who} paid ${label} online.`,
    `Amount paid: ${money(notice.amount)}`,
    `Method: ${methodLabel}`,
    `Paid to date: ${money(notice.amountPaid)} of ${money(notice.grandTotal)}`,
    `Balance remaining: ${paidInFull ? "Paid in full" : money(notice.balance)}`,
    `Invoice: ${notice.payPageUrl}`,
  ].join("\n");

  try {
    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "JM Digital Media <onboarding@resend.dev>",
      to: process.env.ADMIN_NOTIFICATION_EMAIL as string,
      subject,
      html,
      text,
    });
    if (error) {
      console.error("sendInvoicePaymentNotification: Resend returned an error", error);
    }
  } catch (err) {
    console.error("sendInvoicePaymentNotification: failed to send", err);
  }
}
