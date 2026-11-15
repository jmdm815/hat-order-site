import Link from "next/link";
import type { ReactNode } from "react";
import StepHeader from "@/components/StepHeader";
import CuratedProductCard from "@/components/CuratedProductCard";
import { getCuratedCatalog } from "@/lib/curated-catalog";
import { getBrandSettings, publicLogoUrl } from "@/lib/pricing-store";

// Storefront home, styled for trades / construction companies to match
// buyjmmedia.com (jobsite photo hero, "Businesses That Mean Business").

const icon = (d: ReactNode) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const TRADES: { name: string; gear: string; icon: ReactNode }[] = [
  {
    name: "Construction",
    gear: "Hi-vis tees, hard-wearing hats, crew jackets",
    icon: icon(<><path d="M3 18h18" /><path d="M5 18v-3a7 7 0 0 1 14 0v3" /><path d="M12 8V5" /><path d="M9 9.5V7.5M15 9.5V7.5" /></>),
  },
  {
    name: "Electrical",
    gear: "FR shirts, polos, embroidered caps",
    icon: icon(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  },
  {
    name: "Plumbing & HVAC",
    gear: "Service polos, work shirts, beanies",
    icon: icon(<><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5 2.5-2.5Z" /></>),
  },
  {
    name: "Landscaping",
    gear: "Performance tees, sun hats, long sleeves",
    icon: icon(<><path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 16-10-1 12-5 16-10 16" /><path d="M4 21c4-4 7-7 11-10" /></>),
  },
  {
    name: "Oil, Gas & Industrial",
    gear: "FR workwear, safety colors, outerwear",
    icon: icon(<><path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z" /></>),
  },
  {
    name: "Fleet & Auto",
    gear: "Shop shirts, mechanic polos, trucker hats",
    icon: icon(<><path d="M3 16V8h11v8" /><path d="M14 11h4l3 3v2h-7" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>),
  },
];

const DECORATION = [
  { name: "Embroidery", note: "Hats, polos, jackets — built to last on the job" },
  { name: "Screen print", note: "Best price per shirt on bigger crew orders" },
  { name: "DTF transfers", note: "Full-color logos, no minimum headaches" },
  { name: "Patches", note: "UV and engraved patches for a sharp hat" },
];

const VALUES = [
  { title: "In-house decorating", body: "Embroidery, screen print and DTF done in our Rosenberg shop." },
  { title: "Crew & bulk pricing", body: "Price drops as your order grows — outfit one truck or the whole company." },
  { title: "Proof before production", body: "We send a mockup so your logo is right before anything is made." },
  { title: "Local pickup", body: "Pick up at 815 2nd St, Rosenberg, by appointment." },
];

export default async function HomePage() {
  const [categories, brand] = await Promise.all([getCuratedCatalog(), getBrandSettings()]);
  const logoUrl = publicLogoUrl(brand);

  return (
    <>
      <StepHeader logoUrl={logoUrl} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#141619] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 64px), repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 64px)" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-40 -top-40 w-[560px] h-[560px] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #ffc61a 0%, rgba(255,198,26,0) 70%)" }}
          aria-hidden
        />
        <div className="relative max-w-6xl mx-auto px-4 py-14 sm:py-20 grid lg:grid-cols-[1.25fr_1fr] gap-10 items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-[11px] sm:text-xs font-bold uppercase tracking-[0.2em] text-[#ffc61a]">
              <span className="w-6 h-0.5 bg-[#ffc61a]" /> Branded workwear · Rosenberg, TX
            </p>
            <h1 className="mt-4 font-heading font-bold uppercase leading-[0.95] text-5xl sm:text-6xl lg:text-7xl tracking-tight">
              Gear that works
              <br />
              as hard as <span className="text-[#ffc61a]">your crew.</span>
            </h1>
            <p className="mt-6 text-white/75 text-base sm:text-lg max-w-xl">
              Embroidered hats, hi-vis tees, polos and jackets with your company logo — for construction, the trades and
              industrial crews across the Houston area.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                href="/catalog"
                className="text-center px-7 py-3.5 rounded-md bg-[#ffc61a] text-[#111214] text-sm font-bold uppercase tracking-wider hover:bg-[#f2b300] transition"
              >
                Shop crew gear
              </Link>
              <Link
                href="/quote-builder"
                className="text-center px-7 py-3.5 rounded-md border-2 border-white/30 text-white text-sm font-bold uppercase tracking-wider hover:border-white hover:bg-white/5 transition"
              >
                Get a bulk quote
              </Link>
            </div>
          </div>

          {/* "Spec sheet" of decoration methods */}
          <div className="relative rounded-lg bg-white/[0.04] border border-white/10 p-6 sm:p-7 backdrop-blur-sm">
            <div className="absolute top-0 left-0 right-0 h-1.5 hazard-stripes rounded-t-lg" aria-hidden />
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">What we put your logo on</p>
            <ul className="mt-5 space-y-4">
              {DECORATION.map((d, i) => (
                <li key={d.name} className="flex gap-4">
                  <span className="font-heading text-2xl font-bold text-[#ffc61a] w-8 shrink-0">0{i + 1}</span>
                  <div>
                    <div className="font-heading text-xl uppercase tracking-wide">{d.name}</div>
                    <div className="text-sm text-white/60">{d.note}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Value strip */}
      <section className="bg-[#ffc61a] text-[#111214]">
        <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          {VALUES.map((v) => (
            <div key={v.title}>
              <div className="font-heading text-lg font-bold uppercase tracking-wide leading-tight">{v.title}</div>
              <div className="mt-1 text-sm text-[#111214]/75 leading-snug">{v.body}</div>
            </div>
          ))}
        </div>
      </section>

      <main className="flex-1 w-full">
        {/* Built for the trades */}
        <section className="max-w-6xl mx-auto px-4 pt-14 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-admin-ink/50">Who we outfit</p>
              <h2 className="mt-1 font-heading text-3xl sm:text-4xl font-bold uppercase">Built for the trades</h2>
            </div>
            <p className="text-sm text-admin-ink/60 max-w-md">
              Most of our customers are companies that put crews in the field. Here&apos;s what they usually order.
            </p>
          </div>
          <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TRADES.map((t) => (
              <Link
                key={t.name}
                href="/catalog"
                className="group flex items-start gap-4 rounded-lg bg-admin-card border border-admin-ink/10 p-5 hover:border-[#111214] hover:shadow-lg hover:shadow-black/5 transition"
              >
                <span className="flex items-center justify-center w-12 h-12 shrink-0 rounded-md bg-[#141619] text-[#ffc61a] group-hover:bg-[#ffc61a] group-hover:text-[#111214] transition">
                  {t.icon}
                </span>
                <span>
                  <span className="block font-heading text-xl font-semibold uppercase tracking-wide">{t.name}</span>
                  <span className="block mt-0.5 text-sm text-admin-ink/60">{t.gear}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Curated catalog */}
        <section className="max-w-6xl mx-auto px-4 py-12">
          {categories.length === 0 ? (
            <div className="text-center py-16 px-6 rounded-lg border border-admin-ink/10 bg-admin-card">
              <p className="text-admin-ink/70">
                The catalog is being set up — check back soon, or browse everything we carry now.
              </p>
              <Link
                href="/catalog"
                className="mt-5 inline-block px-6 py-2.5 rounded-md bg-admin-accent text-admin-accent-ink text-sm font-bold uppercase tracking-wide hover:bg-admin-accent-dim transition"
              >
                Browse the full catalog →
              </Link>
            </div>
          ) : (
            <div className="space-y-12">
              {categories.map((cat) => (
                <section key={cat.id}>
                  <div className="flex items-end justify-between border-b-2 border-[#111214] pb-2">
                    <h2 className="font-heading text-2xl sm:text-3xl font-bold uppercase tracking-wide">{cat.name}</h2>
                    <span className="text-xs font-semibold uppercase tracking-wider text-admin-ink/50">
                      {cat.products.length} item{cat.products.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {cat.products.map((p) => (
                      <CuratedProductCard key={p.styleNumber} product={p} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className="mt-12 text-center text-sm text-admin-ink/60">
            Looking for a specific style number?{" "}
            <Link href="/catalog" className="font-bold text-admin-ink underline decoration-[#ffc61a] decoration-2 underline-offset-4 hover:decoration-[#111214]">
              Browse the full catalog
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-admin-card border-y border-admin-ink/10">
          <div className="max-w-6xl mx-auto px-4 py-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-admin-ink/50">How it works</p>
            <h2 className="mt-1 font-heading text-3xl sm:text-4xl font-bold uppercase">Three steps to a branded crew</h2>
            <ol className="mt-8 grid md:grid-cols-3 gap-6">
              {[
                ["Pick your gear", "Choose hats, tees, polos or jackets and the colors your crew wears."],
                ["Add your logo", "Upload it and place it — left chest, back, sleeve, hat front. Or just pick spots and get a price."],
                ["We make it", "We send a proof, decorate it in-house and have it ready for pickup or shipping."],
              ].map(([title, body], i) => (
                <li key={title} className="relative pl-16">
                  <span className="absolute left-0 top-0 flex items-center justify-center w-12 h-12 rounded-md bg-[#ffc61a] font-heading text-2xl font-bold text-[#111214]">
                    {i + 1}
                  </span>
                  <div className="font-heading text-xl font-semibold uppercase tracking-wide">{title}</div>
                  <p className="mt-1 text-sm text-admin-ink/65">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Crew order CTA */}
        <section className="relative bg-[#141619] text-white overflow-hidden">
          <div className="hazard-stripes h-2" aria-hidden />
          <div className="max-w-6xl mx-auto px-4 py-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold uppercase">
                Outfitting the <span className="text-[#ffc61a]">whole company?</span>
              </h2>
              <p className="mt-2 text-white/70 max-w-xl">
                Send us your logo, headcount and sizes. We&apos;ll put together a quote for your crew — POs and net
                terms welcome for established businesses.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <a
                href="mailto:purchasing@buyjmmedia.com?subject=Crew%20apparel%20quote"
                className="text-center px-6 py-3.5 rounded-md bg-[#ffc61a] text-[#111214] text-sm font-bold uppercase tracking-wider hover:bg-[#f2b300] transition"
              >
                Email your logo
              </a>
              <a
                href="tel:+12813441772"
                className="text-center px-6 py-3.5 rounded-md border-2 border-white/30 text-sm font-bold uppercase tracking-wider hover:border-white transition"
              >
                Call (281) 344-1772
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#141619] text-white/60 text-xs">
        <div className="max-w-6xl mx-auto px-4 pt-6 pb-5">
          <div className="h-px bg-white/10" />
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-center sm:text-left">
              JM Digital Media · 815 2nd St, Rosenberg, TX ·{" "}
              <a href="mailto:purchasing@buyjmmedia.com" className="hover:text-white transition">
                purchasing@buyjmmedia.com
              </a>{" "}
              ·{" "}
              <a href="https://www.buyjmmedia.com" className="hover:text-white transition">
                buyjmmedia.com
              </a>
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://www.facebook.com/buyjmmedia"
                aria-label="JM Digital Media on Facebook"
                className="text-white/60 hover:text-[#ffc61a] transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M22 12.06C22 6.507 17.523 2 12 2S2 6.507 2 12.06c0 5.02 3.657 9.184 8.438 9.94v-7.03H7.898v-2.91h2.54V9.845c0-2.507 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562v1.877h2.773l-.443 2.91h-2.33V22c4.78-.756 8.437-4.92 8.437-9.94Z" />
                </svg>
              </a>
              <a
                href="https://www.instagram.com/media.jm"
                aria-label="JM Digital Media on Instagram"
                className="text-white/60 hover:text-[#ffc61a] transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2c-2.716 0-3.056.012-4.123.06-1.064.05-1.79.218-2.425.465a4.9 4.9 0 0 0-1.771 1.153A4.9 4.9 0 0 0 2.525 5.45c-.247.635-.416 1.36-.465 2.424C2.012 8.943 2 9.283 2 12s.012 3.056.06 4.123c.05 1.064.218 1.79.465 2.425a4.9 4.9 0 0 0 1.153 1.771 4.9 4.9 0 0 0 1.771 1.153c.635.247 1.36.416 2.425.465C8.943 21.988 9.283 22 12 22s3.056-.012 4.123-.06c1.064-.05 1.79-.218 2.425-.465a4.9 4.9 0 0 0 1.771-1.153 4.9 4.9 0 0 0 1.153-1.771c.247-.635.416-1.36.465-2.425.048-1.066.06-1.406.06-4.123s-.012-3.056-.06-4.123c-.05-1.064-.218-1.79-.465-2.425a4.9 4.9 0 0 0-1.153-1.771A4.9 4.9 0 0 0 18.548.525c-.635-.247-1.36-.416-2.425-.465C15.056.012 14.716 0 12 0Zm0 5.838A6.162 6.162 0 1 1 5.838 12 6.162 6.162 0 0 1 12 5.838ZM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6.406-11.845a1.44 1.44 0 1 1-1.44 1.44 1.44 1.44 0 0 1 1.44-1.44Z" />
                </svg>
              </a>
              <a
                href="https://www.tiktok.com/@jmdigitalmedia"
                aria-label="JM Digital Media on TikTok"
                className="text-white/60 hover:text-[#ffc61a] transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.6 5.82c-1.02-.9-1.6-2.19-1.6-3.62h-3.15v13.44a2.9 2.9 0 1 1-2.05-2.77V9.63a6.06 6.06 0 1 0 5.2 6v-6.87a7.6 7.6 0 0 0 4.44 1.42V7.03a4.5 4.5 0 0 1-2.84-1.21Z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
