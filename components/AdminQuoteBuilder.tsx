"use client";

import { useEffect, useState } from "react";
import { ComputedQuote, QuoteLineInput } from "@/lib/quote";
import { QuoteRecord } from "@/lib/quotes-store";
import { DecorationOption, Product, SetupChargeType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";

type PendingLine = QuoteLineInput & {
  key: string;
  brandName: string;
  productName: string;
};

type PdfMode = "customer" | "internal" | "work-order" | "invoice";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  // A previously saved quote/invoice to load into the builder for editing
  // (see AdminSavedQuotesList's "Edit" action, wired up in AdminQuotesTab).
  // The parent renders this component with `key={initialRecord?.id ?? "new"}`
  // so switching which record is being edited remounts the builder with
  // fresh initial state, rather than mutating state from a prop change.
  initialRecord?: QuoteRecord | null;
  // Called after a successful save/update so a parent can refresh its
  // saved-quotes list and keep track of which record is now active.
  onSaved?: (record: QuoteRecord) => void;
};

function linesFromRecord(record: QuoteRecord): PendingLine[] {
  return record.input.lines.map((l, i) => {
    const computedLine = record.computed.lines[i];
    return {
      key: `${l.styleNumber}-${l.colorName}-${i}-${Date.now()}`,
      styleNumber: l.styleNumber,
      colorName: l.colorName,
      sizes: l.sizes,
      decorationId: l.decorationId,
      priceColumnId: l.priceColumnId,
      brandName: computedLine?.brandName ?? "",
      productName: computedLine?.productName ?? "",
    };
  });
}

