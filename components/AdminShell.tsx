"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Admin layout: one grouped left sidebar shared by every admin page
// (dashboard sections live at /admin?tab=…, standalone tools at their own
// routes), a slide-out drawer on phones, and a light content area.
// Section names honor the saved renames from /api/admin/tabs.
// ---------------------------------------------------------------------------

type Item = { id: string; label: string; href: string; icon: keyof typeof ICONS };
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Sales",
    items: [
      { id: "quotes", label: "Quotes", href: "/admin?tab=quotes", icon: "file" },
      { id: "invoices", label: "Invoices", href: "/admin?tab=invoices", icon: "receipt" },
      { id: "customers", label: "Customers", href: "/admin?tab=customers", icon: "users" },
      { id: "quick-quote", label: "Quick Quote", href: "/admin?tab=quick-quote", icon: "bolt" },
    ],
  },
  {
    title: "Production",
    items: [
      { id: "jobs", label: "Jobs", href: "/admin?tab=jobs", icon: "briefcase" },
      { id: "tasks", label: "Tasks", href: "/admin?tab=tasks", icon: "check" },
      { id: "sanmar-order", label: "SanMar Order", href: "/admin/sanmar-order", icon: "truck" },
      { id: "sewouts", label: "Sewout Library", href: "/admin/sewouts", icon: "thread" },
    ],
  },
  {
    title: "Marketing",
    items: [
      { id: "social", label: "Social Studio", href: "/admin/social", icon: "spark" },
      { id: "garment-mockup", label: "Garment Mockups", href: "/admin?tab=garment-mockup", icon: "shirt" },
      { id: "mockup-generator", label: "Mockup Generator", href: "/admin?tab=mockup-generator", icon: "image" },
    ],
  },
  {
    title: "Store & Pricing",
    items: [
      { id: "catalog", label: "Catalog", href: "/admin?tab=catalog", icon: "tag" },
      { id: "categories", label: "Categories", href: "/admin?tab=categories", icon: "grid" },
      { id: "pricing", label: "Decoration Pricing", href: "/admin?tab=pricing", icon: "dollar" },
      { id: "setup-charges", label: "Setup Charges", href: "/admin?tab=setup-charges", icon: "list" },
      { id: "garment-markup", label: "Garment Markup", href: "/admin?tab=garment-markup", icon: "trend" },
      { id: "settings", label: "Settings", href: "/admin?tab=settings", icon: "gear" },
    ],
  },
];

const ICONS = {
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  briefcase: "M4 7h16v12H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16",
  check: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  thread: "M7 3h10M7 21h10M8 3v18M16 3v18M8 8l8 3M8 13l8 3",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  shirt: "M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8a.5.5 0 1 0 0-.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  dollar: "M12 2v20M17 6.5C17 4.6 14.8 4 12 4S7 5 7 7.5 9.5 10.5 12 11s5 1.4 5 4-2.2 3.5-5 3.5-5-.8-5-2.5",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6 6 18",
} as const;

function Icon({ name, className = "w-[18px] h-[18px]" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export const ADMIN_SECTION_LABELS: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))
);

function Nav({ active, labels, onNavigate }: { active?: string; labels: Record<string, string>; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-admin-ink/50">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const on = it.id === active;
              return (
                <li key={it.id}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-3 px-3 py-[7px] rounded-lg text-[15px] transition-colors ${
                      on
                        ? "bg-admin-accent text-admin-accent-ink font-semibold"
                        : "text-admin-ink/80 hover:bg-admin-ink/[0.06] hover:text-admin-ink"
                    }`}
                  >
                    <Icon name={it.icon} />
                    <span className="truncate">{labels[it.id] ?? it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function AdminShell({ active, children }: { active?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/tabs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { overrides?: Record<string, { label: string }> } | null) => {
        if (!d?.overrides) return;
        setLabels(Object.fromEntries(Object.entries(d.overrides).map(([k, v]) => [k, v.label])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const brand = (
    <Link href="/admin?tab=quotes" className="flex items-center gap-2.5 min-w-0">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-admin-accent text-admin-accent-ink text-sm font-bold shrink-0">JM</span>
      <span className="leading-tight min-w-0">
        <span className="block text-[15px] font-bold text-admin-ink truncate">JM Digital Media</span>
        <span className="block text-xs text-admin-ink/55">Admin</span>
      </span>
    </Link>
  );
  const footer = (
    <div className="border-t border-admin-ink/10 px-3 py-3">
      <Link href="/" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-admin-ink/70 hover:bg-admin-ink/[0.06] hover:text-admin-ink">
        <Icon name="external" />
        View storefront
      </Link>
    </div>
  );

  return (
    <div className="flex-1 flex min-h-screen bg-admin-bg">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-admin-card border-r border-admin-ink/10 sticky top-0 h-screen">
        <div className="px-5 h-16 flex items-center border-b border-admin-ink/10">{brand}</div>
        <Nav active={active} labels={labels} />
        {footer}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-admin-card flex flex-col shadow-xl pt-safe">
            <div className="px-4 h-16 flex items-center justify-between border-b border-admin-ink/10">
              {brand}
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg text-admin-ink/70 hover:bg-admin-ink/[0.06]" aria-label="Close menu">
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
            <Nav active={active} labels={labels} onNavigate={() => setOpen(false)} />
            {footer}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-40 bg-admin-card border-b border-admin-ink/10 pt-safe">
          <div className="h-14 px-3 flex items-center gap-2">
            <button onClick={() => setOpen(true)} className="p-2 rounded-lg text-admin-ink hover:bg-admin-ink/[0.06]" aria-label="Open menu">
              <Icon name="menu" className="w-6 h-6" />
            </button>
            <span className="font-semibold text-admin-ink truncate">{(active && (labels[active] ?? ADMIN_SECTION_LABELS[active])) || "Admin"}</span>
          </div>
        </header>
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

/** Page title + one-line description used at the top of each admin section. */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] font-bold text-admin-ink leading-tight">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-admin-ink/65 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
