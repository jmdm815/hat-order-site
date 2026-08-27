import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getSquareClient, getSquareLocationId, isSquareConfigured } from "@/lib/square-client";
import { saveOrder, OrderRecord } from "@/lib/orders-store";
import { CartLine, CustomerInfo, PaymentMethodId } from "@/lib/types";

type CheckoutBody = {
  cart: CartLine[];
  customer: CustomerInfo;
  paymentMethod: PaymentMethodId;
  subtotal: number;
  setupFees: number;
  total: number;
  squareSourceId?: string; // card/afterpay nonce from the Web Payments SDK
};

// The order object is returned directly in the response (not just its id)
// so the client can render the confirmation page from it immediately —
// this API route may run on a different serverless instance per request,
// so a same-instance file lookup by id is not reliable. See lib/orders-store.ts.
function respond(order: OrderRecord) {
  saveOrder(order);
  return NextResponse.json({ order });
}

export async function POST(req: NextRequest) {
  const body: CheckoutBody = await req.json();
  const { cart, customer, paymentMethod, subtotal, setupFees, total } = body;

  if (!cart?.length) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }
  if (!customer?.email) {
    return NextResponse.json({ error: "Customer info is required" }, { status: 400 });
  }

  const orderId = uuid();
  const baseOrder: Omit<OrderRecord, "status" | "paymentReference" | "notes"> = {
    id: orderId,
    createdAt: new Date().toISOString(),
    cart,
    customer,
    paymentMethod,
    subtotal,
    setupFees,
    total,
  };

  try {
    if (paymentMethod === "card" || paymentMethod === "afterpay") {
      // --- Square: Card and Afterpay both flow through the same Payments API
      // once the Web Payments SDK on the client has tokenized the source
      // (a card nonce for "card", an Afterpay-approved nonce for "afterpay").
      if (!isSquareConfigured()) {
        // Demo mode: no SQUARE_ACCESS_TOKEN/SQUARE_LOCATION_ID set for this
        // deployment — every order is a simulated sample order, never a
        // real charge.
        return respond({
          ...baseOrder,
          status: "demo_simulated",
          paymentReference: `DEMO-${orderId.slice(0, 8)}`,
          notes:
            "Sample order — Square isn't connected on this deployment, so this was simulated, not charged.",
        });
      }

      if (!body.squareSourceId) {
        return NextResponse.json(
          { error: "Missing payment source from Square Web Payments SDK" },
          { status: 400 }
        );
      }

      const client = getSquareClient();
      const result = await client.payments.create({
        sourceId: body.squareSourceId,
        idempotencyKey: orderId,
        amountMoney: {
          amount: BigInt(Math.round(total * 100)),
          currency: "USD",
        },
        locationId: getSquareLocationId(),
        referenceId: orderId,
        note: `Custom hat order ${orderId.slice(0, 8)} (${paymentMethod})`,
      });

      return respond({
        ...baseOrder,
        status: "paid",
        paymentReference: result.payment?.id,
      });
    }

    if (paymentMethod === "klarna" || paymentMethod === "affirm") {
      // --- Klarna / Affirm are NOT part of Square's checkout. Each needs its
      // own merchant account + API keys and its own hosted redirect flow:
      //   Klarna: Klarna Payments API (create a payment session, redirect to
      //           Klarna's hosted checkout, then confirm on return).
      //   Affirm: Affirm Checkout API (create a checkout token client-side
      //           with Affirm.js, confirm the charge server-side on return).
      // Neither is wired to real credentials in this prototype, so we
      // record the order as awaiting a BNPL redirect and simulate approval.
      return respond({
        ...baseOrder,
        status: "awaiting_bnpl_redirect",
        paymentReference: `${paymentMethod.toUpperCase()}-DEMO-${orderId.slice(0, 8)}`,
        notes: `Sample order — ${
          paymentMethod === "klarna" ? "Klarna" : "Affirm"
        } isn't wired to a real merchant account in this prototype.`,
      });
    }

    if (paymentMethod === "zelle") {
      // --- Zelle has no merchant/checkout API of any kind — it is strictly
      // bank-to-bank via a banking app. We record the order as pending and
      // show the customer your Zelle-registered email/phone plus the order
      // number to use as the payment memo; you confirm receipt manually in
      // your bank's Zelle activity and mark the order paid from your admin
      // tools (not built in this prototype).
      return respond({
        ...baseOrder,
        status: "awaiting_zelle_confirmation",
        notes: "Sample order — customer instructed to send payment via Zelle manually.",
      });
    }

    return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
  } catch (err) {
    console.error("Checkout error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 500 }
    );
  }
}
