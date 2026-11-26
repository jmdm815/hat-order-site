"use client";

import { useState } from "react";
import { Stepper, useCart } from "./Cart";

export default function AddToCart({ slug, name }: { slug: string; name: string }) {
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  return (
    <div className="buy-row">
      <Stepper value={qty} onChange={setQty} label={name} />
      <button className="btn btn-red" onClick={() => add(slug, qty)}>
        Add to cart
      </button>
    </div>
  );
}
