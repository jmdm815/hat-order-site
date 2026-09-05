"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DesignerSettings } from "@/lib/pricing-store";

type ApiResponse = {
  designerSettings: DesignerSettings;
  persistent: boolean;
};

// Site-wide live-designer on/off switches (admin Settings tab). Decoration
// type pricing used to live in this same component (a "pricing" section) —
// it's now handled by AdminDecorationTypesManager as part of full
// decoration-type CRUD, so this component is settings-only.
export default function AdminPricingManager() {
  const router = useRouter();
  const [designerSettings, setDesignerSettings] = useState<DesignerSettings | null>(null);
  const [savedDesignerSettings, setSavedDesignerSettings] = useState<DesignerSettings | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/pricing")
      .then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        return r.json();
      })
      .then((data: ApiResponse) => {
        setDesignerSettings(data.designerSettings);
        setSavedDesignerSettings(data.designerSettings);
        setPersistent(data.persistent);
      })
      .catch(() => router.refresh())
      .finally(() => setLoading(false));
  }, [router]);

  const dirty = JSON.stringify(designerSettings) !== JSON.stringify(savedDesignerSettings);

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designerSettings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      if (designerSettings) setSavedDesignerSettings(designerSettings);
      setSaveMessage(
        data.persisted
          ? "Saved."
          : "Saved for now, but this deployment has no durable storage connected — changes will reset on redeploy. See the note above."
      );
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !designerSettings) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so these
          settings only last until the next cold start or redeploy.
        </p>
      )}

      <div className="space-y-4 max-w-md">
        {(
          [
            { key: "hatsEnabled", label: "Live designer for hats" },
            { key: "shirtsEnabled", label: "Live designer for shirts" },
            { key: "tumblersEnabled", label: "Live designer for tumblers" },
            { key: "polosEnabled", label: "Live designer for polos" },
          ] as const
        ).map((row) => (
          <label
            key={row.key}
            className="flex items-center justify-between gap-4 border border-navy/10 rounded-xl bg-white p-4"
          >
            <span>
              <span className="font-medium text-navy">{row.label}</span>
              <span className="block text-xs text-navy/50 mt-0.5">
                When off, customers get a simple form (pick a placement,
                upload a file) instead of the drag/resize live preview canvas.
              </span>
            </span>
            <input
              type="checkbox"
              checked={designerSettings[row.key]}
              onChange={(e) =>
                setDesignerSettings({ ...designerSettings, [row.key]: e.target.checked })
              }
              className="w-5 h-5 shrink-0"
            />
          </label>
        ))}
      </div>

      <p className="mt-4 text-xs text-navy/50 max-w-md">
        Individual items can override this — see the &quot;Live
        designer&quot; control inside &quot;Configure decorations&quot; on
        any item in the Catalog tab.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-5 py-2 rounded-full bg-red text-white font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {saving ? "Saving…" : dirty ? "Save settings" : "Saved"}
        </button>
        {saveMessage && <p className="text-sm text-navy/70">{saveMessage}</p>}
      </div>
    </div>
  );
}
