import { SquareClient, SquareEnvironment } from "square";

// ---------------------------------------------------------------------------
// Square server-side client — used only inside API routes (never imported
// into client components; SQUARE_ACCESS_TOKEN must stay server-only).
//
// To go live:
//   1. Create a Square application at https://developer.squareup.com/apps
//   2. Grab credentials from the Sandbox tab first, test the whole flow,
//      then switch to Production credentials when you're ready to take
//      real money.
//   3. Set these env vars (.env.local for dev, your host's secret manager
//      for production):
//        SQUARE_ACCESS_TOKEN=...
//        SQUARE_LOCATION_ID=...
//        SQUARE_ENVIRONMENT=sandbox   (or "production")
//        NEXT_PUBLIC_SQUARE_APP_ID=...        (safe to expose, client-side)
//        NEXT_PUBLIC_SQUARE_LOCATION_ID=...   (safe to expose, client-side)
//   4. Afterpay and Cash App Pay ride along automatically once enabled on
//      your Square Dashboard under Payment Methods — no extra code needed
//      beyond what's already wired in components/SquareCardForm.tsx, which
//      requests the "afterpay" and "cashApp" payment methods from the Web
//      Payments SDK alongside "card".
// ---------------------------------------------------------------------------

export function isSquareConfigured(): boolean {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

export function getSquareClient(): SquareClient {
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  return new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN ?? "",
    environment,
  });
}

export function getSquareLocationId(): string {
  return process.env.SQUARE_LOCATION_ID ?? "";
}
