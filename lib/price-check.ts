import type { ComputedQuote } from "./quote";

// House rule (Nov 2026): a quote never goes to a customer priced from
// SanMar's catalog LIST price — only from this account's live price (via
// the pricing API) or a cost the admin entered after checking the SanMar
// account. computeQuote tags each SanMar size with costSource; "catalog"
// means the live lookup failed and nobody has entered the cost yet.
export type UnconfirmedItem = { label: string; sizes: string[] };

export function unconfirmedSanmarCosts(computed: ComputedQuote | undefined): UnconfirmedItem[] {
  const out: UnconfirmedItem[] = [];
  for (const line of computed?.lines ?? []) {
    const sizes = line.sizes.filter((s) => s.costSource === "catalog").map((s) => s.size);
    if (sizes.length) {
      out.push({ label: [line.styleNumber, line.colorName].filter(Boolean).join(" "), sizes });
    }
  }
  return out;
}

export function unconfirmedCostMessage(items: UnconfirmedItem[]): string {
  const list = items.map((i) => `${i.label} (${i.sizes.join(", ")})`).join("; ");
  return (
    `Not sent: ${list} ${items.length > 1 ? "don't" : "doesn't"} have your live SanMar account price yet. ` +
    `Enter the cost from your SanMar account in the Cost column (or re-save the quote to retry the live price), then try again.`
  );
}
