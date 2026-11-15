import Link from "next/link";
import StepHeader from "@/components/StepHeader";
import CuratedProductCard from "@/components/CuratedProductCard";
import { getCuratedCatalog } from "@/lib/curated-catalog";
import { getBrandSettings, publicLogoUrl } from "@/lib/pricing-store";

export default async function HomePage() {
  const [categories, brand] = await Promise.all([getCuratedCatalog(), getBrandSettings()]);
  const logoUrl = publicLogoUrl(brand);

  return (
    <>
      <StepHeader logoUrl={logoUrl} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-admin-ink/10 bg-admin-card">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 70% at 85% 0%, rgba(31,47,92,0.10) 0%, rgba(31,47,92,0) 70%), radial-gradient(40% 60% at 0% 100%, rgba(215,38,61,0.07) 0%, rgba(215,38,61,0) 70%)",
          }}
          aria-hidden
        />
        <div className="relative max-w-6xl mx-auto px-4 py-12 sm:py-16 grid md:grid-cols-[1fr_auto] gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-admin-ink/10 bg-admin-bg px-3 py-1 text-xs font-semibold text-admin-ink/70">
              <span className="w-1.5 h-1.5 rounded-full bg-red" /> Embroidery · Screen print · DTF · Patches
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-admin-ink leading-[1.05]">
              Look the part. <span className="text-red">Mean business.</span>
            </h1>
            <p className="mt-4 text-admin-ink/65 text-base sm:text-lg max-w-xl">
              Custom hats and apparel for your business. Pick a product, then <strong className="text-admin-ink">Design Now</strong> to
              build it yourself or <strong className="text-admin-ink">Get Quote</strong> to see pricing instantly.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Link
                href="/catalog"
                className="text-center px-6 py-3 rounded-xl bg-admin-accent text-admin-accent-ink text-sm font-semibold shadow-sm hover:bg-admin-accent-dim transition"
              >
                Browse the catalog
              </Link>
              <Link
                href="/quote-builder"
                className="text-center px-6 py-3 rounded-xl border border-admin-ink/15 bg-admin-card text-admin-ink text-sm font-semibold hover:bg-admin-ink/5 transition"
              >
                Build a quote by decoration type →
              </Link>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- can be an
              admin-uploaded Vercel Blob URL; see StepHeader.tsx for why plain
              img is used instead of next/image here. */}
          <img
            src={logoUrl}
            alt="JM Digital Media"
            width={190}
            height={190}
            className="hidden md:block w-[190px] h-[190px] object-contain drop-shadow-[0_18px_40px_rgba(23,32,56,0.25)]"
          />
        </div>
      </section>

      <main className="flex-1 w-full">
        <div className="max-w-6xl mx-auto px-4 py-10">
          {categories.length === 0 ? (
            <div className="text-center py-16 px-6 rounded-xl border border-admin-ink/10 bg-admin-card shadow-sm">
              <p className="text-admin-ink/70">
                The catalog is being set up — check back soon, or browse everything we carry now.
              </p>
              <Link
                href="/catalog"
                className="mt-5 inline-block px-5 py-2.5 rounded-lg bg-admin-accent text-admin-accent-ink text-sm font-semibold hover:bg-admin-accent-dim transition"
              >
                Browse the full catalog →
              </Link>
            </div>
          ) : (
            <div className="space-y-12">
              {categories.map((cat) => (
                <section key={cat.id}>
                  <div className="flex items-end justify-between gap-4">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-admin-ink">{cat.name}</h2>
                    <span className="text-sm text-admin-ink/50">
                      {cat.products.length} item{cat.products.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {cat.products.map((p) => (
                      <CuratedProductCard key={p.styleNumber} product={p} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className="mt-14 text-center text-sm text-admin-ink/55">
            Looking for something specific?{" "}
            <Link href="/catalog" className="text-admin-accent font-semibold hover:underline">
              Browse the full catalog
            </Link>
          </div>
        </div>
      </main>

      <footer className="bg-admin-card border-t border-admin-ink/10 text-admin-ink/60 text-xs">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-center sm:text-left">
              JM Digital Media · Rosenberg, TX ·{" "}
              <a href="https://www.buyjmmedia.com" className="hover:text-admin-ink transition">
                buyjmmedia.com
              </a>
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://www.facebook.com/buyjmmedia"
                aria-label="JM Digital Media on Facebook"
                className="text-admin-ink/60 hover:text-red transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M22 12.06C22 6.507 17.523 2 12 2S2 6.507 2 12.06c0 5.02 3.657 9.184 8.438 9.94v-7.03H7.898v-2.91h2.54V9.845c0-2.507 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562v1.877h2.773l-.443 2.91h-2.33V22c4.78-.756 8.437-4.92 8.437-9.94Z" />
                </svg>
              </a>
              <a
                href="https://www.instagram.com/media.jm"
                aria-label="JM Digital Media on Instagram"
                className="text-admin-ink/60 hover:text-red transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2c-2.716 0-3.056.012-4.123.06-1.064.05-1.79.218-2.425.465a4.9 4.9 0 0 0-1.771 1.153A4.9 4.9 0 0 0 2.525 5.45c-.247.635-.416 1.36-.465 2.424C2.012 8.943 2 9.283 2 12s.012 3.056.06 4.123c.05 1.064.218 1.79.465 2.425a4.9 4.9 0 0 0 1.153 1.771 4.9 4.9 0 0 0 1.771 1.153c.635.247 1.36.416 2.425.465C8.943 21.988 9.283 22 12 22s3.056-.012 4.123-.06c1.064-.05 1.79-.218 2.425-.465a4.9 4.9 0 0 0 1.771-1.153 4.9 4.9 0 0 0 1.153-1.771c.247-.635.416-1.36.465-2.425.048-1.066.06-1.406.06-4.123s-.012-3.056-.06-4.123c-.05-1.064-.218-1.79-.465-2.425a4.9 4.9 0 0 0-1.153-1.771A4.9 4.9 0 0 0 18.548.525c-.635-.247-1.36-.416-2.425-.465C15.056.012 14.716 0 12 0Zm0 5.838A6.162 6.162 0 1 1 5.838 12 6.162 6.162 0 0 1 12 5.838ZM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6.406-11.845a1.44 1.44 0 1 1-1.44 1.44 1.44 1.44 0 0 1 1.44-1.44Z" />
                </svg>
              </a>
              <a
                href="https://www.tiktok.com/@jmdigitalmedia"
                aria-label="JM Digital Media on TikTok"
                className="text-admin-ink/60 hover:text-red transition"
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
