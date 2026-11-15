"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useOrder } from "@/lib/order-context";
import type { ProductType } from "@/lib/types";

// Storefront navigation (Custom Ink style): a row of dropdowns on desktop,
// a full-screen accordion menu behind a hamburger on phones. Sections for
// product types the shop has hidden (Admin → Catalog → Catalog tabs) are
// left out, e.g. Drinkware while tumblers are hidden.

type MenuLink = { label: string; href: string };
type MenuSection = { label: string; type?: ProductType; links: MenuLink[] };

const cat = (type: ProductType, category?: string) =>
  `/catalog?type=${type}${category ? `&cat=${encodeURIComponent(category)}` : ""}`;

const SECTIONS: MenuSection[] = [
  {
    label: "Custom T-shirts",
    type: "shirt",
    links: [
      { label: "View All", href: cat("shirt") },
      { label: "Short Sleeve T-shirts", href: cat("shirt", "T-Shirt") },
      { label: "Long Sleeve T-shirts", href: cat("shirt", "Long Sleeve") },
      { label: "Tank Tops & Sleeveless", href: cat("shirt", "Tank") },
      { label: "Kids T-shirts", href: cat("shirt", "Youth Tee") },
    ],
  },
  {
    label: "Hats",
    type: "hat",
    links: [
      { label: "View All", href: cat("hat") },
      { label: "Trucker Hats", href: cat("hat", "Trucker") },
      { label: "Structured Hats", href: cat("hat", "Structured") },
      { label: "Unstructured Hats", href: cat("hat", "Unstructured") },
      { label: "Dad Hats", href: cat("hat", "Dad Hat") },
      { label: "Visors", href: cat("hat", "Visor") },
      { label: "Beanies", href: cat("hat", "Beanie") },
    ],
  },
  {
    label: "Apparel",
    links: [
      { label: "View All", href: "/catalog" },
      { label: "Polo Shirts", href: cat("polo") },
      { label: "Performance Polos", href: cat("polo", "Performance Polo") },
      { label: "Ladies Polos", href: cat("polo", "Ladies Polo") },
      { label: "Youth Polos", href: cat("polo", "Youth Polo") },
      { label: "Hats", href: cat("hat") },
      { label: "T-shirts", href: cat("shirt") },
    ],
  },
  {
    label: "Drinkware",
    type: "tumbler",
    links: [
      { label: "View All", href: cat("tumbler") },
      { label: "Tumblers", href: cat("tumbler", "Tumbler") },
    ],
  },
];

function useVisibleSections() {
  const [visible, setVisible] = useState<ProductType[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalog-tabs")
      .then((r) => r.json())
      .then((j: { visible?: ProductType[] }) => {
        if (!cancelled) setVisible(j.visible?.length ? j.visible : ["hat", "shirt", "polo", "tumbler"]);
      })
      .catch(() => !cancelled && setVisible(["hat", "shirt", "polo"]));
    return () => {
      cancelled = true;
    };
  }, []);
  // Until we know, hide only Drinkware (the one usually turned off).
  const types = visible ?? ["hat", "shirt", "polo"];
  return SECTIONS.filter((s) => !s.type || types.includes(s.type)).map((s) =>
    s.type
      ? s
      : // Apparel: drop links into hidden types (e.g. polos turned off)
        { ...s, links: s.links.filter((l) => !/type=(\w+)/.test(l.href) || types.includes(l.href.match(/type=(\w+)/)![1] as ProductType)) }
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition ${open ? "rotate-180" : ""}`} aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export function CartLink({ className = "" }: { className?: string }) {
  const { cart } = useOrder();
  const count = cart.length;
  return (
    <Link href="/cart" className={`relative inline-flex items-center gap-2 ${className}`} aria-label={`My cart${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
        <circle cx="10" cy="20" r="1.2" />
        <circle cx="17" cy="20" r="1.2" />
      </svg>
      <span className="hidden lg:inline">My Cart</span>
      {count > 0 && (
        <span className="absolute -top-1.5 left-3 min-w-[18px] h-[18px] px-1 rounded-full bg-red text-white text-[11px] font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </Link>
  );
}

/** Desktop: dropdown row. */
export function DesktopMenu() {
  const sections = useVisibleSections();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <nav ref={ref} className="hidden lg:flex items-center gap-1" aria-label="Shop">
      {sections.map((s) => (
        <div key={s.label} className="relative" onMouseEnter={() => setOpen(s.label)} onMouseLeave={() => setOpen(null)}>
          <button
            type="button"
            onClick={() => setOpen((o) => (o === s.label ? null : s.label))}
            aria-expanded={open === s.label}
            className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold transition ${
              open === s.label ? "bg-admin-ink/5 text-admin-ink" : "text-admin-ink/80 hover:text-admin-ink"
            }`}
          >
            {s.label}
            <Chevron open={open === s.label} />
          </button>
          {open === s.label && (
            <div className="absolute left-0 top-full pt-2 z-30">
              <ul className="min-w-[230px] rounded-xl border border-admin-ink/10 bg-admin-card p-2 shadow-xl shadow-slate-900/10">
                {s.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(null)}
                      className="block rounded-lg px-3 py-2 text-sm text-admin-ink/80 hover:bg-admin-ink/5 hover:text-admin-ink"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

/** Phone / tablet: hamburger + full-screen accordion menu. */
export function MobileMenu({ logoUrl }: { logoUrl: string }) {
  const sections = useVisibleSections();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pathname = usePathname();

  // Close when navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const row = "flex w-full items-center justify-between py-5 text-xl font-bold text-admin-ink";

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-admin-ink hover:bg-admin-ink/5"
        aria-label="Open menu"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-admin-card overflow-y-auto pt-safe pb-safe" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex items-center justify-between px-6 h-20">
            <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded logo URL */}
              <img src={logoUrl} alt="JM Digital Media" width={48} height={48} className="w-12 h-12 object-contain" />
              <span className="flex flex-col leading-tight">
                <span className="font-bold text-admin-ink">JM Digital Media</span>
                <span className="text-xs text-admin-ink/55">Custom tees &amp; hats</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-admin-ink hover:bg-admin-ink/5"
              aria-label="Close menu"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <ul className="px-6">
            {sections.map((s) => {
              const isOpen = expanded === s.label;
              return (
                <li key={s.label} className="border-b border-admin-ink/10">
                  <button type="button" className={row} onClick={() => setExpanded(isOpen ? null : s.label)} aria-expanded={isOpen}>
                    {s.label}
                    <Chevron open={isOpen} />
                  </button>
                  {isOpen && (
                    <ul className="pb-4">
                      {s.links.map((l) => (
                        <li key={l.href}>
                          <Link href={l.href} onClick={() => setMenuOpen(false)} className="block pl-6 py-3 text-lg text-admin-ink/85 hover:text-admin-ink">
                            {l.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            <li className="border-b border-admin-ink/10">
              <Link href="/quote-builder" onClick={() => setMenuOpen(false)} className={row}>
                Get a Quote
              </Link>
            </li>
            <li className="border-b border-admin-ink/10">
              <Link href="/cart" onClick={() => setMenuOpen(false)} className={row}>
                My Cart
              </Link>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
