import Image from "next/image";
import Link from "next/link";
import StepHeader from "@/components/StepHeader";
import { DECORATION_OPTIONS } from "@/lib/decorations";

export default function HomePage() {
  return (
    <>
      <StepHeader />

      {/* Hero */}
      <section className="bg-navy text-white">
        <div className="max-w-5xl mx-auto px-4 py-16 sm:py-24 text-center">
          <Image
            src="/brand/jm-logo.png"
            alt="JM Digital Media"
            width={120}
            height={120}
            className="mx-auto mb-6"
            priority
          />
          <p className="font-heading uppercase tracking-[0.2em] text-red text-sm font-semibold">
            JM Digital Media
          </p>
          <h1 className="mt-3 font-heading text-4xl sm:text-6xl font-bold uppercase tracking-tight">
            Look the Part.
            <br />
            <span className="text-red">Mean Business.</span>
          </h1>
          <p className="mt-5 text-white/70 text-lg max-w-xl mx-auto">
            Custom hats and t-shirts, decorated your way — UV patch, engraved
            patch, embroidery, or screen print. Real pricing in minutes, no
            back-and-forth emails.
          </p>
          <Link
            href="/catalog"
            className="mt-8 inline-block px-8 py-3.5 rounded-full bg-red text-white font-heading font-semibold uppercase tracking-wide hover:bg-white hover:text-navy transition"
          >
            Start Your Order →
          </Link>
        </div>
      </section>

      {/* Decoration options */}
      <main className="flex-1 max-w-5xl mx-auto px-4 py-14 w-full">
        <h2 className="font-heading text-2xl font-semibold uppercase text-navy text-center tracking-wide">
          Hats and tees, decorated your way
        </h2>
        <p className="mt-2 text-center text-sm text-navy/60 max-w-xl mx-auto">
          UV patch, engraved patch, and embroidery for hats — embroidery and screen
          print for t-shirts.
        </p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {DECORATION_OPTIONS.map((d) => (
            <div
              key={d.id}
              className="border-t-4 border-red rounded-lg p-5 bg-white shadow-sm"
            >
              <div className="font-heading font-semibold uppercase text-navy tracking-wide">
                {d.shortLabel}
              </div>
              <p className="mt-2 text-sm text-navy/70">{d.description}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="bg-navy text-white/50 text-center text-xs py-6">
        JM Digital Media · Rosenberg, TX ·{" "}
        <a href="https://www.buyjmmedia.com" className="hover:text-white transition">
          buyjmmedia.com
        </a>
      </footer>
    </>
  );
}
