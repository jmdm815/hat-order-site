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
import AdminCustomersManager from "@/components/AdminCustomersManager";

const TABS = [
  { id: "categories", label: "Categories" },
  { id: "catalog", label: "Catalog" },
  { id: "pricing", label: "Pricing" },
  { id: "settings", label: "Settings" },
  { id: "quotes", label: "Quotes" },
  { id: "customers", label: "Customers" },
  { id: "setup-charges", label: "Setup Charges" },
  { id: "garment-markup", label: "Garment Markup" },
  { id: "mockup-generator", label: "Mockup Generator" },
] as const;

export default function AdminDashboard() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("categories");

  return (
    <div>
      <div className="relative -mx-4 sm:mx-0">
        <div className="flex overflow-x-auto no-scrollbar border-b-2 border-navy/15 px-4 sm:px-0">
          {TABS.map((t, i) => (
            <div key={t.id} className="flex items-center shrink-0">
              {i > 0 && <span className="h-4 w-px bg-navy/15 shrink-0" aria-hidden />}
              <button
                onClick={() => setTab(t.id)}
                className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-[3px] -mb-0.5 transition ${
                  tab === t.id
                    ? "border-red text-navy bg-navy/[0.04] rounded-t-lg"
                    : "border-transparent text-navy/50 hover:text-navy hover:bg-navy/[0.02] rounded-t-lg"
                }`}
              >
                {t.label}
              </button>
            </div>
          ))}
        </div>
        {/* fade hint that there's more tabs to scroll to on mobile */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0.5 w-8 bg-gradient-to-l from-cream to-transparent sm:hidden" />
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
        {tab === "customers" && (
          <>
            <p className="mb-4 text-navy/60 text-sm">
              A simple contact list — add a customer&apos;s name, company, email, phone, and notes
              once, then look them up here later. Not tied to checkout accounts or any specific
              order.
            </p>
            <AdminCustomersManager />
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
