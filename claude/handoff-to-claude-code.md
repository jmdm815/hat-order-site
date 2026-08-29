# Handoff: hat-order-site

Orientation doc for a fresh Claude Code session on this repo. Everything below
was verified by reading the code at commit `a5d8c2f`. Facts that are **not**
recoverable from the repo are marked **UNKNOWN** rather than guessed — ask
before assuming.

> **Note on `claude/deployment-status.md`.** An earlier Cowork session wrote a
> deployment-status doc, but it was never committed — it does not exist in this
> repo. If you find a copy in a local working tree on the Mac, treat it as
> **historical**: it predates the auto-deploy setup and the decoration-types
> rewrite, and its deploy instructions are obsolete. This file supersedes it.

## What this is

A Next.js 16 (App Router, React 19, Tailwind v4) storefront for **JM Digital
Media** selling custom-decorated hats and t-shirts. A customer walks a guided
flow — pick a blank garment, pick a decoration method, place artwork, set
quantities, cart, checkout. There's also an admin tool at `/admin` for curating
the catalog and configuring decorations.

- Repo: `jmdm815/hat-order-site` (**public**)
- Local path on the Mac: `~/Sites/hat-order-site`
- Live URL: **UNKNOWN** — nothing in the repo records it. Vercel project/team
  IDs live in `.vercel/`, which is gitignored.
- Deploys: pushes to `main` auto-deploy to Vercel. Verified end-to-end — see
  the `x-autodeploy-test` marker in `app/layout.tsx:28` (safe to delete).

## Getting started

```bash
git clone https://github.com/jmdm815/hat-order-site.git
cd hat-order-site
npm install
npm run dev     # http://localhost:3000
npm run build   # the only real verification gate — no test suite
npm run lint
```

A clean clone with **no env vars at all** builds successfully (verified against
`a5d8c2f`) — every route compiles and the app runs in demo mode.

**`.env*` is gitignored, so a fresh clone has no `.env.local`.** The README's
claim that "`.env.local` is populated with your sandbox Application ID/Access
Token" is true only of the Mac working tree, not of a clone. Everything still
runs without it: no Square keys means checkout falls into demo mode, and no
Blob token means admin edits are in-memory only.

| Variable | Effect when missing |
|---|---|
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` | Checkout simulates every card/Afterpay order (`status: "demo_simulated"`) |
| `SQUARE_ENVIRONMENT` | Defaults to Sandbox |
| `NEXT_PUBLIC_SQUARE_APP_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID`, `NEXT_PUBLIC_SQUARE_ENVIRONMENT` | Client-side Web Payments SDK can't tokenize |
| `BLOB_READ_WRITE_TOKEN` | All four admin stores fall back to in-memory — edits vanish on redeploy/cold start |
| `ADMIN_PASSWORD` | Falls back to a hardcoded default — **see security note below** |
| `SANMAR_CATALOG_URL` | Falls back to `https://apparel-quotes.vercel.app/api/public/sanmar-catalog` |

## Architecture

**Catalog** — `lib/sanmar.ts` is the single seam to product data. `getCatalog()`
and `getProductByStyleNumber()` fetch a live SanMar feed from
`SANMAR_CATALOG_URL` and map it onto the `Product` type in `lib/types.ts`. No
page or component touches product data any other way, so swapping the feed (for
a direct PromoStandards integration, say) means editing this one file.

**Admin config stores** — four modules, all the same shape: a single JSON blob
in Vercel Blob, with an in-memory fallback and an `isPersistent()` reporter.

| Module | Blob key | Holds |
|---|---|---|
| `lib/catalog-selection.ts` | `catalog-selection.json` | Which styles are hidden from the catalog (visible by default) |
| `lib/decoration-types-store.ts` | `decoration-types.json` | Full decoration-type definitions — CRUD |
| `lib/item-config-store.ts` | `item-config.json` | Per-style enabled decorations, placement zones, photo overrides |
| `lib/pricing-store.ts` | (separate keys) | Site-wide live-designer on/off toggles |

Blobs are **private**, so reads pass `Authorization: Bearer $BLOB_READ_WRITE_TOKEN`
explicitly — an unauthenticated fetch of a blob URL 403s.

**Decoration types** are fully admin-editable (add/edit/delete, hat/shirt
availability, accepted file types, turnaround, setup fee, quantity tiers). Four
seed types ship in `SEED_DECORATION_TYPES`: `uv-patch`, `engraved-patch`,
`embroidered`, `screen-print`. Because they're editable, `DecorationType` is a
plain `string`, not a union — don't narrow it. `decoration-types-store.ts` also
carries a one-time migration that folds the legacy `pricing-overrides.json`
blob's setup fees and tiers into the new records on first load.

