"use client";

import { useRouter, useSearchParams } from "next/navigation";
import AdminCatalogManager from "@/components/AdminCatalogManager";
import AdminCatalogTabs from "@/components/AdminCatalogTabs";
import AdminCategoriesManager from "@/components/AdminCategoriesManager";
import AdminPricingManager from "@/components/AdminPricingManager";
import AdminDecorationTypesManager from "@/components/AdminDecorationTypesManager";
import AdminMockupGeneratorManager from "@/components/AdminMockupGeneratorManager";
import GarmentMockupTool from "@/components/GarmentMockupTool";
import AdminQuotesTab from "@/components/AdminQuotesTab";
import AdminJobsTab from "@/components/AdminJobsTab";
import AdminTasksTab from "@/components/AdminTasksTab";
import AdminQuickQuoteTab from "@/components/AdminQuickQuoteTab";
import AdminSetupChargesManager from "@/components/AdminSetupChargesManager";
import AdminGarmentMarkupManager from "@/components/AdminGarmentMarkupManager";
import AdminCustomersManager from "@/components/AdminCustomersManager";
import AdminLogoManager from "@/components/AdminLogoManager";

import AdminShell, { AdminPageHeader, ADMIN_SECTION_LABELS } from "@/components/AdminShell";

// Dashboard sections, picked from the sidebar (components/AdminShell.tsx)
// via ?tab=…. Quotes is the landing section.
const TAB_IDS = [
  "categories", "catalog", "pricing", "settings", "quick-quote", "quotes", "invoices", "jobs",
  "tasks", "customers", "setup-charges", "garment-markup", "mockup-generator", "garment-mockup",
] as const;
type TabId = (typeof TAB_IDS)[number];

const DESCRIPTIONS: Record<TabId, string> = {
  categories: "The sections on the storefront homepage. Assign products to them from the Catalog.",
  catalog: "Choose which styles customers see, and set each item's decorations and placement zones.",
  pricing: "Decoration types customers can pick (embroidery, screen print, patches…) and their prices.",
  settings: "Logo and site-wide design canvas settings.",
  "quick-quote": "Fast price check for a walk-in or phone call. Turn it into a real quote with one tap.",
  quotes: "Build, send and track quotes. Converting one creates a linked invoice.",
  invoices: "Invoices, payments and balances.",
  jobs: "Orders in production.",
  tasks: "Your to-do list.",
  customers: "Your customer list. Click a name to see their quotes, invoices and payments.",
  "setup-charges": "One-time charges (digitizing, screens, vectorizing…) you can add to quotes.",
  "garment-markup": "Markup added to blank garment cost, by cost range.",
  "mockup-generator": "Patch materials, shapes and settings for the custom hat mockup generator.",
  "garment-mockup": "Put a logo on a blank garment for a customer proof.",
};

// sessionStorage key used to carry Quick Quote's lines/setup charges over to
// a brand-new quote page — see the Quick Quote tab's onCreateQuote below and
// components/AdminQuotePageClient.tsx, which reads and clears it on mount.
const QUICK_QUOTE_SEED_KEY = "admin-quote-seed";

export default function AdminDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get("tab");
  const tab: TabId = (param && (TAB_IDS as readonly string[]).includes(param) ? param : "quotes") as TabId;

  return (
    <AdminShell active={tab}>
      <AdminPageHeader title={ADMIN_SECTION_LABELS[tab] ?? "Admin"} description={DESCRIPTIONS[tab]} />
      <div>
        {tab === "categories" && (
          <>
            <AdminCategoriesManager />
          </>
        )}
        {tab === "catalog" && (
          <>
            <AdminCatalogTabs />
            <AdminCatalogManager />
          </>
        )}
        {tab === "pricing" && (
          <>
            <AdminDecorationTypesManager />
          </>
        )}
        {tab === "settings" && (
          <>
            <AdminLogoManager />
            <AdminPricingManager />
          </>
        )}
        {tab === "quick-quote" && (
          <>
            <AdminQuickQuoteTab
              onCreateQuote={(lines, setupChargeIds) => {
                try {
                  window.sessionStorage.setItem(
                    QUICK_QUOTE_SEED_KEY,
                    JSON.stringify({ lines, setupChargeIds })
                  );
                } catch {
                  // Private browsing / storage disabled — the new quote page
                  // just opens empty instead of pre-filled; not worth
                  // blocking navigation over.
                }
                router.push("/admin/quotes/new");
              }}
            />
          </>
        )}
        {tab === "quotes" && (
          <>
            <AdminQuotesTab kind="quote" />
          </>
        )}
        {tab === "invoices" && (
          <>
            <AdminQuotesTab kind="invoice" />
          </>
        )}
        {tab === "jobs" && <AdminJobsTab />}
        {tab === "tasks" && <AdminTasksTab />}
        {tab === "customers" && (
          <>
            <AdminCustomersManager />
          </>
        )}
        {tab === "setup-charges" && (
          <>
            <AdminSetupChargesManager />
          </>
        )}
        {tab === "garment-markup" && (
          <>
            <AdminGarmentMarkupManager />
          </>
        )}
        {tab === "mockup-generator" && (
          <>
            <AdminMockupGeneratorManager />
          </>
        )}
        {tab === "garment-mockup" && (
          <>
            <GarmentMockupTool />
          </>
        )}
      </div>
    </AdminShell>
  );
}
