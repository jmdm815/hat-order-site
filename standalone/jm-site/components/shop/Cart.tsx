"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cleanCart, money, priceCart, shop, type CartItem, type Fulfillment } from "@/shop/pricing";

const CHECKOUT_URL = process.env.NEXT_PUBLIC_SHOP_CHECKOUT_URL || "https://hat-order-site.vercel.app/api/shop/checkout";
const KEY = "jm-cart-v1";

type CartState = {
  items: CartItem[];
  fulfillment: Fulfillment;
  open: boolean;
  count: number;
  add: (slug: string, qty: number) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  setFulfillment: (f: Fulfillment) => void;
  setOpen: (o: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<CartState | null>(null);

export function useCart(): CartState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [open, setOpen] = useState(false);
  const loaded = useRef(false);

  // Restore the cart once on the client; storage can be missing or blocked.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setItems(cleanCart(saved.items ?? []));
        if (saved.fulfillment === "pickup" || saved.fulfillment === "ship") setFulfillment(saved.fulfillment);
      }
    } catch {
      /* start empty */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ items, fulfillment }));
    } catch {
      /* not saved; the cart still works for this visit */
    }
  }, [items, fulfillment]);

  const add = useCallback((slug: string, qty: number) => {
    setItems((cur) => cleanCart([...cur, { slug, qty }]));
    setOpen(true);
  }, []);
  const setQty = useCallback((slug: string, qty: number) => {
    setItems((cur) => cleanCart(cur.map((i) => (i.slug === slug ? { slug, qty } : i))));
  }, []);
  const remove = useCallback((slug: string) => setItems((cur) => cur.filter((i) => i.slug !== slug)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartState>(
    () => ({
      items,
      fulfillment,
      open,
      count: items.reduce((n, i) => n + i.qty, 0),
      add,
      setQty,
      remove,
      setFulfillment,
      setOpen,
      clear,
    }),
    [items, fulfillment, open, add, setQty, remove, clear]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CartDrawer />
    </Ctx.Provider>
  );
}

export function CartButton() {
  const { count, setOpen } = useCart();
  return (
    <button className="cart-btn" onClick={() => setOpen(true)} aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 7h14l-1.2 12.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7z" />
        <path d="M9 10V6a3 3 0 0 1 6 0v4" />
      </svg>
      {count > 0 && <span className="cart-count">{count}</span>}
    </button>
  );
}

function CartDrawer() {
  const { items, fulfillment, setFulfillment, open, setOpen, setQty, remove } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const priced = priceCart(items, fulfillment);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [open, setOpen]);

  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(CHECKOUT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, fulfillment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout isn't available right now.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout isn't available right now.");
      setBusy(false);
    }
  }

  return (
    <div className={open ? "drawer-wrap open" : "drawer-wrap"} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={() => setOpen(false)} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Your cart" tabIndex={-1} ref={panel} inert={!open}>
        <div className="drawer-head">
          <h2>Your cart</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close cart">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {priced.lines.length === 0 ? (
          <div className="drawer-empty">
            <p>Your cart is empty.</p>
            <a className="btn btn-red" href="/shop" onClick={() => setOpen(false)}>
              Browse the shop
            </a>
          </div>
        ) : (
          <>
            <ul className="cart-lines">
              {priced.lines.map(({ product, qty, lineCents }) => (
                <li key={product.slug}>
                  <img src={product.images[0]} alt="" width={72} height={90} />
                  <div className="cart-line-main">
                    <a href={`/shop/${product.slug}`} onClick={() => setOpen(false)}>
                      {product.name}
                    </a>
                    <span className="muted">{product.color}</span>
                    <div className="cart-line-row">
                      <Stepper value={qty} onChange={(q) => setQty(product.slug, q)} label={product.name} />
                      <button className="link-btn" onClick={() => remove(product.slug)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <strong>{money(lineCents)}</strong>
                </li>
              ))}
            </ul>

            <fieldset className="fulfil">
              <legend>How do you want it?</legend>
              <label className={fulfillment === "ship" ? "on" : ""}>
                <input type="radio" name="fulfil" checked={fulfillment === "ship"} onChange={() => setFulfillment("ship")} />
                <span>
                  <b>Ship it</b>
                  <small>{shop.shipping.note}</small>
                </span>
                <em>{money(priceCart(items, "ship").shippingCents)}</em>
              </label>
              <label className={fulfillment === "pickup" ? "on" : ""}>
                <input type="radio" name="fulfil" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} />
                <span>
                  <b>{shop.pickup.label}</b>
                  <small>{shop.pickup.note}</small>
                </span>
                <em>{money(0)}</em>
              </label>
            </fieldset>

            <dl className="totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(priced.subtotalCents)}</dd>
              </div>
              <div>
                <dt>{fulfillment === "ship" ? "Shipping" : "Pickup"}</dt>
                <dd>{money(priced.shippingCents)}</dd>
              </div>
              <div>
                <dt>Sales tax ({shop.taxRatePercent}%)</dt>
                <dd>{money(priced.taxCents)}</dd>
              </div>
              <div className="grand">
                <dt>Total</dt>
                <dd>{money(priced.totalCents)}</dd>
              </div>
            </dl>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-red checkout-btn" onClick={checkout} disabled={busy}>
              {busy ? "Opening secure checkout…" : "Check out"}
            </button>
            <p className="secure-note">You'll pay on Square's secure checkout page.{fulfillment === "ship" ? " You'll enter your shipping address there." : ""}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="One less">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= shop.maxPerItem} aria-label="One more">
        +
      </button>
    </div>
  );
}
