"use client";

import { useState } from "react";
import AdminCatalogManager from "@/components/AdminCatalogManager";
import AdminPricingManager from "@/components/AdminPricingManager";

const TABS = [
  { id: "catalog", label: "Catalog" },
  { id: "pricing", label: "Pricing" },
  { id: "settings", label: "Settings" },
] as const;

export default function AdminDashboard() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("catalog");

  return (
    <div>
      <div className="flex gap-1 border-b border-navy/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t.id
                ? "border-red text-navy"
                : "border-transparent text-navy/50 hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "catalog" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
              Check or uncheck styles to control what shows up in the
              customer-facing catalog. Everything is visible by default. Use
              &quot;Configure decorations&quot; on any item to choose which
              decoration types it offers and draw its placement zones.
            </p>
            <AdminCatalogManager />
          </>
        )}
        {tab === "pricing" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
              Set your setup fee and quantity price breaks for each
              decoration type. These prices are what customers see on{" "}
              <code className="font-mono">/customize</code>.
            </p>
            <AdminPricingManager />
          </>
        )}
        {tab === "settings" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
              Turn the live drag/resize design canvas on or off for hats and
              for shirts, site-wide. Individual items can still override this.
            </p>
            <AdminPricingManager section="settings" />
          </>
        )}
      </div>
    </div>
  );
}
