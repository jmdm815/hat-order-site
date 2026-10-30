"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { QuoteRecord } from "@/lib/quotes-store";
import { itemPhotoUrl } from "@/lib/item-photo";

type Props = {
  record: QuoteRecord;
  onClose: () => void;
  onUpdated: (record: QuoteRecord) => void;
};

// Local editable row — always has an `id` (even a brand-new unsaved row, so
// React keys stay stable while typing) and a `path`/`label` the admin fills
// in by hand. See lib/quotes-store.ts's JobFolderPrintFile doc comment for
// why this is plain text rather than a true file reference: no browser can
// read a real OS file path back from a file picker for security reasons, so
// "Browse…" below only ever fills in the picked file's *name* — the admin
// still supplies the folder portion themselves (typically pasted once via
// Finder's Option-right-click "Copy as Pathname" on a mounted Google Drive
// folder, or a Drive share link), then "Browse…" swaps in different
// filenames quickly for the rest of that job's rows.
type EditableRow = { id: string; label: string; path: string };

const LABEL_SUGGESTIONS = ["Front", "Back", "Left Sleeve", "Right Sleeve", "Left Chest", "Nape"];
const FOR_REFERENCE_ONLY = "For reference only";

// Same label text shown to the customer for each line item (see
// app/api/pay/[id]/route.ts's toCustomerSummary), plus the quantity, so the
// admin can tell apart two lines of the same garment in different colors —
// e.g. "24 x Gildan 5000 - Navy". Used for the "which line item is this
// mock-up for?" picker below.
function lineItemLabel(line: QuoteRecord["computed"]["lines"][number]): string {
  const desc = line.customerSupplied
    ? line.itemDescription || "Customer-supplied item"
    : [line.brandName, line.productName, line.colorName].filter(Boolean).join(" ");
  return `${line.quantity} × ${desc}`;
}

// If `path` already ends in a folder separator (or is empty), just
// append/set the filename. Otherwise, swap out everything after the last
// separator for the newly picked filename, keeping whatever folder prefix
// was already typed/pasted in.
function mergePathWithFilename(path: string, filename: string): string {
  const trimmed = path.trim();
  if (!trimmed || /[/\\]$/.test(trimmed)) return trimmed + filename;
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSep === -1) return filename;
  return trimmed.slice(0, lastSep + 1) + filename;
}

function rowsFromRecord(record: QuoteRecord): EditableRow[] {
  const saved = record.jobFolder?.printFiles ?? [];
  return saved.map((f) => ({ id: f.id, label: f.label, path: f.path }));
}

