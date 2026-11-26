import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { activeProducts, money, shop, toCents } from "@/shop/pricing";

export const metadata: Metadata = {
  title: "Products | JM Digital Media",
  description: "Printed tumblers and gear from our Rosenberg, TX shop. Orders ship or are ready to pick up in 3 to 5 business days.",
};

export default function ShopPage() {
  const products = activeProducts();
  return (
    <>
      <Header />
      <main id="top">
        <section className="shop-hero">
          <div className="wrap">
            <h1 className="display">Products</h1>
            <p className="lede">
              Made in our Rosenberg shop. Orders ship or are ready to pick up in 3 to 5 business days.
            </p>
          </div>
        </section>
        <hr className="stitch" />
        <section className="section shop-list">
          <div className="wrap">
            <ul className="product-grid">
              {products.map((p) => (
                <li key={p.slug}>
                  <a className="product-card" href={`/shop/${p.slug}`}>
                    <div className="product-photo">
                      <img src={p.images[0]} alt={p.imageAlt} width={960} height={1200} />
                    </div>
                    <div className="product-meta">
                      <h2>{p.name}</h2>
                      <span className="muted">{p.color}</span>
                      <strong>{money(toCents(p.price))}</strong>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
            <p className="shop-terms">
              Shipping is {money(toCents(shop.shipping.firstItem))} for the first item and {money(toCents(shop.shipping.eachAdditional))} for each extra item.
              Pickup in Rosenberg is by appointment. Need your logo on these? <a href="/#quote">Ask for a quote</a>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
