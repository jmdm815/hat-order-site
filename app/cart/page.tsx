"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepHeader from "@/components/StepHeader";
import { useOrder } from "@/lib/order-context";
import { DecorationOption, Product } from "@/lib/types";
import { getDecoration } from "@/lib/decorations";
import { formatUSD } from "@/lib/pricing";

export default function CartPage() {
  const router = useRouter();
  const { cart, removeCartLine, updateCartLineQuantity, cartSubtotal, cartSetupFees, cartTotal, totalUnits } =
    useOrder();
  const [products, setProducts] = useState<Product[]>([]);
  const [decorations, setDecorations] = useState<DecorationOption[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/catalog?type=hat").then((r) => r.json()),
      fetch("/api/catalog?type=shirt").then((r) => r.json()),
    ]).then(([hats, shirts]) => setProducts([...hats, ...shirts]));
    fetch("/api/decorations")
      .then((r) => r.json())
      .then(setDecorations);
  }, []);

  return (
    <>
      <StepHeader />
      <main className="flex-1 max-w-4xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-navy">Review your order</h1>

        {cart.length === 0 ? (
          <div className="mt-10 text-center border border-dashed border-navy/20 rounded-2xl py-16">
            <p className="text-navy/60">Your cart is empty.</p>
            <Link
              href="/catalog"
              className="mt-4 inline-block px-6 py-2.5 rounded-full bg-navy text-white font-medium"
            >
              Browse the catalog
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-4">
              {cart.map((line) => {
                const product = products.find((p) => p.styleNumber === line.styleNumber);
                const isShirtLine = Boolean(line.printLocations);

                if (isShirtLine) {
                  return (
                    <div key={line.id} className="border border-navy/10 rounded-xl bg-white p-4">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        <div className="flex-1">
                          <div className="font-semibold text-navy">
                            {product?.productName ?? line.styleNumber} — {line.colorName}
                          </div>
                          <div className="text-sm text-navy/60 mt-0.5">
                            {line.printLocations!.length} print{" "}
                            {line.printLocations!.length === 1 ? "location" : "locations"}:{" "}
                            {line.printLocations!
                              .map(
                                (loc) =>
                                  `${loc.zoneLabel} (${getDecoration(decorations, loc.decorationId)?.shortLabel ?? loc.decorationId})`
                              )
                              .join(", ")}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(line.sizes ?? []).map((s) => (
                              <span
                                key={s.size}
                                className="text-xs px-2 py-0.5 rounded bg-navy/5 text-navy/70"
                              >
                                {s.size}-{s.quantity}
                              </span>
                            ))}
                          </div>
                          {line.notes && (
                            <p className="mt-2 text-xs text-navy/50 italic">&ldquo;{line.notes}&rdquo;</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-navy">{formatUSD(line.lineTotal)}</div>
                          <div className="text-xs text-navy/40 mt-0.5">{line.quantity} items</div>
                          <button
                            onClick={() => removeCartLine(line.id)}
                            className="mt-1 text-xs text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                const decoration = line.decoration
                  ? getDecoration(decorations, line.decoration.decorationId)
                  : undefined;
                return (
                  <div
                    key={line.id}
                    className="border border-navy/10 rounded-xl bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-navy">
                        {product?.productName ?? line.styleNumber} — {line.colorName}
                        {line.size ? ` — ${line.size}` : ""}
                      </div>
                      <div className="text-sm text-navy/60 mt-0.5">
                        {decoration?.shortLabel} · {line.decoration?.placement}
                        {line.decoration?.artworkFileName
                          ? ` · ${line.decoration.artworkFileName}`
                          : ""}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <label className="text-sm text-navy/60">Qty</label>
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            updateCartLineQuantity(
                              line.id,
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="w-20 border border-navy/20 rounded-lg px-2 py-1 text-sm"
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-navy">
                        {formatUSD(line.lineTotal)}
                      </div>
                      <button
                        onClick={() => removeCartLine(line.id)}
                        className="mt-1 text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <Link
              href="/catalog"
              className="mt-4 inline-block text-sm font-medium text-navy/80 hover:underline"
            >
              + Add another item
            </Link>

            <div className="mt-8 border border-navy/10 rounded-xl bg-white p-5">
              <div className="flex justify-between text-sm text-navy/70">
                <span>{totalUnits} items — subtotal</span>
                <span>{formatUSD(cartSubtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-navy/70 mt-1">
                <span>Setup fees</span>
                <span>{formatUSD(cartSetupFees)}</span>
              </div>
              <div className="flex justify-between font-semibold text-lg text-navy mt-3 pt-3 border-t border-navy/10">
                <span>Order total</span>
                <span>{formatUSD(cartTotal)}</span>
              </div>

              <button
                onClick={() => router.push("/checkout")}
                className="mt-5 w-full py-3 rounded-full bg-navy text-white font-semibold hover:bg-red transition"
              >
                Continue to Checkout →
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
