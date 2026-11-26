import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ClearCart from "@/components/shop/ClearCart";

export const metadata: Metadata = { title: "Thanks for your order | JM Digital Media", robots: { index: false } };

export default async function ThanksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const demo = q.demo === "1";
  const pickup = q.f === "pickup";
  const orderId = q.orderId;
  return (
    <>
      <Header />
      <main id="top" className="thanks section">
        <div className="wrap">
          <ClearCart />
          <h1 className="display">{demo ? "Test order received" : "Thanks for your order"}</h1>
          {demo ? (
            <p className="lede">This was a test checkout. Online payments aren't switched on for this preview, so nothing was charged.</p>
          ) : (
            <p className="lede">
              Square has emailed your receipt.{" "}
              {pickup
                ? "We'll text you when your order is ready to pick up at 815 2nd St, Rosenberg."
                : "We'll email you the tracking number when your order ships."}
            </p>
          )}
          {orderId && <p className="muted order-ref">Order reference: {orderId.slice(0, 12)}</p>}
          <p className="thanks-help">
            Questions? Text <a href="sms:+12813441772">281-344-1772</a> or email <a href="mailto:purchasing@buyjmmedia.com">purchasing@buyjmmedia.com</a>.
          </p>
          <a className="btn btn-red" href="/shop">
            Back to products
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
