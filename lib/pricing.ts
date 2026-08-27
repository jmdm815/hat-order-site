import { CartLine } from "./types";

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function cartLineTotal(line: CartLine): number {
  return line.quantity * (line.unitBasePrice + line.unitDecorationPrice) + line.setupFee;
}
