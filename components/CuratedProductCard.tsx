import Image from "next/image";
import Link from "next/link";
import { CuratedProduct } from "@/lib/curated-catalog";
import { formatUSD } from "@/lib/pricing";
import { productPreviewImageUrl } from "@/lib/product-image";

// One tile in the curated homepage catalog: photo, name, a starting price so
// customers can see the cost without opening the designer, and up to two
// action buttons an admin turns on/off per item (see
// CatalogItemConfig.designEnabled/quoteEnabled) — "Design Now" for the full
// live designer flow, "Get Quote" for the lighter estimate-only flow that
// doesn't require uploading artwork.
export default function CuratedProductCard({ product }: { product: CuratedProduct }) {
  const query = `?style=${encodeURIComponent(product.styleNumber)}&type=${product.productType}`;
  return (
    <div className="group border-2 border-admin-ink/10 rounded-2xl bg-admin-card overflow-hidden shadow-sm shadow-slate-900/10 hover:border-red hover:shadow-lg hover:shadow-slate-900/10 hover:-translate-y-0.5 transition flex flex-col">
      <div className="relative w-full aspect-square bg-admin-ink/5 p-6">
        <Image
          src={
            product.heroImageIsOverride
              ? product.heroImageUrl
              : productPreviewImageUrl(product.heroImageUrl, product.heroImageFallbackUrl)
          }
          alt={product.productName}
          fill
          unoptimized
          className="object-contain"
          sizes="(max-width: 640px) 100vw, 25vw"
        />
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="text-xs uppercase tracking-wide text-admin-ink/40">
          {product.brandName} · {product.styleNumber}
        </div>
        <div className="font-semibold text-admin-ink mt-0.5 leading-tight">{product.productName}</div>
        <div className="mt-2 text-sm text-admin-ink/60">
          Starting at <span className="font-semibold text-admin-ink">{formatUSD(product.basePrice)}</span>
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          {product.designEnabled && (
            <Link
              href={`/customize${query}`}
              className="flex-1 text-center px-3 py-2 rounded-2xl bg-admin-accent text-admin-accent-ink text-sm font-semibold hover:bg-admin-accent-dim transition"
            >
              Design Now
            </Link>
          )}
          {product.quoteEnabled && (
            <Link
              href={`/quote${query}`}
              className={`flex-1 text-center px-3 py-2 rounded-2xl text-sm font-semibold border transition ${
                product.designEnabled
                  ? "border-admin-ink/20 text-admin-ink hover:bg-admin-ink/5"
                  : "bg-admin-bg text-admin-ink hover:bg-admin-bg/90"
              }`}
            >
              Get Quote
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
