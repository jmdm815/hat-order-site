import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AddToCart from "@/components/shop/AddToCart";
import { activeProducts, findProduct, money, shop, toCents } from "@/shop/pricing";

export const dynamicParams = false;

export function generateStaticParams() {
  return activeProducts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = findProduct((await params).slug);
  if (!p) return {};
  return {
    title: `${p.name} | JM Digital Media Shop`,
    description: p.summary,
    openGraph: { title: p.name, description: p.summary, images: [p.images[0]] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = findProduct((await params).slug);
  if (!p) notFound();
  return (
    <>
      <Header />
      <main id="top" className="pdp">
        <div className="wrap">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href="/shop">Shop</a> <span aria-hidden="true">/</span> <span>{p.name}</span>
          </nav>
          <div className="pdp-grid">
            <div className="pdp-photo">
              <img src={p.images[0]} alt={p.imageAlt} width={960} height={1200} />
            </div>
            <div className="pdp-info">
              <h1 className="display">{p.name}</h1>
              <p className="pdp-price">{money(toCents(p.price))}</p>
              <p className="lede">{p.summary}</p>
              <dl className="pdp-spec">
                <div>
                  <dt>Color</dt>
                  <dd>{p.color}</dd>
                </div>
              </dl>
              <AddToCart slug={p.slug} name={p.name} />
              <hr className="stitch navy" />
              <ul className="pdp-details">
                {p.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <div className="pdp-fulfil">
                <p>
                  <b>Shipping:</b> {money(toCents(shop.shipping.firstItem))} for the first item, {money(toCents(shop.shipping.eachAdditional))} each extra. {shop.shipping.note}
                </p>
                <p>
                  <b>Pickup:</b> {shop.pickup.note}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
