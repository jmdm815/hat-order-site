"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function StepHeader() {
  const pathname = usePathname();
  const current = stepIndexForPath(pathname);

  return (
    <header className="border-b-2 border-navy bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/brand/jm-logo.png"
            alt="JM Digital Media"
            width={40}
            height={40}
            className="rounded-md"
            priority
          />
          <span
            className="hidden sm:block font-heading font-semibold text-lg tracking-wide text-navy uppercase"
          >
            Custom Tees and Hats
          </span>
        </Link>
        <ol className="hidden sm:flex items-center gap-2 text-sm">
          {STEPS.map((step, i) => (
            <li key={step.href} className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1.5 ${
                  i === current
                    ? "font-semibold text-navy"
                    : i < current
                    ? "text-navy/60"
                    : "text-navy/30"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                    i === current
                      ? "bg-red text-white"
                      : i < current
                      ? "bg-navy/15 text-navy/80"
                      : "bg-navy/5 text-navy/40"
                  }`}
                >
                  {i + 1}
                </span>
                {step.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-navy/15">—</span>}
            </li>
          ))}
        </ol>
      </div>
    </header>
  );
}
