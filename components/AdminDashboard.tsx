"use client";

import { useState } from "react";
import AdminCatalogManager from "@/components/AdminCatalogManager";
import AdminCategoriesManager from "@/components/AdminCategoriesManager";
import AdminPricingManager from "@/components/AdminPricingManager";
import AdminDecorationTypesManager from "@/components/AdminDecorationTypesManager";
import AdminMockupGeneratorManager from "@/components/AdminMockupGeneratorManager";
import AdminQuotesTab from "@/components/AdminQuotesTab";
import AdminSetupChargesManager from "@/components/AdminSetupChargesManager";
import AdminGarmentMarkupManager from "@/components/AdminGarmentMarkupManager";

const TABS = [
  { id: "categories", label: "Categories" },
  { id: "catalog", label: "Catalog" },
  { id: "pricing", label: "Pricing" },
  { id: "settings", label: "Settings" },
  { id: "quotes", label: "Quotes" },
  { id: "setup-charges", label: "Setup Charges" },
  { id: "garment-markup", label: "Garment Markup" },
  { id: "mockup-generator", label: "Mockup Generator" },
] as const;

export default function AdminDashboard() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("categories");

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
        {tab === "categories" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
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
            <p className="mb-4 text-navy/60 text-sm">
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
            <p className="mb-4 text-navy/60 text-sm">
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
            <p className="mb-4 text-navy/60 text-sm">
              Turn the live drag/resize design canvas on or off for hats and
              for shirts, site-wide. Individual items can still override this.
            </p>
            <AdminPricingManager />
          </>
        )}
        {tab === "quotes" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
              Build a customer quote from live SanMar pricing plus your decoration pricing chart
              (quantity price-breaks apply across the whole quote), save it, and download it as a
              PDF. Saved quotes can be reopened, edited, and converted to invoices below. Nothing
              here touches the customer-facing catalog or cart.
            </p>
            <AdminQuotesTab />
          </>
        )}
        {tab === "setup-charges" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
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
            <p className="mb-4 text-navy/60 text-sm">
              Set cost-based markup breakpoints for blank garments used in the Quote Builder — a
              garment&apos;s vendor cost determines which breakpoint&apos;s percentage gets added
              on top before decoration cost. Doesn&apos;t affect the customer-facing catalog or
              cart, which always sells garments at raw vendor cost.
            </p>
            <AdminGarmentMarkupManager />
          </>
        )}
        {tab === "mockup-generator" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
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
