import { put, list } from "@vercel/blob";
import { isPersistent } from "./pricing-store";
import { getSquareClient, getSquareLocationId } from "./square-client";
import type { QuoteRecord } from "./quotes-store";

// ---------------------------------------------------------------------------
// Cards on file
// ---------------------------------------------------------------------------
// Square stores the actual card (Cards API, linked to a Square customer).
// This site only keeps Square's ids plus brand / last 4 / expiry so the pay
// page and admin can show "Visa •••• 4242" and charge it again.
//
//   - A card is saved only when the customer ticks "Save this card for
//     future orders" on the pay page; it's created from that successful
//     payment (Square accepts a card payment id as the card source).
//   - Cards are grouped by the admin customer the quote/invoice belongs to
//     (QuoteInput.customerId), or by email when a record has no customer.
//   - Charging a saved card: the customer from their pay page ("Pay with
//     Visa •••• 4242"), or the admin from the invoice payment modal.
//
// Blob: saved-cards.json → Record<key, CustomerCards>.
// ---------------------------------------------------------------------------

export type SavedCard = {
  id: string; // Square card id
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  savedAt: string;
  savedFrom?: string; // invoice/quote number it was saved from
};

type CustomerCards = { squareCustomerId: string; name?: string; cards: SavedCard[] };

const BLOB_PATHNAME = "saved-cards.json";
let memory: Record<string, CustomerCards> | null = null;

async function readAll(): Promise<Record<string, CustomerCards>> {
  if (!isPersistent()) return memory ?? {};
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const match = blobs.find((b) => b.pathname === BLOB_PATHNAME);
    if (!match) return {};
    const res = await fetch(`${match.url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    return res.ok ? ((await res.json()) as Record<string, CustomerCards>) : {};
  } catch (err) {
    console.error("saved-cards-store: read failed", err);
    return {};
  }
}

async function writeAll(data: Record<string, CustomerCards>) {
  memory = data;
  if (!isPersistent()) return;
  await put(BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export function cardKeyForRecord(record: QuoteRecord): string | null {
  if (record.input.customerId) return record.input.customerId;
  const email = record.computed.customerEmail?.trim().toLowerCase();
  return email ? `email:${email}` : null;
}

const notExpired = (c: SavedCard) => {
  const now = new Date();
  return c.expYear > now.getFullYear() || (c.expYear === now.getFullYear() && c.expMonth >= now.getMonth() + 1);
};

export async function getSavedCards(key: string | null): Promise<SavedCard[]> {
  if (!key) return [];
  return ((await readAll())[key]?.cards ?? []).filter(notExpired);
}

const shortKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 45);

// Saves the card from a just-completed card payment to this record's customer.
export async function saveCardFromPayment(record: QuoteRecord, squarePaymentId: string): Promise<SavedCard> {
  const key = cardKeyForRecord(record);
  if (!key) throw new Error("This invoice has no customer or email to save the card to.");
  const client = getSquareClient();
  const all = await readAll();
  let entry = all[key];
  if (!entry) {
    const c = record.computed;
    const res = await client.customers.create({
      idempotencyKey: shortKey("cust"),
      companyName: c.customerCompany || undefined,
      givenName: c.customerName || undefined,
      emailAddress: c.customerEmail || undefined,
      referenceId: key.slice(0, 40),
      note: "Created by the JM Digital Media admin for cards on file",
    });
    if (!res.customer?.id) throw new Error("Square didn't create the customer.");
    entry = { squareCustomerId: res.customer.id, name: c.customerCompany || c.customerName, cards: [] };
  }
  const res = await client.cards.create({
    idempotencyKey: shortKey("card"),
    sourceId: squarePaymentId,
    card: { customerId: entry.squareCustomerId, referenceId: record.id.slice(0, 40) },
  });
  const card = res.card;
  if (!card?.id) throw new Error("Square didn't save the card.");
  const saved: SavedCard = {
    id: card.id,
    brand: String(card.cardBrand ?? "Card").replace(/_/g, " "),
    last4: card.last4 ?? "????",
    expMonth: Number(card.expMonth ?? 0),
    expYear: Number(card.expYear ?? 0),
    savedAt: new Date().toISOString(),
    savedFrom: record.invoiceNumber ?? record.quoteNumber,
  };
  // Re-read before writing so a concurrent save isn't lost.
  const fresh = await readAll();
  const cur = fresh[key] ?? entry;
  const others = cur.cards.filter((x) => !(x.last4 === saved.last4 && x.expMonth === saved.expMonth && x.expYear === saved.expYear && x.brand === saved.brand));
  fresh[key] = { ...cur, squareCustomerId: entry.squareCustomerId, cards: [...others, saved] };
  await writeAll(fresh);
  return saved;
}

export async function removeSavedCard(key: string, cardId: string): Promise<void> {
  const all = await readAll();
  const entry = all[key];
  if (!entry) return;
  try {
    await getSquareClient().cards.disable({ cardId });
  } catch (err) {
    console.error("saved-cards-store: Square disable failed (removing locally anyway)", err);
  }
  all[key] = { ...entry, cards: entry.cards.filter((c) => c.id !== cardId) };
  await writeAll(all);
}

// Charges a saved card for a record. Validates the card belongs to the
// record's customer. Returns the Square payment id.
export async function chargeSavedCard(record: QuoteRecord, cardId: string, amount: number, note: string): Promise<{ paymentId: string; card: SavedCard }> {
  const key = cardKeyForRecord(record);
  const all = await readAll();
  const entry = key ? all[key] : undefined;
  const card = entry?.cards.find((c) => c.id === cardId);
  if (!entry || !card) throw new Error("That saved card isn't on file for this customer.");
  if (!notExpired(card)) throw new Error("That saved card has expired.");
  const res = await getSquareClient().payments.create({
    sourceId: card.id,
    customerId: entry.squareCustomerId,
    idempotencyKey: `${record.id.slice(0, 8)}-sc-${Date.now()}`,
    amountMoney: { amount: BigInt(Math.round(amount * 100)), currency: "USD" },
    locationId: getSquareLocationId(),
    referenceId: record.id,
    note,
  });
  if (!res.payment?.id) throw new Error("Square did not return a payment confirmation");
  return { paymentId: res.payment.id, card };
}

export const cardLabel = (c: SavedCard) => `${c.brand.charAt(0)}${c.brand.slice(1).toLowerCase()} •••• ${c.last4}`;
