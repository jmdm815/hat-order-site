"use client";

import { useEffect, useRef, useState } from "react";
import AdminCatalogManager from "@/components/AdminCatalogManager";
import AdminCategoriesManager from "@/components/AdminCategoriesManager";
import AdminPricingManager from "@/components/AdminPricingManager";
import AdminDecorationTypesManager from "@/components/AdminDecorationTypesManager";
import AdminMockupGeneratorManager from "@/components/AdminMockupGeneratorManager";
import AdminQuotesTab, { QuoteBuilderSeed } from "@/components/AdminQuotesTab";
import AdminQuickQuoteTab from "@/components/AdminQuickQuoteTab";
import AdminSetupChargesManager from "@/components/AdminSetupChargesManager";
import AdminGarmentMarkupManager from "@/components/AdminGarmentMarkupManager";
import AdminCustomersManager from "@/components/AdminCustomersManager";
import AdminLogoManager from "@/components/AdminLogoManager";

// Each tab's id and position are fixed in code; only its label and icon are
// admin-editable (see lib/admin-tabs-store.ts, app/api/admin/tabs/route.ts).
// `icon` is any short glyph/emoji — simplest way to let an admin pick or
// type their own without pulling in an icon library.
const DEFAULT_TABS = [
  { id: "categories", label: "Categories", icon: "🗂️" },
  { id: "catalog", label: "Catalog", icon: "🧢" },
  { id: "pricing", label: "Pricing", icon: "💲" },
  { id: "settings", label: "Settings", icon: "⚙️" },
  { id: "quick-quote", label: "Quick Quote", icon: "⚡" },
  { id: "quotes", label: "Quotes", icon: "📝" },
  { id: "customers", label: "Customers", icon: "👥" },
  { id: "setup-charges", label: "Setup Charges", icon: "🧾" },
  { id: "garment-markup", label: "Garment Markup", icon: "📈" },
  { id: "mockup-generator", label: "Mockup Generator", icon: "🎨" },
] as const;

type TabId = (typeof DEFAULT_TABS)[number]["id"];
type TabOverride = { label: string; icon: string };

// A grid of ready-made icon choices shown in the editor, in addition to the
// free-text field so an admin can also type/paste any emoji of their own.
const ICON_CHOICES = [
  "🗂️", "🧢", "💲", "⚙️", "⚡", "📝", "👥", "🧾", "📈", "🎨",
  "📦", "🚚", "💳", "🏷️", "📊", "🛒", "🖨️", "✉️", "📅", "🔔",
  "⭐", "🏠", "🔧", "📁", "🧵", "💬", "📋", "🔍", "🧮", "✅",
];

