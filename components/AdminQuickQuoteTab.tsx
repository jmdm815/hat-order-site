"use client";

import AdminQuoteBuilder, { PendingLine } from "@/components/AdminQuoteBuilder";

type Props = {
  // Bubbled up from AdminQuoteBuilder's "Create quote" button (mode="quick")
  // — see AdminDashboard, which seeds the Quotes tab's builder with these
  // lines/setup charges and switches to it.
  onCreateQuote: (lines: PendingLine[], setupChargeIds: string[]) => void;
};

// Quick Quote tab — a fast, no-customer-required price check for someone
// who just wants to know what one (or a few) garments would cost, with or
// without a decoration. Thin wrapper around the same AdminQuoteBuilder used
// by the full Quotes tab, just in "quick" mode (no customer/date/notes/
// payment-terms fields, no save/convert/PDF actions — only "Create quote",
// which hands the in-progress lines to the full Quotes tab once a customer
// decides to actually order).
export default function AdminQuickQuoteTab({ onCreateQuote }: Props) {
  return <AdminQuoteBuilder mode="quick" onCreateQuote={onCreateQuote} />;
}
