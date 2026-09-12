import Image from "next/image";
import Link from "next/link";
import { CuratedProduct } from "@/lib/curated-catalog";
import { formatUSD } from "@/lib/pricing";
import { productImageUrl } from "@/lib/product-image";

// One tile in the curated homepage catalog: photo, name, a starting price so
// customers can see the cost without opening the designer, and up to two
// action buttons an admin turns on/off per item (see
// CatalogItemConfig.designEnabled/quoteEnabled) — "Design Now" for the full
// live designer flow, "Get Quote" for the lighter estimate-only flow that
// doesn't require uploading artwork.
export default function CuratedProductCard({ product }: { product: CuratedProduct }) {
  const query = `?style=${encodeURIComponent(product.styleNumber)}&type=${product.productType}`;
  return (
    <div className="group border-2 border-navy/10 rounded-2xl bg-white overflow-hidden hover:border-red hover:shadow-md transition flex flex-col">
      <div className="relative w-full aspect-square bg-gray p-6">
        <Image
          src={
            product.heroImageIsOverride
              ? product.heroImageUrl
              : productImageUrl(product.heroImageUrl, product.heroImageFallbackUrl)
          }
          alt={product.productName}
          fill
          unoptimized
          className="object-contain"
          sizes="(max-width: 640px) 100vw, 25vw"
        />
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="text-xs uppercase tracking-wide text-navy/40">
          {product.brandName} · {product.styleNumber}
        </div>
        <div className="font-semibold text-navy mt-0.5 leading-tight">{product.productName}</div>
        <div className="mt-2 text-sm text-navy/60">
          Starting at <span className="font-semibold text-black">{formatUSD(product.basePrice)}</span>
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          {product.designEnabled && (
            <Link
              href={`/customize${query}`}
              className="flex-1 text-center px-3 py-2 rounded-full bg-red text-white text-sm font-semibold hover:bg-navy transition"
            >
              Design Now
            </Link>
          )}
          {product.quoteEnabled && (
            <Link
              href={`/quote${query}`}
              className={`flex-1 text-center px-3 py-2 rounded-full text-sm font-semibold border transition ${
                product.designEnabled
                  ? "border-navy/20 text-navy hover:bg-navy/5"
                  : "bg-navy text-white hover:bg-navy/90"
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