export default function AdminDashboard() {
  const [tab, setTab] = useState<TabId>("categories");
  const [quickQuoteSeed, setQuickQuoteSeed] = useState<QuoteBuilderSeed | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [overrides, setOverrides] = useState<Record<string, TabOverride>>({});
  const [editingId, setEditingId] = useState<TabId | null>(null);
  const [editDraft, setEditDraft] = useState<TabOverride>({ label: "", icon: "" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [tabsError, setTabsError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/tabs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { overrides: Record<string, TabOverride> } | null) => {
        if (data?.overrides) setOverrides(data.overrides);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const tabs = DEFAULT_TABS.map((t) => ({
    id: t.id,
    label: overrides[t.id]?.label ?? t.label,
    icon: overrides[t.id]?.icon ?? t.icon,
  }));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];

  function startEdit(t: (typeof tabs)[number]) {
    setEditingId(t.id);
    setEditDraft({ label: t.label, icon: t.icon });
    setTabsError(null);
  }

  async function saveEdit(id: TabId) {
    if (!editDraft.label.trim() || !editDraft.icon.trim()) {
      setTabsError("Both an icon and a name are required.");
      return;
    }
    setSavingId(id);
    setTabsError(null);
    try {
      const res = await fetch("/api/admin/tabs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, label: editDraft.label.trim(), icon: editDraft.icon.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setOverrides((prev) => ({ ...prev, [id]: { label: editDraft.label.trim(), icon: editDraft.icon.trim() } }));
      setEditingId(null);
    } catch (e) {
      setTabsError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function resetEdit(id: TabId) {
    setSavingId(id);
    setTabsError(null);
    try {
      const res = await fetch("/api/admin/tabs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reset: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reset failed");
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setEditingId(null);
    } catch (e) {
      setTabsError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      {/* ShopVox-style section menu: a single pill button showing the current
          section's icon + name, opening a dropdown that lists every section
          (each with its own icon) to jump to, plus a per-row editor to
          rename a section or change its icon. */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2.5 bg-black border border-white/15 shadow-lg shadow-black/30 rounded-full pl-3 pr-4 py-2 hover:bg-white/5 transition"
        >
          <span className="flex flex-col gap-[3px] w-4 shrink-0" aria-hidden>
            <span className="h-0.5 w-full bg-white/70 rounded-full" />
            <span className="h-0.5 w-full bg-white/70 rounded-full" />
            <span className="h-0.5 w-full bg-white/70 rounded-full" />
          </span>
          <span className="text-lg leading-none">{current.icon}</span>
          <span className="text-sm font-semibold text-white">{current.label}</span>
          <span className="text-white/40 text-xs">{menuOpen ? "▲" : "▼"}</span>
        </button>

        {menuOpen && (
          <div className="absolute z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-black border border-white/15 shadow-xl shadow-black/40 rounded-2xl p-2 max-h-[28rem] overflow-y-auto">
            {tabs.map((t) => {
              const isEditing = editingId === t.id;
              const busy = savingId === t.id;
              const hasOverride = Boolean(overrides[t.id]);

              if (isEditing) {
                return (
                  <div key={t.id} className="px-2 py-2.5 border-b border-white/5 last:border-b-0">
                    <div className="flex flex-col gap-2">
                      <div>
                        <p className="text-[11px] text-white/40 mb-1">Icon</p>
                        <div className="grid grid-cols-10 gap-1 mb-1.5">
                          {ICON_CHOICES.map((ic) => (
                            <button
                              key={ic}
                              type="button"
                              onClick={() => setEditDraft((d) => ({ ...d, icon: ic }))}
                              className={`text-base leading-none rounded-lg py-1 hover:bg-white/10 transition ${
                                editDraft.icon === ic ? "bg-red/20 ring-1 ring-red" : ""
                              }`}
                            >
                              {ic}
                            </button>
                          ))}
                        </div>
                        <input
                          value={editDraft.icon}
                          onChange={(e) => setEditDraft((d) => ({ ...d, icon: e.target.value }))}
                          placeholder="or type/paste any emoji"
                          maxLength={4}
                          className="w-24 border border-white/20 rounded-xl px-2 py-1 text-sm text-center"
                        />
                      </div>
                      <div>
                        <p className="text-[11px] text-white/40 mb-1">Name</p>
                        <input
                          value={editDraft.label}
                          onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                          className="w-full border border-white/20 rounded-xl px-2 py-1.5 text-sm"
                          placeholder="Tab name"
                          autoFocus
                        />
                      </div>
                      {tabsError && <p className="text-xs text-red-500">{tabsError}</p>}
                      <div className="flex items-center gap-3 pt-0.5">
                        <button
                          type="button"
                          onClick={() => saveEdit(t.id)}
                          disabled={busy}
                          className="text-xs font-semibold text-red hover:underline disabled:text-white/20"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-white/60 hover:underline"
                        >
                          Cancel
                        </button>
                        {hasOverride && (
                          <button
                            type="button"
                            onClick={() => resetEdit(t.id)}
                            disabled={busy}
                            className="text-xs text-white/40 hover:text-white hover:underline ml-auto"
                          >
                            Reset to default
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-white/5 border-b border-white/5 last:border-b-0 ${
                    t.id === tab ? "bg-white/[0.04]" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setTab(t.id);
                      setMenuOpen(false);
                    }}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <span className="text-lg leading-none shrink-0 w-6 text-center">{t.icon}</span>
                    <span className={`text-sm truncate ${t.id === tab ? "font-semibold text-white" : "text-white/80"}`}>
                      {t.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(t)}
                    className="text-xs text-white/40 hover:text-white hover:underline shrink-0 px-1"
                  >
                    Edit
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6">
        {tab === "categories" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Create and reorder the sections shown on the homepage catalog (Hats, Polos,
              Tumblers, or anything else) — more can be added any time. Assign products to a
              category from the Catalog tab&apos;s &quot;Configure decorations&quot; editor;
              only items assigned to at least one category show up on the homepage.
            </p>
            <AdminCategoriesManager />
          </>
        )}
        {tab === "catalog" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Check or uncheck styles to control what shows up in the
              customer-facing catalog. Everything is visible by default. Use
              &quot;Configure decorations&quot; on any item to choose which
              decoration types it offers and draw its placement zones, assign
              it to homepage categories, and turn Design Now / Get Quote on
              or off for it.
            </p>
            <AdminCatalogManager />
          </>
        )}
        {tab === "pricing" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Add, edit, or remove decoration types (UV Patch, Embroidered,
              Screen Print, or anything new) — their labels, hat/shirt
              availability, accepted file types, turnaround, and pricing.
              These are what customers see on{" "}
              <code className="font-mono">/customize</code>.
            </p>
            <AdminDecorationTypesManager />
          </>
        )}
        {tab === "settings" && (
          <>
            <AdminLogoManager />
            <p className="mt-8 mb-4 text-white/60 text-sm">
              Turn the live drag/resize design canvas on or off for hats and
              for shirts, site-wide. Individual items can still override this.
            </p>
            <AdminPricingManager />
          </>
        )}
        {tab === "quick-quote" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              A fast price check for a walk-in or phone call — pick a garment (and a decoration, if
              any — leave it as &quot;None&quot; for a blank item) straight from the catalog and see
              the price right away, with no customer info required. If they decide to order, tap
              &quot;Create quote&quot; to carry it into a real quote on the Quotes tab, where you can
              add their info and save it.
            </p>
            <AdminQuickQuoteTab
              onCreateQuote={(lines, setupChargeIds) => {
                setQuickQuoteSeed({ token: Date.now(), lines, setupChargeIds });
                setTab("quotes");
              }}
            />
          </>
        )}
        {tab === "quotes" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Build a customer quote from live SanMar pricing plus your decoration pricing chart
              (quantity price-breaks apply across the whole quote), save it, and download it as a
              PDF. Saved quotes can be reopened, edited, and converted to invoices below. Nothing
              here touches the customer-facing catalog or cart.
            </p>
            <AdminQuotesTab seed={quickQuoteSeed} onSeedConsumed={() => setQuickQuoteSeed(null)} />
          </>
        )}
        {tab === "customers" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              A simple contact list — add a customer&apos;s name, company, email, phone, and notes
              once, then look them up here later. Not tied to checkout accounts or any specific
              order.
            </p>
            <AdminCustomersManager />
          </>
        )}
        {tab === "setup-charges" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Manage the named, flat one-time setup charges (digitizing, logo
              vectorization, screen fees, etc.) available to pick when
              building a quote on the Quotes tab. These are independent of
              decoration types — a quote can include any combination of them.
            </p>
            <AdminSetupChargesManager />
          </>
        )}
        {tab === "garment-markup" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Set cost-based markup breakpoints for blank garments — a garment&apos;s vendor cost
              determines which breakpoint&apos;s percentage gets added before decoration cost.
              Used everywhere a customer or the Quote Builder sees a garment price: the catalog,
              the homepage, the live designer/cart, the quote tools, and quotes built here.
            </p>
            <AdminGarmentMarkupManager />
          </>
        )}
        {tab === "mockup-generator" && (
          <>
            <p className="mb-4 text-white/60 text-sm">
              Standalone custom hat mockup generator (separate from the
              regular order flow). Manage patch materials, shapes, sizes, and
              decoration-method / mockup rendering settings here. The
              customer-facing configurator and rendering engine come in a
              later phase.
            </p>
            <AdminMockupGeneratorManager />
          </>
        )}
      </div>
    </div>
  );
}
