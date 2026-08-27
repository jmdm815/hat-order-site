# Custom Hat Ordering Site — Prototype

A working Next.js prototype modeled on order.hatstitch.com: a guided flow
where a customer answers a throwaway yes/no question, picks a blank hat,
chooses one of three decoration methods, sets quantity/placement, reviews
a cart, and checks out.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

**Card payments are already live against your Square Sandbox** — `.env.local`
is populated with your sandbox Application ID/Access Token and a sandbox
test location (`LGY1V85ENC9PX`, Square's "Default Test Account" — not one of
your real JM Media locations, since sandbox tokens can only charge sandbox
locations). Verified end-to-end with Square's test card nonce; the checkout
API returned a real payment ID. Use Square's [sandbox test
cards](https://developer.squareup.com/docs/testing/test-values) when
clicking through the checkout UI. When you're ready for real money, replace
every `SQUARE_*` value in `.env.local` with your **Production** Application
ID, Access Token, and one of your real location IDs (`TKTFDS69EQRRZ` for JM
Media or `LVVM0K0N0EXX9` for Storefront), and flip both `SQUARE_ENVIRONMENT`
and `NEXT_PUBLIC_SQUARE_ENVIRONMENT` to `production`.

Afterpay rides the same Square integration, but only works once Afterpay is
turned on for your location in the Square Dashboard under Payment Methods —
that's a toggle on Square's side, not something in this code.

Everything else still works out of the box in **demo
mode** — no external accounts required to click through the full flow.
Card and Afterpay "payments" are simulated (clearly labeled in the UI) until
you add real Square credentials.

## What's real vs. stubbed right now

| Piece | Status |
|---|---|
| Hat catalog | Mock data shaped exactly like SanMar's product fields (`lib/sanmar.ts`) — swap in your real SanMar API call there |
| UV Patch / Engraved Patch / Embroidered options, placements, quantity-tier pricing | Fully built (`lib/decorations.ts`) |
| Cart, checkout form, order confirmation | Fully built |
| Card payment | Real Square Web Payments SDK integration — activates automatically once Square keys are set; demo-tokenizes otherwise |
| Afterpay | Same as card — rides on Square's Afterpay integration, no extra code needed once enabled in your Square Dashboard |
| Klarna | **Not connected.** Square has no native Klarna integration. Stubbed with a demo "redirect" — see below to wire up real Klarna |
| Affirm | **Not connected.** Same situation as Klarna — stubbed |
| Zelle | **Cannot be automated, by design.** Zelle has no merchant/checkout API anywhere — it's bank-to-bank only. The site collects the order and shows the customer your Zelle-registered email/phone as payment instructions; you confirm receipt manually in your banking app |
| Order storage | Flat JSON file (`data/orders.json`) for this prototype — replace with a real database before going live |

## Going live, step by step

### 1. Square (Card, Afterpay, Cash App Pay)
1. Create an app at https://developer.squareup.com/apps
2. Copy your **Sandbox** Application ID, Access Token, and Location ID first and test the whole flow with a Sandbox test card before touching Production.
3. Copy `.env.local.example` to `.env.local` and fill in:
   ```
   SQUARE_ACCESS_TOKEN=...
   SQUARE_LOCATION_ID=...
   SQUARE_ENVIRONMENT=sandbox
   NEXT_PUBLIC_SQUARE_APP_ID=...
   NEXT_PUBLIC_SQUARE_LOCATION_ID=...
   NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox
   ```
4. In your Square Dashboard, go to **Payment Methods** and turn on Afterpay and Cash App Pay if you want them — no code changes needed, they ride the same integration.
5. When ready for real money, swap in Production credentials and set both `SQUARE_ENVIRONMENT` and `NEXT_PUBLIC_SQUARE_ENVIRONMENT` to `production`.

### 2. SanMar catalog
You mentioned you already have a SanMar wholesale account and API access.
`lib/sanmar.ts` has a `getCatalog()` function with a big comment block at
the top describing exactly what to replace it with — a call to SanMar's
PromoStandards / SanMar Integrated Services (SMIS) endpoints for Product
Data, Media Content, and Pricing, mapped onto the `HatStyle` type in
`lib/types.ts`. Nothing else in the app needs to change; every page reads
through this one function.

### 3. Klarna and Affirm — separate integrations
Since Square doesn't support these, each needs its own merchant account and
its own hosted-checkout redirect flow:
- **Klarna**: sign up at https://developers.klarna.com, use the Klarna
  Payments API to create a session server-side, redirect the customer to
  Klarna's hosted checkout, then confirm the order when they return.
- **Affirm**: sign up at https://docs.affirm.com, use Affirm.js on the
  client to open their checkout modal, then confirm/capture the charge
  server-side with your Affirm private API key.

The checkout UI already has dedicated buttons for both — right now they hit
`/api/checkout` with `paymentMethod: "klarna" | "affirm"` and the route
simulates approval. Replace that branch in `app/api/checkout/route.ts` with
real calls once you have credentials.

### 4. Zelle
There's genuinely no way to make this automatic — no processor, including
Square, can charge a Zelle account programmatically, because Zelle doesn't
expose a merchant API. What's built here is the honest version: the order
is placed as "awaiting confirmation," the confirmation page shows your
Zelle-registered email and the order number to use as a memo, and you mark
it paid by checking your bank's Zelle activity. If that manual step becomes
a bottleneck, consider dropping Zelle from checkout and offering it only for
larger invoiced/wholesale orders instead.

### 5. Before taking real orders
- Swap `data/orders.json` for a real database (Postgres, Supabase, etc.) —
  a flat file won't survive concurrent orders or a redeploy.
- Add server-side input validation and rate limiting to `/api/checkout`.
- Add an admin view to see/manage orders (not built in this prototype).
- Add real order-confirmation emails (e.g. via Resend or SendGrid).