export default function AdminQuoteBuilder({ initialRecord, onSaved }: Props) {
  const [decorations, setDecorations] = useState<DecorationOption[]>([]);
  const [decorationsLoaded, setDecorationsLoaded] = useState(false);
  const [setupCharges, setSetupCharges] = useState<SetupChargeType[]>([]);
  const [selectedSetupChargeIds, setSelectedSetupChargeIds] = useState<string[]>(
    () => initialRecord?.input.setupChargeIds ?? []
  );

  // Customer / quote header fields.
  const [customerName, setCustomerName] = useState(() => initialRecord?.input.customerName ?? "");
  const [customerCompany, setCustomerCompany] = useState(
    () => initialRecord?.input.customerCompany ?? ""
  );
  const [customerEmail, setCustomerEmail] = useState(() => initialRecord?.input.customerEmail ?? "");
  const [quoteDate, setQuoteDate] = useState(() => initialRecord?.input.quoteDate ?? todayIso());
  const [notes, setNotes] = useState(() => initialRecord?.input.notes ?? "");

  // "Add garment" lookup state.
  const [styleInput, setStyleInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [sizeQty, setSizeQty] = useState<Record<string, number>>({});
  const [selectedDecorationId, setSelectedDecorationId] = useState("");
  const [selectedColumnId, setSelectedColumnId] = useState("");

  const [lines, setLines] = useState<PendingLine[]>(() =>
    initialRecord ? linesFromRecord(initialRecord) : []
  );

  const [quote, setQuote] = useState<ComputedQuote | null>(() => initialRecord?.computed ?? null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState<PdfMode | null>(null);

  // The saved record currently loaded into the builder, if any — null means
  // "unsaved, brand-new quote." Set at mount from initialRecord, or by a
  // successful save/update/convert.
  const [activeRecord, setActiveRecord] = useState<QuoteRecord | null>(initialRecord ?? null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    fetch("/api/decorations")
      .then((r) => r.json())
      .then((d: DecorationOption[]) => setDecorations(d))
      .catch(() => setDecorations([]))
      .finally(() => setDecorationsLoaded(true));
    fetch("/api/admin/setup-charges")
      .then((r) => r.json())
      .then((d: { setupCharges: SetupChargeType[] }) => setSetupCharges(d.setupCharges ?? []))
      .catch(() => setSetupCharges([]));
  }, []);

  function startNewQuote() {
    setActiveRecord(null);
    setCustomerName("");
    setCustomerCompany("");
    setCustomerEmail("");
    setQuoteDate(todayIso());
    setNotes("");
    setSelectedSetupChargeIds([]);
    setLines([]);
    setQuote(null);
    setFoundProduct(null);
    setQuoteError(null);
    setSaveMessage(null);
  }

  function toggleSetupCharge(id: string, checked: boolean) {
    setSelectedSetupChargeIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
    setQuote(null);
  }

  const selectedDecoration = decorations.find((d) => d.id === selectedDecorationId);

  async function runLookup() {
    const style = styleInput.trim();
    if (!style) return;
    setLookupLoading(true);
    setLookupError(null);
    setFoundProduct(null);
    try {
      const res = await fetch(`/api/admin/quote/lookup?style=${encodeURIComponent(style)}`);
      const data = await res.json();
      if (!res.ok) {
        setLookupError(data.error || "Lookup failed");
        return;
      }
      const product = data.product as Product;
      setFoundProduct(product);
      setSelectedColor(product.colors[0]?.colorName ?? "");
      const initialQty: Record<string, number> = {};
      for (const sz of product.colors[0]?.sizes ?? []) initialQty[sz.name] = 0;
      setSizeQty(initialQty);
      setSelectedDecorationId("");
      setSelectedColumnId("");
    } catch {
      setLookupError("Lookup failed — check the style number and try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  function fillOneEach() {
    const color = foundProduct?.colors.find((c) => c.colorName === selectedColor);
    if (!color?.sizes) return;
    const next: Record<string, number> = {};
    for (const sz of color.sizes) next[sz.name] = 1;
    setSizeQty(next);
  }

  function clearQuantities() {
    const color = foundProduct?.colors.find((c) => c.colorName === selectedColor);
    if (!color?.sizes) return;
    const next: Record<string, number> = {};
    for (const sz of color.sizes) next[sz.name] = 0;
    setSizeQty(next);
  }

  function addLine() {
    if (!foundProduct) return;
    const sizes = Object.entries(sizeQty)
      .filter(([, qty]) => qty > 0)
      .map(([size, quantity]) => ({ size, quantity }));
    if (sizes.length === 0) {
      setLookupError("Enter a quantity for at least one size before adding.");
      return;
    }
    const line: PendingLine = {
      key: `${foundProduct.styleNumber}-${selectedColor}-${Date.now()}`,
      styleNumber: foundProduct.styleNumber,
      brandName: foundProduct.brandName,
      productName: foundProduct.productName,
      colorName: selectedColor,
      sizes,
      decorationId: selectedDecorationId || undefined,
      priceColumnId: selectedColumnId || undefined,
    };
    setLines((prev) => [...prev, line]);
    // Reset the lookup panel for the next garment.
    setFoundProduct(null);
    setStyleInput("");
    setLookupError(null);
    setQuote(null);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setQuote(null);
  }

  function buildQuoteInput() {
    return {
      customerName: customerName || undefined,
      customerCompany: customerCompany || undefined,
      customerEmail: customerEmail || undefined,
      quoteDate,
      notes: notes || undefined,
      lines: lines.map((l) => ({
        styleNumber: l.styleNumber,
        colorName: l.colorName,
        sizes: l.sizes,
        decorationId: l.decorationId,
        priceColumnId: l.priceColumnId,
      })),
      setupChargeIds: selectedSetupChargeIds,
    };
  }

  async function generateQuote() {
    if (lines.length === 0) return;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const res = await fetch("/api/admin/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQuoteInput()),
      });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to compute quote");
        return;
      }
      setQuote(data.quote as ComputedQuote);
    } catch {
      setQuoteError("Failed to compute quote — check your connection and try again.");
    } finally {
      setQuoteLoading(false);
    }
  }

  async function downloadPdf(mode: PdfMode) {
    if (lines.length === 0) return;
    setPdfLoading(mode);
    setQuoteError(null);
    try {
      // A saved record renders from its stored pricing snapshot (so the
      // document matches what was actually saved, and invoice mode has the
      // invoice number/payment status to show) — an unsaved quote falls
      // back to the ad-hoc compute-and-render endpoint.
      const res = activeRecord
        ? await fetch(`/api/admin/quotes/${activeRecord.id}/pdf?mode=${mode}`)
        : await fetch("/api/admin/quote/pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...buildQuoteInput(), mode }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setQuoteError(data.error || "Failed to generate PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      a.download = match?.[1] ?? "quote.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setQuoteError("Failed to generate PDF — check your connection and try again.");
    } finally {
      setPdfLoading(null);
    }
  }

  async function saveQuote() {
    if (lines.length === 0) return;
    setSaving(true);
    setSaveMessage(null);
    setQuoteError(null);
    try {
      const isUpdate = !!activeRecord;
      const res = await fetch(isUpdate ? `/api/admin/quotes/${activeRecord!.id}` : "/api/admin/quotes", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQuoteInput()),
      });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to save quote");
        return;
      }
      const record = data.record as QuoteRecord;
      setActiveRecord(record);
      setQuote(record.computed);
      setSaveMessage(
        (isUpdate ? "Quote updated." : "Quote saved.") +
          (data.persisted === false ? " No durable storage connected yet — see the list below." : "")
      );
      onSaved?.(record);
    } catch {
      setQuoteError("Failed to save quote — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function convertToInvoice() {
    if (!activeRecord) return;
    setConverting(true);
    setQuoteError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${activeRecord.id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Failed to convert to invoice");
        return;
      }
      const record = data.record as QuoteRecord;
      setActiveRecord(record);
      setSaveMessage(`Converted to invoice ${record.invoiceNumber}.`);
      onSaved?.(record);
    } catch {
      setQuoteError("Failed to convert to invoice — check your connection and try again.");
    } finally {
      setConverting(false);
    }
  }

  const selectedColorSizes =
    foundProduct?.colors.find((c) => c.colorName === selectedColor)?.sizes ?? [];

  return (
    <div className="space-y-8">
      {activeRecord && (
        <div className="flex items-center justify-between gap-3 bg-navy/5 border border-navy/10 rounded-xl px-4 py-2.5 text-sm">
          <div className="text-navy/70">
            Editing {activeRecord.status === "invoice" ? `invoice ${activeRecord.invoiceNumber}` : "saved quote"}{" "}
            <span className="text-navy/40">
              (saved {new Date(activeRecord.updatedAt).toLocaleDateString()})
            </span>
            {activeRecord.status === "invoice" && activeRecord.invoiceStatus && (
              <span
                className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                  activeRecord.invoiceStatus === "paid"
                    ? "bg-green-100 text-green-800"
                    : activeRecord.invoiceStatus === "partially_paid"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {activeRecord.invoiceStatus.replace("_", " ")}
              </span>
            )}
          </div>
          <button
            onClick={startNewQuote}
            className="text-xs text-navy/60 px-3 py-1 rounded-lg border border-navy/20 hover:bg-white shrink-0"
          >
            Start a new quote
          </button>
        </div>
      )}

      {/* Customer / quote header */}
      <section className="bg-white border border-navy/10 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-navy mb-3">Quote details</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-navy/60">
            Customer name
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
              placeholder="Jane Smith"
            />
          </label>
          <label className="text-xs text-navy/60">
            Company (optional)
            <input
              value={customerCompany}
              onChange={(e) => setCustomerCompany(e.target.value)}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-navy/60">
            Email (optional)
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-navy/60">
            Quote date
            <input
              type="date"
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="block text-xs text-navy/60 mt-3">
          Notes (optional, printed on the PDF)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
            rows={2}
          />
        </label>
      </section>

      {/* Setup charges — flat, quote-wide, independent of any decoration */}
      <section className="bg-white border border-navy/10 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-navy mb-1">Setup charges</h3>
        <p className="text-xs text-navy/50 mb-3">
          One-time charges for this quote as a whole — not tied to any garment or decoration.
          Manage the available list on the &quot;Setup Charges&quot; tab.
        </p>
        {setupCharges.length === 0 ? (
          <p className="text-xs text-navy/40">No setup charges configured yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {setupCharges.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm text-navy/70">
                <input
                  type="checkbox"
                  checked={selectedSetupChargeIds.includes(c.id)}
                  onChange={(e) => toggleSetupCharge(c.id, e.target.checked)}
                />
                {c.label} <span className="text-navy/40">({formatUSD(c.price)})</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Add a garment */}
      <section className="bg-white border border-navy/10 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-navy mb-3">Add a garment</h3>
        <div className="flex items-end gap-2">
          <label className="text-xs text-navy/60 flex-1 max-w-xs">
            SanMar style number
            <input
              value={styleInput}
              onChange={(e) => setStyleInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runLookup()}
              className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
              placeholder="ST640"
            />
          </label>
          <button
            onClick={runLookup}
            disabled={lookupLoading || !styleInput.trim()}
            className="text-sm px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
          >
            {lookupLoading ? "Looking up…" : "Look up"}
          </button>
        </div>
        {lookupError && <p className="mt-2 text-xs text-red-600">{lookupError}</p>}

        {foundProduct && (
          <div className="mt-4 border-t border-navy/10 pt-4">
            <p className="text-sm font-medium text-navy">
              {foundProduct.brandName} {foundProduct.productName}{" "}
              <span className="text-navy/40 font-normal">({foundProduct.styleNumber})</span>
            </p>

            <label className="block text-xs text-navy/60 mt-3 max-w-xs">
              Color
              <select
                value={selectedColor}
                onChange={(e) => {
                  setSelectedColor(e.target.value);
                  const color = foundProduct.colors.find((c) => c.colorName === e.target.value);
                  const next: Record<string, number> = {};
                  for (const sz of color?.sizes ?? []) next[sz.name] = 0;
                  setSizeQty(next);
                }}
                className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
              >
                {foundProduct.colors.map((c) => (
                  <option key={c.colorName} value={c.colorName}>
                    {c.colorName}
                  </option>
                ))}
              </select>
            </label>

            {selectedColorSizes.length > 0 ? (
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-navy/60 uppercase tracking-wide">
                    Quantity per size
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={fillOneEach}
                      className="text-xs px-2 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
                    >
                      Fill 1 of each
                    </button>
                    <button
                      onClick={clearQuantities}
                      className="text-xs px-2 py-1 rounded-lg border border-navy/20 hover:bg-navy/5"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
                  {selectedColorSizes.map((sz) => (
                    <label key={sz.name} className="text-xs text-navy/60">
                      {sz.name}{" "}
                      <span className="text-navy/30">(${sz.price.toFixed(2)})</span>
                      <input
                        type="number"
                        min={0}
                        value={sizeQty[sz.name] ?? 0}
                        onChange={(e) =>
                          setSizeQty((prev) => ({
                            ...prev,
                            [sz.name]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1 text-sm"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-navy/40">This item has no size-based pricing (one-size item).</p>
            )}

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
              <label className="text-xs text-navy/60">
                Decoration (optional)
                <select
                  value={selectedDecorationId}
                  onChange={(e) => {
                    setSelectedDecorationId(e.target.value);
                    setSelectedColumnId("");
                  }}
                  className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="">None — garment only</option>
                  {decorations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
                {decorationsLoaded && decorations.length === 0 && (
                  <span className="text-[11px] text-navy/40">No decoration types configured yet.</span>
                )}
              </label>

              {selectedDecoration?.priceColumns && selectedDecoration.priceColumns.length > 0 && (
                <label className="text-xs text-navy/60">
                  Stitch count / pricing column
                  <select
                    value={selectedColumnId}
                    onChange={(e) => setSelectedColumnId(e.target.value)}
                    className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">Select…</option>
                    {selectedDecoration.priceColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {selectedDecoration?.quoteRequired && (
              <p className="mt-2 text-xs text-amber-700">
                This decoration type is marked &quot;quote required&quot; site-wide, so it will price at $0
                here too — set an explicit price on the Pricing tab if you want this quote to reflect a
                real cost.
              </p>
            )}

            <button
              onClick={addLine}
              className="mt-4 text-sm px-4 py-1.5 rounded-lg bg-red text-white hover:bg-red/90"
            >
              Add to quote
            </button>
          </div>
        )}
      </section>

      {/* Lines added so far */}
      {lines.length > 0 && (
        <section className="bg-white border border-navy/10 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-navy mb-3">Quote lines ({lines.length})</h3>
          <div className="space-y-2">
            {lines.map((line) => {
              const decoration = decorations.find((d) => d.id === line.decorationId);
              const column = decoration?.priceColumns?.find((c) => c.id === line.priceColumnId);
              const totalQty = line.sizes.reduce((sum, s) => sum + s.quantity, 0);
              return (
                <div
                  key={line.key}
                  className="flex items-start justify-between gap-3 border border-navy/10 rounded-lg px-3 py-2"
                >
                  <div className="text-sm text-navy">
                    <span className="font-medium">
                      {line.brandName} {line.productName}
                    </span>{" "}
                    <span className="text-navy/40">
                      ({line.styleNumber} — {line.colorName})
                    </span>
                    <div className="text-xs text-navy/60 mt-0.5">
                      {line.sizes.map((s) => `${s.size}×${s.quantity}`).join(", ")} · {totalQty} total
                      {decoration ? ` · ${decoration.label}${column ? ` (${column.label})` : ""}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => removeLine(line.key)}
                    className="text-xs text-red-600 hover:underline shrink-0"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={generateQuote}
              disabled={quoteLoading}
              className="text-sm px-4 py-1.5 rounded-lg bg-navy text-white hover:bg-navy/90 disabled:opacity-40"
            >
              {quoteLoading ? "Calculating…" : "Preview quote"}
            </button>
            <button
              onClick={saveQuote}
              disabled={saving}
              className="text-sm px-4 py-1.5 rounded-lg bg-red text-white hover:bg-red/90 disabled:opacity-40"
            >
              {saving ? "Saving…" : activeRecord ? "Save changes" : "Save quote"}
            </button>
            {activeRecord && activeRecord.status === "quote" && (
              <button
                onClick={convertToInvoice}
                disabled={converting}
                className="text-sm px-4 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5 disabled:opacity-40"
              >
                {converting ? "Converting…" : "Convert to invoice"}
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => downloadPdf("customer")}
              disabled={pdfLoading !== null}
              className="text-sm px-4 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5 disabled:opacity-40"
            >
              {pdfLoading === "customer" ? "Generating…" : "Download customer PDF"}
            </button>
            <button
              onClick={() => downloadPdf("internal")}
              disabled={pdfLoading !== null}
              className="text-sm px-4 py-1.5 rounded-lg border border-red/30 text-red hover:bg-red/5 disabled:opacity-40"
            >
              {pdfLoading === "internal" ? "Generating…" : "Download company PDF (with cost)"}
            </button>
            <button
              onClick={() => downloadPdf("work-order")}
              disabled={pdfLoading !== null}
              className="text-sm px-4 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5 disabled:opacity-40"
            >
              {pdfLoading === "work-order" ? "Generating…" : "Download work order"}
            </button>
            {activeRecord?.status === "invoice" && (
              <button
                onClick={() => downloadPdf("invoice")}
                disabled={pdfLoading !== null}
                className="text-sm px-4 py-1.5 rounded-lg border border-green-600/30 text-green-700 hover:bg-green-50 disabled:opacity-40"
              >
                {pdfLoading === "invoice" ? "Generating…" : "Download invoice PDF"}
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-navy/40">
            The customer PDF shows only the final unit price and totals. The company PDF adds garment
            cost and decoration cost columns and is marked &quot;internal use only.&quot; The work order
            has no pricing at all — just garments, sizes, quantities, and decoration details for
            production staff. Saving keeps this quote on the &quot;Saved quotes &amp; invoices&quot; list
            below so it can be reopened, edited, or converted to an invoice later.
          </p>
          {saveMessage && <p className="mt-2 text-xs text-green-700">{saveMessage}</p>}
          {quoteError && <p className="mt-2 text-xs text-red-600">{quoteError}</p>}
        </section>
      )}

      {/* Computed preview */}
      {quote && (
        <section className="bg-white border border-navy/10 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-navy mb-3">Preview</h3>
          {quote.lines.map((line, i) => (
            <div key={i} className="mb-4">
              <p className="text-sm font-medium text-navy">
                {line.brandName} {line.productName}{" "}
                <span className="text-navy/40 font-normal">
                  ({line.styleNumber} — {line.colorName})
                  {line.decorationLabel ? ` · ${line.decorationLabel}` : ""}
                  {line.priceColumnLabel ? ` (${line.priceColumnLabel})` : ""}
                </span>
              </p>
              <div className="mt-1 overflow-x-auto">
                <table className="text-sm border-collapse w-full">
                  <thead>
                    <tr className="text-xs text-navy/60">
                      <th className="text-left pr-3 pb-1">Size</th>
                      <th className="text-left pr-3 pb-1">Qty</th>
                      <th className="text-left pr-3 pb-1">Garment</th>
                      <th className="text-left pr-3 pb-1">Decoration</th>
                      <th className="text-left pr-3 pb-1">Unit</th>
                      <th className="text-right pb-1">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.sizes.map((s) => (
                      <tr key={s.size} className="border-t border-navy/5">
                        <td className="pr-3 py-1">{s.size}</td>
                        <td className="pr-3 py-1">{s.quantity}</td>
                        <td className="pr-3 py-1">${s.garmentUnitPrice.toFixed(2)}</td>
                        <td className="pr-3 py-1">
                          {s.decorationUnitPrice > 0 ? `+$${s.decorationUnitPrice.toFixed(2)}` : "—"}
                        </td>
                        <td className="pr-3 py-1">${s.unitPrice.toFixed(2)}</td>
                        <td className="py-1 text-right">${s.lineTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {quote.setupCharges.length > 0 && (
            <div className="border-t border-navy/10 pt-3 mb-3">
              <div className="text-xs font-medium text-navy/60 uppercase tracking-wide mb-1">
                Setup charges
              </div>
              {quote.setupCharges.map((c) => (
                <div key={c.id} className="text-sm text-navy/70">
                  {c.label} — ${c.price.toFixed(2)}
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-navy/10 pt-3 flex justify-end">
            <div className="text-sm text-navy space-y-1 text-right">
              <div>
                Total units: <span className="font-medium">{quote.totalQuantity}</span>
              </div>
              <div className="text-lg font-semibold text-red">
                Grand total: ${quote.grandTotal.toFixed(2)}
              </div>
              <div className="text-xs text-navy/40">(setup charges included above)</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
