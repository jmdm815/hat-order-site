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
    <header className="bg-navy sticky top-0 z-10 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo can be an
              admin-uploaded Vercel Blob URL (see AdminLogoManager.tsx), so next/image's
              remotePatterns allowlist doesn't apply; this is a small fixed-size icon. */}
          <img src={logoUrl} alt="JM Digital Media" width={40} height={40} className="rounded-md w-10 h-10 object-contain" />
          <span className="hidden sm:block font-heading font-semibold text-lg tracking-wide text-tan uppercase">
            Custom Tees and Hats
          </span>
        </Link>
        {/* Only show the step-by-step progress bar while actually going
            through the order flow (catalog -> customize -> cart -> checkout)
            — not on the homepage or the standalone quote tools, where it
            doesn't correspond to anything the visitor is mid-way through. */}
        {current !== -1 && (
          <ol className="hidden sm:flex items-center gap-2 text-sm">
            {STEPS.map((step, i) => (
              <li key={step.href} className="flex items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 ${
                    i === current
                      ? "font-semibold text-white"
                      : i < current
                      ? "text-white/70"
                      : "text-white/40"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold ${
                      i === current
                        ? "bg-red text-white"
                        : i < current
                        ? "bg-white text-navy"
                        : "bg-gray/20 text-white/60"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {step.label}
                </span>
                {i < STEPS.length - 1 && <span className="w-4 h-px bg-white/25" />}
              </li>
            ))}
          </ol>
        )}
      </div>
    </header>
  );
}
