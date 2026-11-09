"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scoreSewout } from "@/lib/sewout-search";
import { pickDriveFileLocation, DriveIcon } from "@/components/GoogleDriveButton";

// ---------------------------------------------------------------------------
// Sewout Library (/admin/sewouts)
// ---------------------------------------------------------------------------
// A searchable gallery of photographed embroidery sew-outs. Built phone-
// first: snap a photo of the sew-out, let auto-fill read the logo, check the
// details, save. Search by typing or the mic button (browser speech
// recognition) — typo-tolerant, so "doziers bbq" finds "Dozier's BBQ".
// ---------------------------------------------------------------------------

type Sewout = {
  id: string;
  customerId?: string;
  customerName: string;
  designName: string;
  photoUrls: string[];
  stitchCount?: number;
  widthIn?: number;
  heightIn?: number;
  threadColors?: string;
  placement?: string;
  fileLocation?: string;
  fileUrl?: string;
  notes?: string;
  tags?: string;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  customerName: string;
  customerId?: string;
  designName: string;
  stitchCount: string;
  widthIn: string;
  heightIn: string;
  threadColors: string;
  placement: string;
  fileLocation: string;
  fileUrl: string;
  notes: string;
  tags: string;
};

const EMPTY: Draft = {
  customerName: "",
  designName: "",
  stitchCount: "",
  widthIn: "",
  heightIn: "",
  threadColors: "",
  placement: "",
  fileLocation: "",
  fileUrl: "",
  notes: "",
  tags: "",
};

const PLACEMENTS = ["Left chest", "Right chest", "Full front", "Full back", "Upper back", "Sleeve", "Cap front", "Cap side", "Cap back", "Beanie"];

function toDraft(s: Sewout): Draft {
  return {
    customerName: s.customerName,
    customerId: s.customerId,
    designName: s.designName,
    stitchCount: s.stitchCount ? String(s.stitchCount) : "",
    widthIn: s.widthIn ? String(s.widthIn) : "",
    heightIn: s.heightIn ? String(s.heightIn) : "",
    threadColors: s.threadColors ?? "",
    placement: s.placement ?? "",
    fileLocation: s.fileLocation ?? "",
    fileUrl: s.fileUrl ?? "",
    notes: s.notes ?? "",
    tags: s.tags ?? "",
  };
}

function fromDraft(d: Draft) {
  return {
    ...d,
    stitchCount: d.stitchCount ? Number(d.stitchCount.replace(/[, ]/g, "")) : undefined,
    widthIn: d.widthIn ? Number(d.widthIn) : undefined,
    heightIn: d.heightIn ? Number(d.heightIn) : undefined,
  };
}

const sizeLabel = (s: Pick<Sewout, "widthIn" | "heightIn">) =>
  s.widthIn && s.heightIn ? `${s.widthIn}" × ${s.heightIn}"` : s.widthIn ? `${s.widthIn}" wide` : s.heightIn ? `${s.heightIn}" tall` : "";

