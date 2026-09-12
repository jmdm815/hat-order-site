"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SetupChargeType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";

type Draft = { label: string; price: number };

const BLANK_DRAFT: Draft = { label: "", price: 0 };

// Full CRUD admin editor for the flat, named setup/digitization charges used
// by the admin quote builder (e.g. "Digitizing for embroidery" — $35). These
// are independent of decoration types — a quote picks zero or more of them
// directly rather than one being derived automatically from the decoration
// chosen for a line. See lib/setup-charges-store.ts.
export default function AdminSetupChargesManager() {
  const router = useRouter();
  const [charges, setCharges] = useState<SetupChargeType[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(BLANK_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/setup-charges")
      .then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        return r.json();
      })
      .then((data: { setupCharges: SetupChargeType[]; persistent: boolean }) => {
        setCharges(data.setupCharges);
        setDrafts(
          Object.fromEntries(data.setupCharges.map((c) => [c.id, { label: c.label, price: c.price }]))
        );
        setPersistent(data.persistent);
      })
      .catch(() => router.refresh())
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleSaveExisting(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/setup-charges", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMessage(data.persisted ? "Saved." : "Saved for now — no durable storage connected, see note above.");
      setOpenId(null);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/setup-charges?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setOpenId(null);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    setSavingId("__new__");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/setup-charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      setCreating(false);
      setNewDraft(BLANK_DRAFT);
      setMessage(data.persisted ? "Added." : "Added for now — no durable storage connected, see note above.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so changes
          only last until the next cold start or redeploy. Connect a Vercel
          Blob store to this project (Vercel dashboard → Storage → Create
          Database → Blob → Connect to Project) to make changes stick.
        </p>
      )}

      <div className="space-y-2">
        {charges.map((c) => {
          const draft = drafts[c.id] ?? { label: c.label, price: c.price };
          const isOpen = openId === c.id;
          return (
            <div key={c.id} className="border border-navy/10 rounded-xl bg-white overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <div className="font-semibold text-navy">{c.label}</div>
                  <div className="text-xs text-navy/50 mt-0.5">{formatUSD(c.price)}</div>
                </div>
                <button
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                  className="text-sm text-navy/70 px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  {isOpen ? "Close" : "Edit"}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${c.label}"?`)) handleDelete(c.id);
                  }}
                  disabled={savingId === c.id}
                  className="text-sm text-red-600 px-2 hover:underline disabled:text-navy/20"
                >
                  Delete
                </button>
              </div>

              {isOpen && (
                <div className="p-4 border-t border-navy/10 bg-navy/[0.02]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
                    <label className="text-sm text-navy/70">
                      Label
                      <input
                        type="text"
                        value={draft.label}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [c.id]: { ...draft, label: e.target.value } }))
                        }
                        className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="text-sm text-navy/70">
                      Price ($)
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.price}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [c.id]: { ...draft, price: Math.max(0, Number(e.target.value) || 0) },
                          }))
                        }
                        className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => handleSaveExisting(c.id)}
                      disabled={savingId === c.id || !draft.label.trim()}
                      className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
                    >
                      {savingId === c.id ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 border border-dashed border-navy/20 rounded-xl">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="w-full p-4 text-sm font-medium text-navy/70 hover:bg-navy/5 rounded-xl"
          >
            + Add a setup charge
          </button>
        ) : (
          <div className="p-4">
            <h3 className="font-semibold text-navy">New setup charge</h3>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
              <label className="text-sm text-navy/70">
                Label
                <input
                  type="text"
                  value={newDraft.label}
                  onChange={(e) => setNewDraft((prev) => ({ ...prev, label: e.target.value }))}
                  placeholder="e.g. Digitizing for embroidery"
                  className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm text-navy/70">
                Price ($)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={newDraft.price}
                  onChange={(e) =>
                    setNewDraft((prev) => ({ ...prev, price: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  className="mt-1 w-full border border-navy/20 rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={savingId === "__new__" || !newDraft.label.trim()}
                className="px-5 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition disabled:bg-navy/20"
              >
                {savingId === "__new__" ? "Adding…" : "Add setup charge"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewDraft(BLANK_DRAFT);
                }}
                className="px-4 py-2 rounded-full border border-navy/20 text-sm font-medium hover:bg-navy/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {message && <p className="mt-4 text-sm text-navy/70">{message}</p>}
    </div>
  );
}
