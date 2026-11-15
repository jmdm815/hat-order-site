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
    <header className="bg-admin-card/95 backdrop-blur sticky top-0 z-10 border-b border-admin-ink/10 pt-safe">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3 shrink-0 group">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo can be an
              admin-uploaded Vercel Blob URL (see AdminLogoManager.tsx), so next/image's
              remotePatterns allowlist doesn't apply; this is a small fixed-size icon. */}
          <img src={logoUrl} alt="JM Digital Media" width={40} height={40} className="w-10 h-10 object-contain transition group-hover:scale-105" />
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="font-semibold text-[15px] text-admin-ink">JM Digital Media</span>
            <span className="text-xs text-admin-ink/55">Custom tees &amp; hats</span>
          </span>
        </Link>
        {/* Only show the step-by-step progress bar while actually going
            through the order flow (catalog -> customize -> cart -> checkout)
            — not on the homepage or the standalone quote tools, where it
            doesn't correspond to anything the visitor is mid-way through. */}
        {current !== -1 ? (
          <ol className="hidden md:flex items-center gap-1 rounded-xl bg-admin-bg p-1 text-sm">
            {STEPS.map((step, i) => (
              <li
                key={step.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                  i === current ? "bg-admin-card shadow-sm font-semibold text-admin-ink" : i < current ? "text-admin-ink/70" : "text-admin-ink/45"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${
                    i === current
                      ? "bg-admin-accent text-admin-accent-ink"
                      : i < current
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-admin-ink/10 text-admin-ink/60"
                  }`}
                >
                  {i < current ? "✓" : i + 1}
                </span>
                {step.label}
              </li>
            ))}
          </ol>
        ) : (
          <nav className="flex items-center gap-1 sm:gap-2 text-sm">
            <Link href="/catalog" className="hidden sm:inline px-3 py-2 rounded-lg text-admin-ink/75 hover:bg-admin-ink/5 hover:text-admin-ink transition">
              Catalog
            </Link>
            <Link href="/quote-builder" className="hidden sm:inline px-3 py-2 rounded-lg text-admin-ink/75 hover:bg-admin-ink/5 hover:text-admin-ink transition">
              Get a quote
            </Link>
            <Link
              href="/catalog"
              className="px-4 py-2 rounded-lg bg-admin-accent text-admin-accent-ink font-semibold hover:bg-admin-accent-dim transition"
            >
              Start an order
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
