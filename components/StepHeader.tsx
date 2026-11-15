"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const DEFAULT_LOGO_URL = "/brand/jm-logo.png";

const STEPS = [
  { href: "/catalog", label: "Choose Your Gear" },
  { href: "/customize", label: "Customize" },
  { href: "/cart", label: "Review" },
  { href: "/checkout", label: "Checkout" },
];

function stepIndexForPath(pathname: string): number {
  if (pathname.startsWith("/catalog")) return 0;
  if (pathname.startsWith("/customize")) return 1;
  if (pathname.startsWith("/cart")) return 2;
  if (pathname.startsWith("/checkout") || pathname.startsWith("/confirmation")) return 3;
  return -1;
}

type StepHeaderProps = {
  // Server pages can pass this (fetched via lib/pricing-store.ts) to avoid a
  // client-side round trip / logo flash. Client-component pages that render
  // <StepHeader /> with no prop fetch it themselves from the public
  // /api/site-settings endpoint below.
  logoUrl?: string;
};

export default function StepHeader({ logoUrl: logoUrlProp }: StepHeaderProps) {
  const pathname = usePathname();
  const current = stepIndexForPath(pathname);
  const [fetchedLogoUrl, setFetchedLogoUrl] = useState(DEFAULT_LOGO_URL);

  useEffect(() => {
    if (logoUrlProp) return; // server already resolved it — no need to fetch
    let cancelled = false;
    fetch("/api/site-settings")
      .then((r) => r.json())
      .then((data: { logoUrl?: string }) => {
        if (!cancelled && data.logoUrl) setFetchedLogoUrl(data.logoUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [logoUrlProp]);

  const logoUrl = logoUrlProp ?? fetchedLogoUrl;

  return (
    // .jm-store switches the whole page to the storefront (trades) theme —
    // see app/globals.css.
    <header className="jm-store bg-[#141619] text-white sticky top-0 z-10 shadow-lg shadow-black/20 pt-safe">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3 shrink-0 group">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo can be an
              admin-uploaded Vercel Blob URL (see AdminLogoManager.tsx), so next/image's
              remotePatterns allowlist doesn't apply; this is a small fixed-size icon. */}
          <img src={logoUrl} alt="JM Digital Media" width={44} height={44} className="w-[44px] h-[44px] object-contain transition group-hover:scale-105" />
          <span className="hidden sm:flex flex-col leading-none">
            <span className="font-heading font-semibold text-lg tracking-wider uppercase">JM Digital Media</span>
            <span className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#ffc61a]">Crew gear · Workwear · Hats</span>
          </span>
        </Link>
        {/* Only show the step-by-step progress bar while actually going
            through the order flow (catalog -> customize -> cart -> checkout)
            — not on the homepage or the standalone quote tools, where it
            doesn't correspond to anything the visitor is mid-way through. */}
        {current !== -1 ? (
          <ol className="hidden md:flex items-center gap-2 text-sm">
            {STEPS.map((step, i) => (
              <li key={step.href} className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 uppercase tracking-wide text-xs ${
                    i === current ? "font-bold text-white" : i < current ? "text-white/75" : "text-white/40"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded-sm text-[11px] font-bold ${
                      i === current
                        ? "bg-[#ffc61a] text-[#111214]"
                        : i < current
                          ? "bg-white/20 text-white"
                          : "bg-white/10 text-white/60"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {step.label}
                </span>
                {i < STEPS.length - 1 && <span className={`w-5 h-px ${i < current ? "bg-[#ffc61a]/70" : "bg-white/20"}`} />}
              </li>
            ))}
          </ol>
        ) : (
          <nav className="flex items-center gap-2 sm:gap-5 text-sm">
            <Link href="/catalog" className="hidden sm:inline uppercase tracking-wide text-xs font-semibold text-white/80 hover:text-white">
              Catalog
            </Link>
            <Link href="/quote-builder" className="hidden sm:inline uppercase tracking-wide text-xs font-semibold text-white/80 hover:text-white">
              Bulk quote
            </Link>
            <a
              href="tel:+12813441772"
              className="px-3 py-2 rounded-md bg-[#ffc61a] text-[#111214] text-xs font-bold uppercase tracking-wide hover:bg-[#f2b300] transition"
            >
              (281) 344-1772
            </a>
          </nav>
        )}
      </div>
      <div className="hazard-stripes h-1.5" aria-hidden />
    </header>
  );
}
