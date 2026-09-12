import Image from "next/image";
import Link from "next/link";
import StepHeader from "@/components/StepHeader";
import CuratedProductCard from "@/components/CuratedProductCard";
import { getCuratedCatalog } from "@/lib/curated-catalog";

export default async function HomePage() {
  const categories = await getCuratedCatalog();

  return (
    <>
      <StepHeader />

      {/* Short hero */}
      <section className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14 text-center">
          <Image
            src="/brand/jm-logo.png"
            alt="JM Digital Media"
            width={72}
            height={72}
            className="mx-auto mb-4"
            priority
          />
          <h1 className="font-heading text-3xl sm:text-4xl font-bold uppercase tracking-tight">
            Look the Part. <span className="text-red">Mean Business.</span>
          </h1>
          <p className="mt-3 text-tan text-base max-w-xl mx-auto">
            Browse our curated gear below. Pick a product, then Design Now to
            build it yourself or Get Quote to see pricing instantly.
          </p>
        </div>
      </section>

      <main className="flex-1 bg-gray w-full">
        <div className="max-w-6xl mx-auto px-4 py-10">
          {categories.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-navy/60">
                The catalog is being set up — check back soon, or{" "}
                <Link href="/catalog" className="text-red font-semibold hover:underline">
                  browse the full catalog
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-12">
              {categories.map((cat) => (
                <section key={cat.id}>
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-heading text-2xl font-semibold uppercase text-navy tracking-wide">
                      {cat.name}
                    </h2>
                    <span className="text-sm text-navy/50">
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

          <div className="mt-14 text-center text-sm text-navy/50">
            Looking for something specific?{" "}
            <Link href="/catalog" className="text-red font-semibold hover:underline">
              Browse the full catalog
            </Link>
          </div>
        </div>
      </main>

      <footer className="bg-navy text-white/60 text-xs">
        <div className="max-w-6xl mx-auto px-4 pt-6 pb-5">
          <div className="h-px bg-tan/30" />
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-center sm:text-left">
              JM Digital Media · Rosenberg, TX ·{" "}
              <a href="https://www.buyjmmedia.com" className="hover:text-white transition">
                buyjmmedia.com
              </a>
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://www.facebook.com/buyjmmedia"
                aria-label="JM Digital Media on Facebook"
                className="text-white/60 hover:text-tan transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M22 12.06C22 6.507 17.523 2 12 2S2 6.507 2 12.06c0 5.02 3.657 9.184 8.438 9.94v-7.03H7.898v-2.91h2.54V9.845c0-2.507 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562v1.877h2.773l-.443 2.91h-2.33V22c4.78-.756 8.437-4.92 8.437-9.94Z" />
                </svg>
              </a>
              <a
                href="https://www.instagram.com/media.jm"
                aria-label="JM Digital Media on Instagram"
                className="text-white/60 hover:text-tan transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2c-2.716 0-3.056.012-4.123.06-1.064.05-1.79.218-2.425.465a4.9 4.9 0 0 0-1.771 1.153A4.9 4.9 0 0 0 2.525 5.45c-.247.635-.416 1.36-.465 2.424C2.012 8.943 2 9.283 2 12s.012 3.056.06 4.123c.05 1.064.218 1.79.465 2.425a4.9 4.9 0 0 0 1.153 1.771 4.9 4.9 0 0 0 1.771 1.153c.635.247 1.36.416 2.425.465C8.943 21.988 9.283 22 12 22s3.056-.012 4.123-.06c1.064-.05 1.79-.218 2.425-.465a4.9 4.9 0 0 0 1.771-1.153 4.9 4.9 0 0 0 1.153-1.771c.247-.635.416-1.36.465-2.425.048-1.066.06-1.406.06-4.123s-.012-3.056-.06-4.123c-.05-1.064-.218-1.79-.465-2.425a4.9 4.9 0 0 0-1.153-1.771A4.9 4.9 0 0 0 18.548.525c-.635-.247-1.36-.416-2.425-.465C15.056.012 14.716 0 12 0Zm0 5.838A6.162 6.162 0 1 1 5.838 12 6.162 6.162 0 0 1 12 5.838ZM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6.406-11.845a1.44 1.44 0 1 1-1.44 1.44 1.44 1.44 0 0 1 1.44-1.44Z" />
                </svg>
              </a>
              <a
                href="https://www.tiktok.com/@jmdigitalmedia"
                aria-label="JM Digital Media on TikTok"
                className="text-white/60 hover:text-tan transition"
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
