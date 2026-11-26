"use client";

import { useEffect } from "react";
import { useCart } from "./Cart";

/** Empties the cart once the customer lands back from Square's checkout. */
export default function ClearCart() {
  const { clear } = useCart();
  useEffect(() => {
    // Child effects run before the provider restores the saved cart, so
    // drop the saved copy first; clear() covers an already-loaded cart.
    try {
      localStorage.removeItem("jm-cart-v1");
    } catch {
      /* storage unavailable */
    }
    clear();
  }, [clear]);
  return null;
}