// "Create Job Folder" popup — opened from AdminSavedQuotesList.tsx. Lets the
// admin attach a garment mock-up image and a list of print-file locations to
// a quote/invoice, then download the 2-page job folder PDF (page 1: the
// existing no-pricing work order; page 2: the mock-up + print-file list —
// see lib/quote-pdf.ts's renderJobFolderPdf). Both halves save
// independently (mock-up uploads immediately; print files save via their
// own "Save" button) so a half-finished edit is never lost by closing one
// before the other.
export default function AdminJobFolderModal({ record, onClose, onUpdated }: Props) {
  const isInvoice = record.status === "invoice";
  const docLabel = isInvoice ? record.invoiceNumber ?? "Invoice" : record.quoteNumber ?? "Quote";

  const [current, setCurrent] = useState(record);
  const [rows, setRows] = useState<EditableRow[]>(rowsFromRecord(record));
  const [rowsDirty, setRowsDirty] = useState(false);
  const [savingRows, setSavingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsSaved, setRowsSaved] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [mockupError, setMockupError] = useState<string | null>(null);
  const mockupInputRef = useRef<HTMLInputElement>(null);
  // Which row's "Browse…" file picker is currently open, so its onChange
  // handler knows which row to fill in.
  const browseRowIdRef = useRef<string | null>(null);
  const browseInputRef = useRef<HTMLInputElement>(null);

  const lineItems = current.computed.lines;
  // A file picked from "Upload mock-up image"/"Replace image" waits here
  // until the admin says which line item it's for — the upload itself
  // doesn't fire until that's answered (see the "assign a line item" panel
  // below). When the order has no line items at all, there's nothing to
  // ask, so the upload goes straight through as "For reference only".
  const [pendingMockupFile, setPendingMockupFile] = useState<File | null>(null);
  const [pendingLineItemChoice, setPendingLineItemChoice] = useState<string>(
    lineItems.length > 0 ? "0" : "reference"
  );

  const [downloading, setDownloading] = useState(false);

  const mockupImageUrl = current.jobFolder?.mockupImageBlobUrl
    ? itemPhotoUrl(current.jobFolder.mockupImageBlobUrl)
    : null;

  function updateRow(id: string, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setRowsDirty(true);
    setRowsSaved(false);
  }

  function addRow() {
    setRows((prev) => [...prev, { id: uuid(), label: "", path: "" }]);
    setRowsDirty(true);
    setRowsSaved(false);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setRowsDirty(true);
    setRowsSaved(false);
  }

  function openBrowseFor(id: string) {
    browseRowIdRef.current = id;
    browseInputRef.current?.click();
  }

  function handleBrowseFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const rowId = browseRowIdRef.current;
    e.target.value = ""; // allow picking the same filename again later
    if (!file || !rowId) return;
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, path: mergePathWithFilename(r.path, file.name) } : r))
    );
    setRowsDirty(true);
    setRowsSaved(false);
  }

  async function saveRows() {
    setSavingRows(true);
    setRowsError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/job-folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printFiles: rows.map(({ id, label, path }) => ({ id, label, path })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setCurrent(data.record);
      setRows(rowsFromRecord(data.record));
      onUpdated(data.record);
      setRowsDirty(false);
      setRowsSaved(true);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingRows(false);
    }
  }

  async function uploadMockup(file: File, lineItemLabelText: string) {
    setUploading(true);
    setMockupError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("lineItemLabel", lineItemLabelText);
      const res = await fetch(`/api/admin/quotes/${record.id}/job-folder/mockup`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setCurrent(data.record);
      onUpdated(data.record);
    } catch (e) {
      setMockupError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (mockupInputRef.current) mockupInputRef.current.value = "";
    }
  }

  // Fires when a file's picked from "Upload mock-up image"/"Replace image".
  // An order with line items always pauses for the admin to say which one
  // this mock-up is for (or "For reference only") before actually
  // uploading — see the pendingMockupFile panel in the JSX below; an order
  // with none skips straight to uploading as "For reference only" since
  // there's nothing to choose between.
  function handleMockupFileChosen(file: File) {
    if (lineItems.length === 0) {
      uploadMockup(file, FOR_REFERENCE_ONLY);
      return;
    }
    setMockupError(null);
    setPendingLineItemChoice("0");
    setPendingMockupFile(file);
  }

  function confirmPendingMockupUpload() {
    if (!pendingMockupFile) return;
    const label =
      pendingLineItemChoice === "reference"
        ? FOR_REFERENCE_ONLY
        : lineItemLabel(lineItems[Number(pendingLineItemChoice)]);
    uploadMockup(pendingMockupFile, label);
    setPendingMockupFile(null);
  }

  function cancelPendingMockupUpload() {
    setPendingMockupFile(null);
    if (mockupInputRef.current) mockupInputRef.current.value = "";
  }

  async function removeMockup() {
    setUploading(true);
    setMockupError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/job-folder/mockup`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove");
      setCurrent(data.record);
      onUpdated(data.record);
    } catch (e) {
      setMockupError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setUploading(false);
    }
  }

  // Same open-tab-synchronously pattern used throughout the admin PDF/receipt
  // buttons (see components/AdminQuoteBuilder.tsx's downloadPdf) — opens the
  // tab before the `await` so the browser treats it as a direct result of
  // the click instead of blocking it as a popup.
  async function downloadJobFolder() {
    setDownloading(true);
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/job-folder/pdf`);
      if (!res.ok) {
        tab?.close();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        window.open(url, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-admin-bg/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-admin-card rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-admin-ink">Job Folder</h2>
            <p className="text-xs text-admin-ink/72">{isInvoice ? `Invoice ${docLabel}` : `Quote ${docLabel}`}</p>
          </div>
          <button onClick={onClose} className="text-admin-ink/62 hover:text-admin-ink text-sm px-1">
            ✕
          </button>
        </div>
        <p className="mt-2 text-xs text-admin-ink/62">
          A 2-page handout for production: page 1 is the no-pricing work order, page 2 is the garment
          mock-up and where to find each print file.
        </p>

        {/* --- Mock-up image --------------------------------------------- */}
        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-2">Garment mock-up</p>
          {mockupImageUrl ? (
            <>
              <div className="bg-white rounded-xl p-2 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mockupImageUrl} alt="Garment mock-up" className="max-h-48 object-contain" />
              </div>
              <p className="mt-1.5 text-xs text-admin-ink/62">
                For: <span className="text-admin-ink/88">{current.jobFolder?.mockupLineItemLabel || FOR_REFERENCE_ONLY}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-admin-ink/62 italic">No mock-up uploaded yet.</p>
          )}
          <input
            ref={mockupInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleMockupFileChosen(file);
            }}
          />

          {pendingMockupFile && (
            <div className="mt-2 bg-admin-ink/5 rounded-xl p-3">
              <p className="text-xs text-admin-ink/88">
                Which line item is <span className="font-medium text-admin-ink">{pendingMockupFile.name}</span> for?
              </p>
              <select
                value={pendingLineItemChoice}
                onChange={(e) => setPendingLineItemChoice(e.target.value)}
                className="mt-2 w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
              >
                {lineItems.map((line, i) => (
                  <option key={i} value={String(i)}>
                    {lineItemLabel(line)}
                  </option>
                ))}
                <option value="reference">{FOR_REFERENCE_ONLY}</option>
              </select>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={confirmPendingMockupUpload}
                  disabled={uploading}
                  className="text-xs px-3 py-1.5 rounded-xl bg-admin-bg text-admin-ink hover:bg-admin-bg/90 disabled:opacity-40"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
                <button
                  type="button"
                  onClick={cancelPendingMockupUpload}
                  disabled={uploading}
                  className="text-xs text-admin-ink/72 hover:text-admin-ink disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => mockupInputRef.current?.click()}
              disabled={uploading || !!pendingMockupFile}
              className="text-xs px-3 py-1.5 rounded-xl border border-admin-ink/20 text-admin-ink hover:bg-admin-ink/5 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : mockupImageUrl ? "Replace image" : "Upload mock-up image"}
            </button>
            {mockupImageUrl && (
              <button
                type="button"
                onClick={removeMockup}
                disabled={uploading}
                className="text-xs text-admin-accent hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </div>
          {mockupError && <p className="mt-1.5 text-xs text-admin-accent font-medium">{mockupError}</p>}
        </div>

        {/* --- Print file locations --------------------------------------- */}
        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-1">Print file locations</p>
          <p className="text-xs text-admin-ink/62 mb-3">
            Paste the path yourself (⌥-right-click a file in Finder → &quot;Copy as Pathname&quot;, or paste a
            Google Drive link) — browsers can&apos;t hand a website a real file path. &quot;Browse…&quot; can
            still fill in just the file name for you.
          </p>

          <datalist id="job-folder-label-suggestions">
            {LABEL_SUGGESTIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <input ref={browseInputRef} type="file" className="hidden" onChange={handleBrowseFileChosen} />

          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="bg-admin-ink/5 rounded-xl p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    list="job-folder-label-suggestions"
                    value={row.label}
                    onChange={(e) => updateRow(row.id, { label: e.target.value })}
                    placeholder="Front"
                    className="w-32 shrink-0 bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <input
                    value={row.path}
                    onChange={(e) => updateRow(row.id, { path: e.target.value })}
                    placeholder="Shared drives/.../FRONT.pdf"
                    className="flex-1 min-w-0 bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <button
                    type="button"
                    onClick={() => openBrowseFor(row.id)}
                    title="Pick a file to fill in its name"
                    className="shrink-0 text-xs px-2 py-1 rounded-lg border border-admin-ink/20 text-admin-ink hover:bg-admin-ink/10"
                  >
                    Browse…
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    title="Remove this row"
                    className="shrink-0 text-admin-ink/62 hover:text-admin-accent text-sm px-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-2 text-xs text-blue-400 hover:underline"
          >
            + Add print file
          </button>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={saveRows}
              disabled={savingRows || !rowsDirty}
              className="text-sm px-4 py-1.5 rounded-xl bg-admin-bg text-admin-ink hover:bg-admin-bg/90 disabled:opacity-40"
            >
              {savingRows ? "Saving…" : "Save"}
            </button>
            {rowsSaved && !rowsDirty && <span className="text-xs text-green-700">Saved.</span>}
          </div>
          {rowsError && <p className="mt-1.5 text-xs text-admin-accent font-medium">{rowsError}</p>}
        </div>

        {/* --- Download ----------------------------------------------------- */}
        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <button
            type="button"
            onClick={downloadJobFolder}
            disabled={downloading}
            className="w-full py-2.5 rounded-xl bg-admin-bg text-admin-ink font-semibold hover:bg-admin-bg/90 disabled:opacity-40"
          >
            {downloading ? "Generating…" : "Download Job Folder PDF"}
          </button>
          {rowsDirty && (
            <p className="mt-1.5 text-xs text-amber-600">
              You have unsaved print-file changes — save them first so they&apos;re included.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
