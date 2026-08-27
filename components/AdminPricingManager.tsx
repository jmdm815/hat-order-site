"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DecorationOption, DecorationType } from "@/lib/types";
import { formatUSD } from "@/lib/pricing";
import type { DesignerSettings } from "@/lib/pricing-store";

type PriceTier = { minQty: number; pricePerUnit: number };
type DecorationPricing = { setupFee: number; pricingTiers: PriceTier[] };
type PricingState = Partial<Record<DecorationType, DecorationPricing>>;

type ApiResponse = {
  decorations: DecorationOption[];
  overrides: PricingState;
  designerSettings: DesignerSettings;
  persistent: boolean;
};

function clonePricing(decorations: DecorationOption[]): PricingState {
  const state: PricingState = {};
  for (const d of decorations) {
    state[d.id] = {
      setupFee: d.setupFee,
      pricingTiers: d.pricingTiers.map((t) => ({ ...t })),
    };
  }
  return state;
}

// section="pricing" (default) renders the decoration setup-fee/quantity-tier
// editor. section="settings" renders the site-wide live-designer on/off
// switches instead — same underlying admin endpoint (/api/admin/pricing;
// see its comment for why), kept as two views of one component rather than
// a second file/tab component.
export default function AdminPricingManager({
  section = "pricing",
}: {
  section?: "pricing" | "settings";
}) {
  const router = useRouter();
  const [decorations, setDecorations] = useState<DecorationOption[]>([]);
  const [pricing, setPricing] = useState<PricingState>({});
  const [savedPricing, setSavedPricing] = useState<PricingState>({});
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
        setDecorations(data.decorations);
        const initial = clonePricing(data.decorations);
        setPricing(initial);
        setSavedPricing(initial);
        setDesignerSettings(data.designerSettings);
        setSavedDesignerSettings(data.designerSettings);
        setPersistent(data.persistent);
      })
      .catch(() => router.refresh())
      .finally(() => setLoading(false));
  }, [router]);

  const pricingDirty = useMemo(
    () => JSON.stringify(pricing) !== JSON.stringify(savedPricing),
    [pricing, savedPricing]
  );
  const settingsDirty = useMemo(
    () => JSON.stringify(designerSettings) !== JSON.stringify(savedDesignerSettings),
    [designerSettings, savedDesignerSettings]
  );
  const dirty = section === "settings" ? settingsDirty : pricingDirty;

  function updateSetupFee(id: DecorationType, setupFee: number) {
    setPricing((prev) => ({
      ...prev,
      [id]: { ...(prev[id] as DecorationPricing), setupFee },
    }));
  }

  function updateTier(id: DecorationType, index: number, field: keyof PriceTier, value: number) {
    setPricing((prev) => {
      const current = prev[id] as DecorationPricing;
      const pricingTiers = current.pricingTiers.map((t, i) =>
        i === index ? { ...t, [field]: value } : t
      );
      return { ...prev, [id]: { ...current, pricingTiers } };
    });
  }

  function addTier(id: DecorationType) {
    setPricing((prev) => {
      const current = prev[id] as DecorationPricing;
      const lastTier = current.pricingTiers[current.pricingTiers.length - 1];
      const nextMinQty = lastTier ? lastTier.minQty + 12 : 1;
      return {
        ...prev,
        [id]: {
          ...current,
          pricingTiers: [
            ...current.pricingTiers,
            { minQty: nextMinQty, pricePerUnit: lastTier?.pricePerUnit ?? 0 },
          ],
        },
      };
    });
  }

  function removeTier(id: DecorationType, index: number) {
    setPricing((prev) => {
      const current = prev[id] as DecorationPricing;
      return {
        ...prev,
        [id]: {
          ...current,
          pricingTiers: current.pricingTiers.filter((_, i) => i !== index),
        },
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const body: { overrides?: PricingState; designerSettings?: DesignerSettings } = {};
      if (section === "settings") {
        body.designerSettings = designerSettings ?? undefined;
      } else {
        // Sort tiers by minQty ascending on save so the price-break display
        // (and the low-to-high quantity lookup in lib/decorations.ts) stays
        // correct regardless of the order they were edited in.
        const overrides: PricingState = {};
        for (const [id, value] of Object.entries(pricing)) {
          overrides[id as DecorationType] = {
            setupFee: (value as DecorationPricing).setupFee,
            pricingTiers: [...(value as DecorationPricing).pricingTiers].sort(
              (a, b) => a.minQty - b.minQty
            ),
          };
        }
        body.overrides = overrides;
      }
      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      if (section === "settings" && designerSettings) {
        setSavedDesignerSettings(designerSettings);
      } else if (body.overrides) {
        setPricing(body.overrides);
        setSavedPricing(body.overrides);
      }
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

  if (loading || (section === "settings" && !designerSettings)) {
    return <p className="text-navy/40 text-sm">Loading…</p>;
  }

  if (section === "settings" && designerSettings) {
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

  return (
    <div>
      {!persistent && (
        <p className="mb-4 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No durable storage is connected to this deployment yet, so pricing
          changes only last until the next cold start or redeploy. Connect a
          Vercel Blob store to this project (Vercel dashboard → Storage →
          Create Database → Blob → Connect to Project) to make changes stick.
        </p>
      )}

      <div className="space-y-6">
        {decorations.map((d) => {
          const current = pricing[d.id];
          if (!current) return null;
          return (
            <div key={d.id} className="border border-navy/10 rounded-xl bg-white p-5">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-semibold text-navy">{d.shortLabel}</h3>
                <span className="text-xs text-navy/40">{d.label}</span>
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm text-navy/70 max-w-xs">
                <span className="whitespace-nowrap">Setup / digitization fee ($)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={current.setupFee}
                  onChange={(e) =>
                    updateSetupFee(d.id, Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm ml-auto"
                />
              </label>

              <div className="mt-4">
                <div className="text-xs font-medium text-navy/60 uppercase tracking-wide">
                  Quantity price breaks
                </div>
                <p className="mt-1 text-xs text-navy/50">
                  Each row is a price tier — the quantity a customer needs to
                  hit that row&apos;s per-unit price (e.g. 1, 12, 24, 48).
                  Rows are applied low-to-high, so a customer pays the rate
                  for the highest tier they qualify for.
                </p>
                <div className="mt-3 space-y-2">
                  {current.pricingTiers.map((tier, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-navy/60">
                        Qty ≥
                        <input
                          type="number"
                          min={1}
                          value={tier.minQty}
                          onChange={(e) =>
                            updateTier(
                              d.id,
                              i,
                              "minQty",
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="w-20 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-navy/60">
                        $/unit
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={tier.pricePerUnit}
                          onChange={(e) =>
                            updateTier(
                              d.id,
                              i,
                              "pricePerUnit",
                              Math.max(0, Number(e.target.value) || 0)
                            )
                          }
                          className="w-24 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                        />
                      </label>
                      <span className="text-xs text-navy/40">
                        {formatUSD(tier.pricePerUnit)}/hat at {tier.minQty}+
                      </span>
                      <button
                        onClick={() => removeTier(d.id, i)}
                        disabled={current.pricingTiers.length <= 1}
                        className="ml-auto text-xs text-red-600 hover:underline disabled:text-navy/20 disabled:no-underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => addTier(d.id)}
                  className="mt-3 text-sm px-3 py-1.5 rounded-lg border border-navy/20 hover:bg-navy/5"
                >
                  + Add tier
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-5 py-2 rounded-full bg-red text-white font-semibold hover:bg-navy transition disabled:bg-navy/20"
        >
          {saving ? "Saving…" : dirty ? "Save pricing" : "Saved"}
        </button>
        {saveMessage && <p className="text-sm text-navy/70">{saveMessage}</p>}
      </div>
    </div>
  );
}
