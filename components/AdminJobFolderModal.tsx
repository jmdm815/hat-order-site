"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import type { JobFolderMockup, JobFolderPress, QuoteRecord } from "@/lib/quotes-store";
import type { PressPreset } from "@/lib/press-presets-store";
import { itemPhotoUrl } from "@/lib/item-photo";
import GoogleDriveButton, { DriveIcon, pickDriveFileLocation } from "@/components/GoogleDriveButton";

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
// "Pick from Drive" (below) is the exception: Google's own Drive picker can
// report where a file lives, so it fills in the full Drive path plus a
// direct link (`url`) automatically — see lib/drive-location.ts.
type EditableRow = { id: string; label: string; path: string; url?: string; appliesTo?: string[] };

// Print locations offered in each row's dropdown. "Other…" reveals a text
// box for anything not listed; a saved custom label still shows (as itself).
const LABEL_SUGGESTIONS = [
  "Front",
  "Back",
  "Left Chest",
  "Right Chest",
  "Left Sleeve",
  "Right Sleeve",
  "Nape",
  "Hat Front",
  "Hat Left Side",
  "Hat Right Side",
  "Hat Back",
];
const OTHER_LABEL = "__other__";
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

// Short label for a line item in the print-file "Applies to" chips and on the
// job-folder PDF — style + color + piece count, e.g. "ST450 Black (49)".
// Customer-supplied/custom lines use the first line of their description.
function printFileLineLabel(line: QuoteRecord["computed"]["lines"][number]): string {
  const name = line.customerSupplied
    ? (line.itemDescription || "Customer-supplied item").split("\n")[0]
    : [line.styleNumber, line.colorName].filter(Boolean).join(" ") || line.productName || "Item";
  return `${name} (${line.quantity})`;
}

// Same as lib/quotes-store.ts's getJobFolderMockups (that module is
// server-only, so it's mirrored here): folds the legacy single image in.
function mockupsFromRecord(record: QuoteRecord): JobFolderMockup[] {
  const jf = record.jobFolder;
  if (!jf) return [];
  if (jf.mockups) return jf.mockups;
  return jf.mockupImageBlobUrl ? [{ id: "legacy", blobUrl: jf.mockupImageBlobUrl, lineItemLabel: jf.mockupLineItemLabel }] : [];
}

const MAX_MOCKUPS = 4;
const PRESS_PRESET_CUSTOM = "__custom__";

// Dropdown of print locations with an "Other…" text box — used for each
// mock-up's location label (same list as the print-file rows).
function LocationSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className: string }) {
  const [otherOpen, setOtherOpen] = useState(false);
  const isPreset = LABEL_SUGGESTIONS.includes(value);
  const isOther = !isPreset && (value !== "" || otherOpen);
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label="Print location"
        value={isPreset ? value : isOther ? OTHER_LABEL : ""}
        onChange={(e) => {
          const v = e.target.value;
          setOtherOpen(v === OTHER_LABEL);
          onChange(v === OTHER_LABEL ? "" : v);
        }}
        className={className}
      >
        <option value="">Location…</option>
        {LABEL_SUGGESTIONS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        <option value={OTHER_LABEL}>Other…</option>
      </select>
      {isOther && (
        <input
          autoFocus={value === ""}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Front — Left Chest"
          className={className}
        />
      )}
    </div>
  );
}

// Mirrors lib/quotes-store.ts's getJobFolderPressSettings (server-only).
function pressFromRecord(record: QuoteRecord): JobFolderPress[] {
  const jf = record.jobFolder;
  if (!jf) return [];
  const list = jf.pressSettings ?? (jf.press ? [jf.press] : []);
  return list.map((p) => ({ ...p, id: p.id || uuid() }));
}

