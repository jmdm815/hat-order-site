"use client";

import { useState } from "react";
import { QuoteRecord } from "@/lib/quotes-store";

type Props = {
  record: QuoteRecord;
  onClose: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Send to customer" — opened from the "Send" button next to the PDF
// download buttons (components/AdminQuoteBuilder.tsx and
// AdminSavedQuotesList.tsx). Emails the quote/invoice PDF via
// app/api/admin/quotes/[id]/send/route.ts to one or more addresses: the
// customer's profile email is pre-filled as a removable starting point, and
// the admin can add/remove as many additional addresses as needed. Email is
// the only channel wired up right now — the "Email / SMS" toggle below is
// there so adding SMS later is just enabling the second option, not
// redesigning this modal.
export default function AdminSendDocumentModal({ record, onClose }: Props) {
  const docLabel =
    record.status === "invoice" ? `Invoice ${record.invoiceNumber ?? ""}`.trim() : `Quote ${record.quoteNumber ?? ""}`.trim();

  const [emails, setEmails] = useState<string[]>(
    record.computed.customerEmail ? [record.computed.customerEmail.trim().toLowerCase()] : []
  );
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  function addEmail() {
    const value = newEmail.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setEmailError("That doesn't look like a valid email address.");
      return;
    }
    if (emails.includes(value)) {
      setEmailError("That address is already in the list.");
      return;
    }
    setEmails((prev) => [...prev, value]);
    setNewEmail("");
    setEmailError(null);
    setSentTo(null);
  }

  function removeEmail(value: string) {
    setEmails((prev) => prev.filter((e) => e !== value));
    setSentTo(null);
  }

  async function handleSend() {
    if (emails.length === 0) {
      setSendError("Add at least one email address.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setSentTo(data.sentTo ?? emails);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-navy/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-black rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5 border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Send to customer</h2>
            <p className="text-xs text-white/50">{docLabel || "This quote"}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-sm px-1">
            ✕
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="flex-1 text-sm font-semibold px-3 py-2 rounded-xl bg-white text-navy"
          >
            Email
          </button>
          <button
            type="button"
            disabled
            title="SMS is coming soon"
            className="flex-1 text-sm font-medium px-3 py-2 rounded-xl border border-white/15 text-white/30 cursor-not-allowed"
          >
            SMS (coming soon)
          </button>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-white/60 uppercase tracking-wide mb-1.5">Send to</p>
          {emails.length === 0 ? (
            <p className="text-xs text-white/40 mb-2">
              No email on this customer&apos;s profile yet — add one below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {emails.map((e) => (
                <span
                  key={e}
                  className="flex items-center gap-1.5 text-xs bg-white/5 border border-white/10 rounded-full pl-3 pr-1.5 py-1 text-white/80"
                >
                  {e}
                  <button
                    type="button"
                    onClick={() => removeEmail(e)}
                    aria-label={`Remove ${e}`}
                    className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 hover:text-white"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setEmailError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEmail();
                }
              }}
              placeholder="Add an email address…"
              className="flex-1 bg-black border border-white/20 rounded-xl px-2 py-1.5 text-sm outline-none focus:border-red focus:ring-2 focus:ring-red/20"
            />
            <button
              type="button"
              onClick={addEmail}
              className="shrink-0 text-sm px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/5"
            >
              + Add
            </button>
          </div>
          {emailError && <p className="mt-1.5 text-xs text-red">{emailError}</p>}
        </div>

        {sendError && <p className="mt-3 text-sm text-red font-medium">{sendError}</p>}
        {sentTo && (
          <p className="mt-3 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
            Sent to {sentTo.join(", ")}.
          </p>
        )}

        <button
          onClick={handleSend}
          disabled={sending || emails.length === 0}
          className="mt-4 w-full py-2 rounded-xl bg-red text-navy text-sm font-semibold hover:bg-red/90 disabled:opacity-40"
        >
          {sending ? "Sending…" : `Send ${record.status === "invoice" ? "invoice" : "quote"} PDF`}
        </button>
        <p className="mt-2 text-xs text-white/40">
          Emails the same PDF as &quot;Download customer PDF&quot; to every address above.
        </p>
      </div>
    </div>
  );
}
