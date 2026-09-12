import { GarmentMarkupBreakpoint } from "./types";

// Finds the markup percentage for a given blank-garment vendor cost by
// matching it against the admin-configured breakpoint matrix (see
// lib/garment-markup-store.ts). Breakpoints are checked in the order given;
// a cost is "in" a breakpoint when from <= cost <= to. If no breakpoint
// matches (e.g. the table doesn't cover this cost, or is empty), no markup
// is applied — this keeps a misconfigured/blank table a safe no-op rather
// than silently zeroing out or inflating garment prices.
export function getMarkupPercentForCost(
  breakpoints: GarmentMarkupBreakpoint[],
  cost: number
): number {
  const match = breakpoints.find((bp) => cost >= bp.from && cost <= bp.to);
  return match ? match.markupPercent : 0;
}

// Applies that markup to a raw vendor cost, rounded the same way the rest of
// the quote engine rounds money (2 decimals).
export function applyGarmentMarkup(cost: number, breakpoints: GarmentMarkupBreakpoint[]): number {
  const percent = getMarkupPercentForCost(breakpoints, cost);
  return Math.round(cost * (1 + percent / 100) * 100) / 100;
}