**Placement zones** — `PlacementZone` is a percent-based rect (`x`/`y`/`width`/
`height`, 0–100, top-left origin) tagged `view: "front" | "back"`. Admins draw
them per item per decoration type in `AdminItemConfigEditor` via
`DragResizeBox`. `ArtworkPlacement` and `DesignLayer` use the same
percent-of-zone convention.

**Shirt vs hat flows differ.** Hats use the legacy single-decoration path
(`CartLine.decoration`); shirts use `CartLine.printLocations` — an array where
each entry is one decoration method at one zone, with its own layers, unit
price, and setup fee, summed into the line. `ShirtCustomizeForm` is the live
drag/resize designer; hats use `CustomizeForm`.

**Orders are not durably stored.** `lib/orders-store.ts` writes JSON to
`os.tmpdir()` on Vercel — different serverless instances get different `/tmp`,
so it's a same-instance log, not a source of truth. `/api/checkout` therefore
returns the full order object in its response, and the confirmation page renders
from that via sessionStorage rather than re-fetching by id.

**Admin UI** — `/admin` is server-rendered, gated by `isAdminAuthed()`, with
three tabs: Catalog, Pricing, Settings.

## What shipped in the last session

Three commits, all on `main`:

- `70e319f` — decoration types made fully admin-editable (add/edit/delete),
  live-designer toggles, admin Settings tab.
- `022cf5a` — auto-deploy verification marker.
- `a5d8c2f` — three shirt-designer fixes: the print-location label now sits
  above its box instead of overlapping uploaded artwork; a garment side can
  carry only one decoration type at a time; the Back view was unreachable on
  mobile; and the admin editor no longer demands a real back photo before
  letting you manage back-view zones.

## Security notes — read before deploying

1. **The default admin password is hardcoded in a public repo.**
   `lib/admin-auth.ts:15` sets `DEFAULT_PASSWORD = "jmhats2026"`, used whenever
   `ADMIN_PASSWORD` is unset. This repo is public, so that value is world-
   readable. Set `ADMIN_PASSWORD` in Vercel **and** rotate it, and consider
   removing the fallback so a missing env var fails closed instead of open.
2. The admin gate is a single shared password in an httpOnly cookie whose value
   is the literal string `"ok"` — anyone who can set that cookie is an admin.
   Fine for keeping casual visitors out of catalog curation; not real auth.
3. `/api/checkout` has no rate limiting and only shallow validation (non-empty
   cart, present email). **Prices arrive from the client** — `subtotal`,
   `setupFees`, and `total` are taken from the request body and charged as-is.
   Recompute them server-side before taking real money.

## Known gaps

- **Shirts have no back-view print zones by default.** `synthesizeDefaultItemConfig`
  in `lib/default-item-config.ts` seeds exactly one front `"Front Center"` zone
  per decoration type. Back zones must be drawn per item in the admin editor.
- **Production payments are not connected.** Square is wired and verified
  against *Sandbox* (test location `LGY1V85ENC9PX`). Going live means swapping
  in Production credentials and flipping both `SQUARE_ENVIRONMENT` and
  `NEXT_PUBLIC_SQUARE_ENVIRONMENT` to `production`.
- **Klarna and Affirm are stubbed.** `/api/checkout` simulates approval for
  both (`status: "awaiting_bnpl_redirect"`). Square has no native integration;
  each needs its own merchant account and hosted-checkout redirect.
- **Zelle is manual by design** — no merchant API exists. Orders land as
  `awaiting_zelle_confirmation` and you reconcile in your banking app.
- **No order persistence and no order admin view.** Needs a real database
  before taking real orders.
- **No tests.** `npm run build` and `npm run lint` are the whole safety net.
- **The README is partly stale.** It calls the SanMar catalog "Mock data" —
  `lib/sanmar.ts` has since moved to a live feed. It also describes
  `data/orders.json` as the order store without the serverless caveat above.

## Conventions

- Path alias `@/*` → repo root. TypeScript strict.
- Tailwind v4 via `@tailwindcss/postcss`. Brand tokens `bg-cream`, `text-navy`;
  headings use `font-heading` (Oswald).
- `next.config.ts` allow-lists remote images from `images.unsplash.com` and
  `cdnm.sanmar.com` — a new image host needs a `remotePatterns` entry.
- `AGENTS.md` carries a Next.js-generated block warning that this Next version
  differs from training data; `next dev` rewrites it, so commit it with your
  work rather than reverting it.
- Adding a decoration type is a **runtime** admin action, not a code change.
  Don't reintroduce hardcoded decoration constants.