function rowsFromRecord(record: QuoteRecord): EditableRow[] {
  const saved = record.jobFolder?.printFiles ?? [];
  return saved.map((f) => ({ id: f.id, label: f.label, path: f.path, url: f.url, appliesTo: f.appliesTo }));
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
  // De-duplicated short labels for the print-file "Applies to" chips.
  const lineItemChoices = Array.from(new Set(lineItems.map(printFileLineLabel)));
  // A picked mock-up image waits here until the admin chooses its print
  // location and which line item it shows, then "Upload" sends it.
  const [pendingMockupFile, setPendingMockupFile] = useState<File | null>(null);
  const [pendingLocation, setPendingLocation] = useState("");
  const [pendingLineItemChoice, setPendingLineItemChoice] = useState<string>(
    lineItems.length > 0 ? "0" : "reference"
  );

  // Uploaded mock-ups + their editable labels (saved with "Save").
  const [mockups, setMockups] = useState<JobFolderMockup[]>(mockupsFromRecord(record));

  // Press settings for the Heat / Press time boxes, and the saved presets.
  const [pressList, setPressList] = useState<JobFolderPress[]>(pressFromRecord(record));
  const [presets, setPresets] = useState<PressPreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [managingPresets, setManagingPresets] = useState(false);
  const [presetDraft, setPresetDraft] = useState<PressPreset[]>([]);
  const [savingPresets, setSavingPresets] = useState(false);

  useEffect(() => {
    fetch("/api/admin/press-presets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load press presets"))))
      .then((d) => setPresets(d.presets ?? []))
      .catch((e) => setPresetsError(e.message));
  }, []);

  function markDirty() {
    setRowsDirty(true);
    setRowsSaved(false);
  }

  function updatePress(id: string, patch: Partial<JobFolderPress>) {
    setPressList((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    markDirty();
  }

  function choosePreset(id: string, value: string) {
    const cur = pressList.find((p) => p.id === id);
    if (!cur) return;
    if (value === PRESS_PRESET_CUSTOM) updatePress(id, { presetId: undefined, name: undefined });
    else {
      const p = presets.find((x) => x.id === value);
      if (p) updatePress(id, { presetId: p.id, name: p.name, heat: p.heat, time: p.time, pressure: p.pressure, notes: p.notes });
    }
  }

  // Hand-editing the values detaches them from the preset they came from.
  function editPress(id: string, patch: Partial<JobFolderPress>) {
    updatePress(id, { ...patch, presetId: undefined, name: undefined });
  }

  function addPress() {
    const first = presets[0];
    setPressList((prev) => [
      ...prev,
      first
        ? { id: uuid(), presetId: first.id, name: first.name, heat: first.heat, time: first.time, pressure: first.pressure, notes: first.notes }
        : { id: uuid(), heat: "", time: "" },
    ]);
    markDirty();
  }

  function removePress(id: string) {
    setPressList((prev) => prev.filter((p) => p.id !== id));
    markDirty();
  }

  function openPresetManager() {
    setPresetDraft(presets.map((p) => ({ ...p })));
    setManagingPresets(true);
    setPresetsError(null);
  }

  async function savePresets() {
    setSavingPresets(true);
    setPresetsError(null);
    try {
      const res = await fetch("/api/admin/press-presets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presets: presetDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save presets");
      setPresets(data.presets);
      setManagingPresets(false);
    } catch (e) {
      setPresetsError(e instanceof Error ? e.message : "Couldn't save presets");
    } finally {
      setSavingPresets(false);
    }
  }

  const [downloading, setDownloading] = useState(false);


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

  // Rows where "Other…" was chosen in the print-location dropdown but no
  // custom text has been typed yet (so the text box stays open while empty).
  const [otherRowIds, setOtherRowIds] = useState<Set<string>>(new Set());

  // Which row is waiting on the Drive picker, and the last Drive error.
  const [drivePickingId, setDrivePickingId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  async function pickFromDriveFor(id: string) {
    setDriveError(null);
    setDrivePickingId(id);
    try {
      const loc = await pickDriveFileLocation();
      if (!loc) return;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, path: loc.path, url: loc.url } : r)));
      setRowsDirty(true);
      setRowsSaved(false);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : "Something went wrong with Google Drive.");
    } finally {
      setDrivePickingId(null);
    }
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
      prev.map((r) => (r.id === rowId ? { ...r, path: mergePathWithFilename(r.path, file.name), url: undefined } : r))
    );
    setRowsDirty(true);
    setRowsSaved(false);
  }

  async function saveRows(): Promise<boolean> {
    setSavingRows(true);
    setRowsError(null);
    try {
      const res = await fetch(`/api/admin/quotes/${record.id}/job-folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          printFiles: rows.map(({ id, label, path, url, appliesTo }) => ({ id, label, path, url, appliesTo })),
          pressSettings: pressList.filter((p) => p.heat || p.time),
          mockups: mockups.map(({ id, location, lineItemLabel }) => ({ id, location: location ?? "", lineItemLabel })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setCurrent(data.record);
      setRows(rowsFromRecord(data.record));
      setMockups(mockupsFromRecord(data.record));
      setPressList(pressFromRecord(data.record));
      onUpdated(data.record);
      setRowsDirty(false);
      setRowsSaved(true);
      return true;
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : "Failed to save");
      return false;
    } finally {
      setSavingRows(false);
    }
  }

  async function uploadMockup(file: File, lineItemLabelText: string, location = "") {
    setUploading(true);
    setMockupError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("lineItemLabel", lineItemLabelText);
      if (location) form.append("location", location);
      const res = await fetch(`/api/admin/quotes/${record.id}/job-folder/mockup`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setCurrent(data.record);
      // Keep any unsaved label edits on existing images; add the new one.
      const fresh = mockupsFromRecord(data.record);
      setMockups((prev) => fresh.map((m) => prev.find((p) => p.id === m.id) ?? m));
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
    setMockupError(null);
    setPendingLineItemChoice(lineItems.length > 0 ? "0" : "reference");
    // Suggest the next usual location: Front first, then Back.
    const used = mockups.map((m) => m.location);
    setPendingLocation(!used.includes("Front") ? "Front" : !used.includes("Back") ? "Back" : "");
    setPendingMockupFile(file);
  }

  function confirmPendingMockupUpload() {
    if (!pendingMockupFile) return;
    const label =
      pendingLineItemChoice === "reference"
        ? FOR_REFERENCE_ONLY
        : lineItemLabel(lineItems[Number(pendingLineItemChoice)]);
    uploadMockup(pendingMockupFile, label, pendingLocation);
    setPendingMockupFile(null);
  }

  function cancelPendingMockupUpload() {
    setPendingMockupFile(null);
    if (mockupInputRef.current) mockupInputRef.current.value = "";
  }

  async function removeMockup(mockupId: string) {
    if (!window.confirm("Remove this mock-up image?")) return;
    setUploading(true);
    setMockupError(null);
    try {
      const res = await fetch(
        `/api/admin/quotes/${record.id}/job-folder/mockup?mockupId=${encodeURIComponent(mockupId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove");
      setCurrent(data.record);
      const fresh = mockupsFromRecord(data.record);
      setMockups((prev) => fresh.map((m) => prev.find((p) => p.id === m.id) ?? m));
      onUpdated(data.record);
    } catch (e) {
      setMockupError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setUploading(false);
    }
  }

  // Opens a blank tab synchronously so the browser treats it as a direct
  // result of the click instead of blocking it as a popup, then navigates
  // it straight to the PDF route — see components/AdminQuoteBuilder.tsx's
  // downloadPdf for why this is a real navigation rather than a
  // fetch()-built Blob object URL (the route's own "inline; filename=..."
  // Content-Disposition only reliably determines the saved filename on a
  // real navigation).
  //
  // Unsaved changes are saved first so they're never left off the PDF. The
  // tab is opened synchronously (blank) so popup blockers allow it, then
  // pointed at the PDF once the save finishes.
  async function downloadJobFolder() {
    setDownloading(true);
    const url = `/api/admin/quotes/${record.id}/job-folder/pdf?v=${Date.now()}`;
    if (!rowsDirty) {
      const tab = window.open(url, "_blank");
      if (!tab) window.location.href = url;
      setDownloading(false);
      return;
    }
    const tab = window.open("about:blank", "_blank");
    const ok = await saveRows();
    if (ok) {
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } else {
      tab?.close();
    }
    setDownloading(false);
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
          A handout for production: page 1 is the no-pricing work order, page 2 is the production sheet —
          quantities, press settings, mock-ups and where to find each print file.
        </p>

        {/* --- Mock-ups ---------------------------------------------------- */}
        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-1">Mock-ups</p>
          <p className="text-xs text-admin-ink/62 mb-2">
            Add one image per print location (e.g. Front and Back) — they print side by side on the production sheet.
          </p>

          {mockups.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {mockups.map((m) => (
                <div key={m.id} className="bg-admin-ink/5 rounded-xl p-2">
                  <div className="bg-white rounded-lg p-1 flex items-center justify-center h-32">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={itemPhotoUrl(m.blobUrl)} alt={m.location || "Mock-up"} className="max-h-full object-contain" />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <LocationSelect
                      value={m.location ?? ""}
                      onChange={(v) => {
                        setMockups((prev) => prev.map((x) => (x.id === m.id ? { ...x, location: v } : x)));
                        markDirty();
                      }}
                      className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                    />
                    {lineItems.length > 0 && (
                      <select
                        aria-label="Line item shown"
                        value={m.lineItemLabel ?? FOR_REFERENCE_ONLY}
                        onChange={(e) => {
                          setMockups((prev) => prev.map((x) => (x.id === m.id ? { ...x, lineItemLabel: e.target.value } : x)));
                          markDirty();
                        }}
                        className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                      >
                        {lineItems.map((line, i) => (
                          <option key={i} value={lineItemLabel(line)}>
                            {lineItemLabel(line)}
                          </option>
                        ))}
                        {m.lineItemLabel &&
                          m.lineItemLabel !== FOR_REFERENCE_ONLY &&
                          !lineItems.some((line) => lineItemLabel(line) === m.lineItemLabel) && (
                            <option value={m.lineItemLabel}>{m.lineItemLabel}</option>
                          )}
                        <option value={FOR_REFERENCE_ONLY}>{FOR_REFERENCE_ONLY}</option>
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMockup(m.id)}
                      disabled={uploading}
                      className="text-xs text-admin-accent hover:underline disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
            <div className="mt-2 bg-admin-ink/5 rounded-xl p-3 space-y-2">
              <p className="text-xs text-admin-ink/88">
                Where does <span className="font-medium text-admin-ink">{pendingMockupFile.name}</span> go?
              </p>
              <LocationSelect value={pendingLocation} onChange={setPendingLocation} className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20" />
              {lineItems.length > 0 && (
                <select
                  aria-label="Line item shown"
                  value={pendingLineItemChoice}
                  onChange={(e) => setPendingLineItemChoice(e.target.value)}
                  className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                >
                  {lineItems.map((line, i) => (
                    <option key={i} value={String(i)}>
                      {lineItemLabel(line)}
                    </option>
                  ))}
                  <option value="reference">{FOR_REFERENCE_ONLY}</option>
                </select>
              )}
              <div className="flex items-center gap-2">
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

          {mockups.length < MAX_MOCKUPS && !pendingMockupFile && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => mockupInputRef.current?.click()}
                disabled={uploading}
                className="text-xs px-3 py-1.5 rounded-xl border border-admin-ink/20 text-admin-ink hover:bg-admin-ink/5 disabled:opacity-40"
              >
                {uploading ? "Uploading…" : mockups.length ? "+ Add another mock-up" : "Upload mock-up image"}
              </button>
              <GoogleDriveButton accept="image/png,image/jpeg,image/webp" onFile={handleMockupFileChosen} />
            </div>
          )}
          {mockupError && <p className="mt-1.5 text-xs text-admin-accent font-medium">{mockupError}</p>}
        </div>

        {/* --- Press settings ---------------------------------------------- */}
        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide">Press settings</p>
            {!managingPresets && (
              <button type="button" onClick={openPresetManager} className="text-xs text-blue-400 hover:underline">
                Manage presets
              </button>
            )}
          </div>

          {!managingPresets ? (
            <>
              {pressList.length === 0 && (
                <p className="text-xs text-admin-ink/62 mb-2">No press settings on this job yet.</p>
              )}
              <div className="space-y-2">
                {pressList.map((p) => (
                  <div key={p.id} className="bg-admin-ink/5 rounded-xl p-2.5">
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Press preset"
                        value={p.presetId && presets.some((x) => x.id === p.presetId) ? p.presetId : PRESS_PRESET_CUSTOM}
                        onChange={(e) => choosePreset(p.id!, e.target.value)}
                        className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                      >
                        {presets.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} — {[x.heat, x.time].filter(Boolean).join(", ")}
                          </option>
                        ))}
                        <option value={PRESS_PRESET_CUSTOM}>Custom…</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removePress(p.id!)}
                        title="Remove this press setting"
                        className="shrink-0 text-admin-ink/62 hover:text-admin-accent text-sm px-1"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-admin-ink/72">
                        Heat
                        <input value={p.heat} onChange={(e) => editPress(p.id!, { heat: e.target.value })} placeholder="285°F" className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20 mt-0.5" />
                      </label>
                      <label className="text-[11px] text-admin-ink/72">
                        Press time
                        <input value={p.time} onChange={(e) => editPress(p.id!, { time: e.target.value })} placeholder="4–6 sec" className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20 mt-0.5" />
                      </label>
                      <label className="text-[11px] text-admin-ink/72">
                        Pressure (optional)
                        <input value={p.pressure ?? ""} onChange={(e) => editPress(p.id!, { pressure: e.target.value })} placeholder="Medium" className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20 mt-0.5" />
                      </label>
                      <label className="text-[11px] text-admin-ink/72">
                        Notes (optional)
                        <input value={p.notes ?? ""} onChange={(e) => editPress(p.id!, { notes: e.target.value })} placeholder="Hot peel" className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20 mt-0.5" />
                      </label>
                    </div>
                    {lineItemChoices.length > 1 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-admin-ink/62 mr-0.5">Applies to:</span>
                        <button
                          type="button"
                          onClick={() => updatePress(p.id!, { appliesTo: [] })}
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${!p.appliesTo?.length ? "bg-admin-accent text-admin-accent-ink border-admin-accent font-medium" : "border-admin-ink/20 text-admin-ink/80 hover:bg-admin-ink/10"}`}
                        >
                          {pressList.length > 1 ? "All other items" : "All items"}
                        </button>
                        {lineItemChoices.map((choice) => {
                          const on = !!p.appliesTo?.includes(choice);
                          return (
                            <button
                              key={choice}
                              type="button"
                              onClick={() => {
                                const cur = p.appliesTo ?? [];
                                updatePress(p.id!, { appliesTo: on ? cur.filter((c) => c !== choice) : [...cur, choice] });
                              }}
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${on ? "bg-admin-accent text-admin-accent-ink border-admin-accent font-medium" : "border-admin-ink/20 text-admin-ink/80 hover:bg-admin-ink/10"}`}
                            >
                              {choice}
                            </button>
                          );
                        })}
                        {(p.appliesTo ?? [])
                          .filter((c) => !lineItemChoices.includes(c))
                          .map((stale) => (
                            <button
                              key={stale}
                              type="button"
                              title="No longer matches an item on this order — click to remove"
                              onClick={() => updatePress(p.id!, { appliesTo: (p.appliesTo ?? []).filter((c) => c !== stale) })}
                              className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-admin-accent text-admin-accent"
                            >
                              {stale} ✕
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addPress} className="mt-2 text-xs text-blue-400 hover:underline">
                {pressList.length ? "+ Add another press setting (e.g. for polyester)" : "+ Add press setting"}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              {presetDraft.map((p, i) => (
                <div key={p.id} className="bg-admin-ink/5 rounded-xl p-2 grid grid-cols-2 gap-1.5">
                  <input
                    value={p.name}
                    onChange={(e) => setPresetDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder="Preset name (e.g. DTF — cotton)"
                    className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20 col-span-2"
                  />
                  <input
                    value={p.heat}
                    onChange={(e) => setPresetDraft((d) => d.map((x, j) => (j === i ? { ...x, heat: e.target.value } : x)))}
                    placeholder="Heat (285°F)"
                    className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <input
                    value={p.time}
                    onChange={(e) => setPresetDraft((d) => d.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                    placeholder="Time (4–6 sec)"
                    className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <input
                    value={p.pressure ?? ""}
                    onChange={(e) => setPresetDraft((d) => d.map((x, j) => (j === i ? { ...x, pressure: e.target.value } : x)))}
                    placeholder="Pressure (optional)"
                    className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <input
                    value={p.notes ?? ""}
                    onChange={(e) => setPresetDraft((d) => d.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                    placeholder="Notes (optional)"
                    className="w-full bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <button
                    type="button"
                    onClick={() => setPresetDraft((d) => d.filter((_, j) => j !== i))}
                    className="col-span-2 justify-self-start text-xs text-admin-accent hover:underline"
                  >
                    Delete preset
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPresetDraft((d) => [...d, { id: uuid(), name: "", heat: "", time: "" }])}
                className="text-xs text-blue-400 hover:underline"
              >
                + Add preset
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={savePresets}
                  disabled={savingPresets}
                  className="text-xs px-3 py-1.5 rounded-xl bg-admin-bg text-admin-ink hover:bg-admin-bg/90 disabled:opacity-40"
                >
                  {savingPresets ? "Saving…" : "Save presets"}
                </button>
                <button type="button" onClick={() => setManagingPresets(false)} className="text-xs text-admin-ink/72 hover:text-admin-ink">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {presetsError && <p className="mt-1.5 text-xs text-admin-accent font-medium">{presetsError}</p>}
        </div>

        {/* --- Print file locations --------------------------------------- */}
        <div className="mt-4 border-t border-admin-ink/10 pt-4">
          <p className="text-xs font-medium text-admin-ink/80 uppercase tracking-wide mb-1">Print file locations</p>
          <p className="text-xs text-admin-ink/62 mb-3">
            Use <span className="font-medium text-admin-ink/80">Drive</span> to pick the print file in Google
            Drive — its full folder path fills in automatically, so whoever runs the job can find it in Google
            Drive. You can still type or paste a path by hand; &quot;Browse…&quot; only fills in a file name.
          </p>

          <input ref={browseInputRef} type="file" className="hidden" onChange={handleBrowseFileChosen} />

          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="bg-admin-ink/5 rounded-xl p-2.5">
                <div className="flex items-center gap-2">
                  {(() => {
                    const isPreset = LABEL_SUGGESTIONS.includes(row.label);
                    const isOther = !isPreset && (row.label !== "" || otherRowIds.has(row.id));
                    const fieldClass =
                      "w-32 shrink-0 bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20";
                    return (
                      <div className="w-32 shrink-0 flex flex-col gap-1">
                        <select
                          aria-label="Print location"
                          value={isPreset ? row.label : isOther ? OTHER_LABEL : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === OTHER_LABEL) {
                              setOtherRowIds((prev) => new Set(prev).add(row.id));
                              updateRow(row.id, { label: "" });
                            } else {
                              setOtherRowIds((prev) => {
                                const next = new Set(prev);
                                next.delete(row.id);
                                return next;
                              });
                              updateRow(row.id, { label: v });
                            }
                          }}
                          className={fieldClass}
                        >
                          <option value="">Print location…</option>
                          {LABEL_SUGGESTIONS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                          <option value={OTHER_LABEL}>Other…</option>
                        </select>
                        {isOther && (
                          <input
                            autoFocus={row.label === ""}
                            value={row.label}
                            onChange={(e) => updateRow(row.id, { label: e.target.value })}
                            placeholder="Type location"
                            className={fieldClass}
                          />
                        )}
                      </div>
                    );
                  })()}
                  <input
                    value={row.path}
                    onChange={(e) => updateRow(row.id, { path: e.target.value, url: undefined })}
                    placeholder="Shared drives/.../FRONT.pdf"
                    className="flex-1 min-w-0 bg-admin-card border border-admin-ink/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-admin-accent focus:ring-2 focus:ring-admin-accent/20"
                  />
                  <button
                    type="button"
                    onClick={() => pickFromDriveFor(row.id)}
                    disabled={drivePickingId !== null}
                    title="Pick the file in Google Drive to fill in its full folder path and link"
                    className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-admin-ink/20 text-admin-ink hover:bg-admin-ink/10 disabled:opacity-40"
                  >
                    <DriveIcon />
                    {drivePickingId === row.id ? "Opening…" : "Drive"}
                  </button>
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
                {lineItemChoices.length > 1 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-admin-ink/62 mr-0.5">Applies to:</span>
                    <button
                      type="button"
                      onClick={() => updateRow(row.id, { appliesTo: [] })}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        !row.appliesTo?.length
                          ? "bg-admin-accent text-admin-accent-ink border-admin-accent font-medium"
                          : "border-admin-ink/20 text-admin-ink/80 hover:bg-admin-ink/10"
                      }`}
                    >
                      All items
                    </button>
                    {lineItemChoices.map((choice) => {
                      const on = !!row.appliesTo?.includes(choice);
                      return (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => {
                            const cur = row.appliesTo ?? [];
                            const next = on ? cur.filter((c) => c !== choice) : [...cur, choice];
                            updateRow(row.id, { appliesTo: next });
                          }}
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            on
                              ? "bg-admin-accent text-admin-accent-ink border-admin-accent font-medium"
                              : "border-admin-ink/20 text-admin-ink/80 hover:bg-admin-ink/10"
                          }`}
                        >
                          {choice}
                        </button>
                      );
                    })}
                    {/* A saved choice that no longer matches a current line
                        (the order was edited since) — still shown so it can
                        be cleared. */}
                    {(row.appliesTo ?? [])
                      .filter((c) => !lineItemChoices.includes(c))
                      .map((stale) => (
                        <button
                          key={stale}
                          type="button"
                          title="No longer matches an item on this order — click to remove"
                          onClick={() => updateRow(row.id, { appliesTo: (row.appliesTo ?? []).filter((c) => c !== stale) })}
                          className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-admin-accent text-admin-accent"
                        >
                          {stale} ✕
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {driveError && <p className="mt-2 text-xs text-admin-accent font-medium">{driveError}</p>}

          <button
            type="button"
            onClick={addRow}
            className="mt-2 text-xs text-blue-400 hover:underline"
          >
            + Add print file
          </button>

        </div>

        {/* --- Save / Download — pinned to the bottom of the popup --------- */}
        <div className="sticky -bottom-5 -mx-5 -mb-5 mt-4 px-5 py-3 bg-admin-card border-t border-admin-ink/15 rounded-b-2xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => saveRows()}
              disabled={savingRows || !rowsDirty}
              className="shrink-0 text-sm px-4 py-2.5 rounded-xl border border-admin-ink/25 text-admin-ink hover:bg-admin-ink/10 disabled:opacity-40"
            >
              {savingRows ? "Saving…" : rowsDirty ? "Save" : "Saved"}
            </button>
            <button
              type="button"
              onClick={downloadJobFolder}
              disabled={downloading || savingRows}
              className="flex-1 py-2.5 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold hover:bg-admin-accent-dim disabled:opacity-40"
            >
              {downloading ? "Saving & generating…" : rowsDirty ? "Save & Download Job Folder PDF" : "Download Job Folder PDF"}
            </button>
          </div>
          {rowsDirty && !savingRows && (
            <p className="mt-1.5 text-xs text-amber-300">You have unsaved changes.</p>
          )}
          {rowsError && <p className="mt-1.5 text-xs text-red-300 font-medium">{rowsError}</p>}
        </div>
      </div>
    </div>
  );
}