// Browser speech recognition (Chrome, Edge, Safari incl. iPhone).
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function AdminSewoutLibrary() {
  const [sewouts, setSewouts] = useState<Sewout[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Sewout | null>(null);
  const [editing, setEditing] = useState<{ record: Sewout | null } | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const recRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    fetch("/api/admin/sewouts", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't load the library");
        setSewouts(data.sewouts);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load the library"));
    fetch("/api/admin/customers")
      .then((r) => r.json())
      .then((d) => setCustomers((d.customers ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const results = useMemo(() => {
    if (!sewouts) return [];
    if (!query.trim()) return sewouts;
    return sewouts
      .map((s) => ({ s, score: scoreSewout(s, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }, [sewouts, query]);

  function startVoice() {
    setVoiceError(null);
    const SR = getSpeechRecognition();
    if (!SR) {
      setVoiceError("Voice search isn't supported in this browser — try Chrome or Safari, or use the keyboard's mic.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      setQuery(said.replace(/[.?!]$/, ""));
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setVoiceError("Couldn't hear that — check microphone permission and try again.");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function onSaved(record: Sewout) {
    setSewouts((prev) => {
      const list = prev ?? [];
      const exists = list.some((s) => s.id === record.id);
      return exists ? list.map((s) => (s.id === record.id ? record : s)) : [record, ...list];
    });
    setEditing(null);
    setViewing(record);
  }

  async function remove(record: Sewout) {
    if (!window.confirm(`Delete "${record.customerName} — ${record.designName || "sew-out"}"? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/sewouts/${record.id}`, { method: "DELETE" });
    if (res.ok) {
      setSewouts((prev) => (prev ?? []).filter((s) => s.id !== record.id));
      setViewing(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-admin-ink/70">
          {sewouts ? `${sewouts.length} sew-out${sewouts.length === 1 ? "" : "s"}` : "Loading…"}
        </p>
        <button
          onClick={() => setEditing({ record: null })}
          className="px-4 py-2 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold text-sm hover:bg-admin-accent/90"
        >
          + Add sew-out
        </button>
      </div>

      {/* Search */}
      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, logo, colors…"
            className="w-full rounded-xl bg-admin-card border border-admin-ink/20 px-4 py-3 text-base text-admin-ink placeholder:text-admin-ink/45 focus:outline-none focus:border-admin-ink/60"
            aria-label="Search sew-outs"
          />
        </div>
        <button
          onClick={startVoice}
          className={`shrink-0 w-12 rounded-xl border flex items-center justify-center ${
            listening ? "bg-red-500 border-red-400 text-white animate-pulse" : "bg-admin-card border-admin-ink/20 text-admin-ink hover:border-admin-ink/60"
          }`}
          aria-label={listening ? "Stop listening" : "Search by voice"}
          title={listening ? "Listening… tap to stop" : "Search by voice"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
          </svg>
        </button>
      </div>
      {listening && <p className="mt-2 text-xs text-admin-ink/70">Listening… say a customer or logo name.</p>}
      {voiceError && <p className="mt-2 text-xs text-amber-300">{voiceError}</p>}
      {loadError && <p className="mt-3 text-sm text-red-300">{loadError}</p>}

      {/* Results */}
      {sewouts && results.length === 0 && (
        <div className="mt-10 text-center text-admin-ink/70 text-sm">
          {sewouts.length === 0 ? (
            <>
              <p className="text-base font-semibold text-admin-ink">No sew-outs yet</p>
              <p className="mt-1">Tap “+ Add sew-out”, take a photo of one, and it’ll show up here.</p>
            </>
          ) : (
            <p>Nothing matches “{query}”.</p>
          )}
        </div>
      )}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {results.map((s) => (
          <button
            key={s.id}
            onClick={() => setViewing(s)}
            className="text-left rounded-xl overflow-hidden bg-admin-card border border-admin-ink/15 hover:border-admin-ink/50 transition-colors"
          >
            <div className="aspect-square bg-white">
              {s.photoUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.photoUrls[0]} alt={`${s.customerName} sew-out`} className="w-full h-full object-contain" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">No photo</div>
              )}
            </div>
            <div className="p-2.5">
              <p className="text-sm font-semibold text-admin-ink truncate">{s.customerName}</p>
              <p className="text-xs text-admin-ink/70 truncate">{s.designName || "—"}</p>
              {(s.stitchCount || sizeLabel(s)) && (
                <p className="mt-0.5 text-[11px] text-admin-ink/55 truncate">
                  {[s.stitchCount ? `${s.stitchCount.toLocaleString()} st` : "", sizeLabel(s)].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      {viewing && (
        <SewoutDetail
          record={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing({ record: viewing })}
          onDelete={() => remove(viewing)}
          onChanged={(r) => {
            setViewing(r);
            setSewouts((prev) => (prev ?? []).map((s) => (s.id === r.id ? r : s)));
          }}
        />
      )}
      {editing && (
        <SewoutForm record={editing.record} customers={customers} onCancel={() => setEditing(null)} onSaved={onSaved} />
      )}
    </div>
  );
}

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"} max-h-[92vh] overflow-y-auto bg-admin-bg text-admin-ink rounded-t-2xl sm:rounded-2xl border border-admin-ink/20`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function SewoutDetail({
  record,
  onClose,
  onEdit,
  onDelete,
  onChanged,
}: {
  record: Sewout;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: (r: Sewout) => void;
}) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const photo = record.photoUrls[Math.min(photoIndex, record.photoUrls.length - 1)];

  async function addPhoto(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append("photo", file);
    const res = await fetch(`/api/admin/sewouts/${record.id}/photo`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && data.record) {
      onChanged(data.record);
      setPhotoIndex(data.record.photoUrls.length - 1);
    } else window.alert(data.error || "Couldn't add that photo");
  }

  async function removePhoto(i: number) {
    if (!window.confirm("Remove this photo?")) return;
    const res = await fetch(`/api/admin/sewouts/${record.id}/photo?index=${i}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.record) {
      onChanged(data.record);
      setPhotoIndex(0);
    }
  }

  const rows: [string, React.ReactNode][] = [
    ["Stitch count", record.stitchCount ? record.stitchCount.toLocaleString() : ""],
    ["Size", sizeLabel(record)],
    ["Placement", record.placement ?? ""],
    ["Thread colors", record.threadColors ?? ""],
    [
      "Stitch file",
      record.fileLocation || record.fileUrl ? (
        <span className="break-all">
          {record.fileLocation}
          {record.fileUrl && (
            <a href={record.fileUrl} target="_blank" rel="noreferrer" className="ml-2 underline text-admin-ink">
              Open in Drive ↗
            </a>
          )}
        </span>
      ) : (
        ""
      ),
    ],
    ["Notes", record.notes ?? ""],
  ];

  return (
    <Modal onClose={onClose} wide>
      <div className="sticky top-0 bg-admin-bg/95 backdrop-blur px-4 py-3 border-b border-admin-ink/15 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold truncate">{record.customerName}</h2>
          <p className="text-sm text-admin-ink/70 truncate">{record.designName || "Sew-out"}</p>
        </div>
        <button onClick={onClose} className="shrink-0 text-sm text-admin-ink/70 hover:text-admin-ink px-2 py-1">✕</button>
      </div>
      <div className="p-4">
        <div className="bg-white rounded-xl overflow-hidden">
          {photo ? (
            <a href={photo} target="_blank" rel="noreferrer" title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`${record.customerName} sew-out`} className="w-full max-h-[60vh] object-contain" />
            </a>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-slate-400">No photo yet</div>
          )}
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {record.photoUrls.map((u, i) => (
            <div key={u} className="relative shrink-0">
              <button
                onClick={() => setPhotoIndex(i)}
                className={`w-16 h-16 rounded-lg overflow-hidden bg-white border-2 ${i === photoIndex ? "border-admin-accent" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="w-full h-full object-cover" />
              </button>
              <button
                onClick={() => removePhoto(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px]"
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          ))}
          {record.photoUrls.length < 6 && (
            <label className="shrink-0 w-16 h-16 rounded-lg border-2 border-dashed border-admin-ink/30 flex items-center justify-center text-xs text-admin-ink/70 cursor-pointer hover:border-admin-ink/60">
              {busy ? "…" : "+ Photo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        <dl className="mt-4 divide-y divide-admin-ink/10 text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="py-2 grid grid-cols-[110px_1fr] gap-3">
                <dt className="text-admin-ink/60">{k}</dt>
                <dd className="whitespace-pre-wrap">{v}</dd>
              </div>
            ))}
        </dl>

        <div className="mt-5 flex gap-2 justify-between">
          <button onClick={onDelete} className="text-sm text-red-300 hover:underline">Delete</button>
          <button onClick={onEdit} className="px-4 py-2 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold text-sm">
            Edit details
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SewoutForm({
  record,
  customers,
  onCancel,
  onSaved,
}: {
  record: Sewout | null;
  customers: { id: string; name: string }[];
  onCancel: () => void;
  onSaved: (r: Sewout) => void;
}) {
  const [draft, setDraft] = useState<Draft>(record ? toDraft(record) : EMPTY);
  const [files, setFiles] = useState<File[]>([]);

  const [autofill, setAutofill] = useState<"idle" | "working" | "done" | "off" | "failed">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !record;

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  async function runAutofill(file: File) {
    setAutofill("working");
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const res = await fetch("/api/admin/sewouts/autofill", { method: "POST", body: fd });
      if (res.status === 501) return setAutofill("off");
      const data = await res.json();
      if (!res.ok || !data.suggestion) return setAutofill("failed");
      const s = data.suggestion;
      // Only fill fields that are still empty — never overwrite typing.
      setDraft((d) => ({
        ...d,
        customerName: d.customerName || s.customerName || "",
        designName: d.designName || s.designName || "",
        threadColors: d.threadColors || s.threadColors || "",
        placement: d.placement || s.placement || "",
        widthIn: d.widthIn || (s.widthIn ? String(s.widthIn) : ""),
        heightIn: d.heightIn || (s.heightIn ? String(s.heightIn) : ""),
        stitchCount: d.stitchCount || (s.stitchCount ? String(s.stitchCount) : ""),
        tags: d.tags || s.tags || "",
        notes: d.notes || s.notes || "",
      }));
      setAutofill("done");
    } catch {
      setAutofill("failed");
    }
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const added = Array.from(list).slice(0, 6 - files.length);
    const next = [...files, ...added];
    setFiles(next);
    if (isNew && files.length === 0 && added[0]) runAutofill(added[0]);
  }

  async function pickFromDrive() {
    try {
      const loc = await pickDriveFileLocation();
      if (loc) setDraft((d) => ({ ...d, fileLocation: loc.path, fileUrl: loc.url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google Drive didn't open.");
    }
  }

  async function save() {
    if (!draft.customerName.trim()) return setError("Add the customer name.");
    setSaving(true);
    setError(null);
    const matched = customers.find((c) => c.name.toLowerCase() === draft.customerName.trim().toLowerCase());
    const fields = { ...fromDraft(draft), customerId: matched?.id };
    try {
      let res: Response;
      if (isNew) {
        const fd = new FormData();
        fd.append("fields", JSON.stringify(fields));
        files.forEach((f) => fd.append("photo", f));
        res = await fetch("/api/admin/sewouts", { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/admin/sewouts/${record!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save");
      onSaved(data.record);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg bg-admin-card border border-admin-ink/20 px-3 py-2 text-sm text-admin-ink placeholder:text-admin-ink/40 focus:outline-none focus:border-admin-ink/60";
  const label = "block text-xs font-medium text-admin-ink/70 mb-1";

  return (
    <Modal onClose={onCancel}>
      <div className="sticky top-0 bg-admin-bg/95 backdrop-blur px-4 py-3 border-b border-admin-ink/15 flex items-center justify-between z-10">
        <h2 className="text-base font-bold">{isNew ? "Add a sew-out" : "Edit sew-out"}</h2>
        <button onClick={onCancel} className="text-sm text-admin-ink/70 hover:text-admin-ink px-2 py-1">✕</button>
      </div>
      <div className="p-4 space-y-4">
        {isNew && (
          <div>
            <span className={label}>Photo of the sew-out</span>
            <div className="flex gap-2 flex-wrap">
              {previews.map((u, i) => (
                <div key={u} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="w-24 h-24 rounded-lg object-cover bg-white" />
                  <button
                    onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px]"
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {files.length < 6 && (
                <label className="w-24 h-24 rounded-lg border-2 border-dashed border-admin-ink/30 flex flex-col items-center justify-center text-xs text-admin-ink/70 cursor-pointer hover:border-admin-ink/60 text-center px-1">
                  <span className="text-lg leading-none">📷</span>
                  {files.length ? "Add another" : "Take / choose photo"}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
            <p className="mt-1.5 text-xs text-admin-ink/60">
              {autofill === "working" && "Reading the sew-out…"}
              {autofill === "done" && "Filled in what I could read — check it before saving."}
              {autofill === "failed" && "Couldn't read the photo — fill in the details below."}
              {autofill === "off" && "Auto-fill isn't turned on yet — fill in the details below."}
              {autofill === "idle" && "Tip: put a ruler or a note with the stitch count in the shot."}
            </p>
          </div>
        )}

        <div>
          <label className={label} htmlFor="sw-customer">Customer *</label>
          <input id="sw-customer" list="sw-customers" className={input} value={draft.customerName} onChange={(e) => set("customerName", e.target.value)} placeholder="Start typing a customer…" />
          <datalist id="sw-customers">
            {customers.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label} htmlFor="sw-design">Design name</label>
          <input id="sw-design" className={input} value={draft.designName} onChange={(e) => set("designName", e.target.value)} placeholder="e.g. Left chest logo" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={label} htmlFor="sw-stitch">Stitches</label>
            <input id="sw-stitch" inputMode="numeric" className={input} value={draft.stitchCount} onChange={(e) => set("stitchCount", e.target.value)} placeholder="14,500" />
          </div>
          <div>
            <label className={label} htmlFor="sw-w">Width (in)</label>
            <input id="sw-w" inputMode="decimal" className={input} value={draft.widthIn} onChange={(e) => set("widthIn", e.target.value)} placeholder="3.5" />
          </div>
          <div>
            <label className={label} htmlFor="sw-h">Height (in)</label>
            <input id="sw-h" inputMode="decimal" className={input} value={draft.heightIn} onChange={(e) => set("heightIn", e.target.value)} placeholder="2" />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="sw-place">Placement</label>
          <input id="sw-place" list="sw-placements" className={input} value={draft.placement} onChange={(e) => set("placement", e.target.value)} placeholder="Left chest" />
          <datalist id="sw-placements">
            {PLACEMENTS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label} htmlFor="sw-threads">Thread colors</label>
          <input id="sw-threads" className={input} value={draft.threadColors} onChange={(e) => set("threadColors", e.target.value)} placeholder="Navy 1967, White 1001" />
        </div>
        <div>
          <span className={label}>Stitch file (Google Drive)</span>
          <div className="flex gap-2">
            <input className={input} value={draft.fileLocation} onChange={(e) => set("fileLocation", e.target.value)} placeholder="My Drive/Embroidery/…" />
            <button type="button" onClick={pickFromDrive} className="shrink-0 px-3 rounded-lg border border-admin-ink/25 text-sm flex items-center gap-1.5 hover:border-admin-ink/60">
              <DriveIcon /> Drive
            </button>
          </div>
        </div>
        <div>
          <label className={label} htmlFor="sw-tags">Extra search words</label>
          <input id="sw-tags" className={input} value={draft.tags} onChange={(e) => set("tags", e.target.value)} placeholder="bbq, pig, red" />
        </div>
        <div>
          <label className={label} htmlFor="sw-notes">Notes</label>
          <textarea id="sw-notes" rows={3} className={input} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Needle order, backing, hoop size…" />
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
      <div className="sticky bottom-0 bg-admin-bg/95 backdrop-blur px-4 py-3 border-t border-admin-ink/15 flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-admin-ink/25 text-sm">Cancel</button>
        <button
          onClick={save}
          disabled={saving || autofill === "working"}
          className="px-5 py-2 rounded-xl bg-admin-accent text-admin-accent-ink font-semibold text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Save sew-out" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
