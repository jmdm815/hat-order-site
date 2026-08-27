import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CartLine, CustomerInfo, PaymentMethodId } from "./types";

// ---------------------------------------------------------------------------
// Order persistence — PROTOTYPE ONLY.
// Orders are written to a JSON file on disk purely as a same-instance log.
// On Vercel (or any serverless host) each request can land on a different,
// short-lived instance with its own /tmp, so this file is NOT a reliable
// source of truth across requests — the checkout API returns the full order
// object directly in its response instead (see app/api/checkout/route.ts),
// and the confirmation page reads from that (via sessionStorage) rather
// than re-fetching by ID. Swap this whole module for a real database
// (Postgres, PlanetScale, Supabase, etc.) before this needs to handle real
// orders or an admin view.
// ---------------------------------------------------------------------------

export type OrderRecord = {
  id: string;
  createdAt: string;
  cart: CartLine[];
  customer: CustomerInfo;
  paymentMethod: PaymentMethodId;
  subtotal: number;
  setupFees: number;
  total: number;
  status:
    | "paid"
    | "awaiting_zelle_confirmation"
    | "awaiting_bnpl_redirect"
    | "demo_simulated";
  paymentReference?: string; // Square payment ID, Klarna session id, etc.
  notes?: string;
};

// Writable in every environment: /tmp on serverless (Vercel, AWS Lambda),
// a local "data" folder in normal dev/self-hosted runs.
const DATA_DIR = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? path.join(os.tmpdir(), "hat-order-site")
  : path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "orders.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

// Best-effort only — failures here must never break checkout, since the
// order response itself (not this file) is the source of truth.
export function saveOrder(order: OrderRecord): void {
  try {
    ensureStore();
    const all = readAllOrders();
    all.push(order);
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf-8");
  } catch (err) {
    console.warn("saveOrder: non-fatal persistence failure", err);
  }
}

export function readAllOrders(): OrderRecord[] {
  try {
    ensureStore();
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function getOrder(id: string): OrderRecord | undefined {
  return readAllOrders().find((o) => o.id === id);
}
