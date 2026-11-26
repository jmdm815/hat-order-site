---
name: "jm-media-operator"
description: "Use for any JM Media work: websites and repos, deploys, quotes and email, mockups, gang sheets, promo videos, Pitbull/SanMar ordering. Holds the standing rules, project map and deploy steps."
---

# JM Media operator playbook

Jhairson owns JM Media (custom apparel decoration in Rosenberg, TX: embroidery, DTF, screen printing, UV printed patches/hats and tumblers). Several sessions may run at once, so finish each piece of work completely (committed, deployed, verified) and never assume another session's in-progress state.

## Standing rules (always)
- Email: create drafts by default. Send only when Jhairson explicitly says to send.
- Never print, reveal or save API keys, passwords or access codes (OpenAI key, partner API key, access codes, inbox connector admin password). Never type secrets into fields; Jhairson pastes them himself.
- Never commit .env / .env.local files.
- Do not acknowledge Coupa POs.
- Pricing: never quote from the SanMar catalog price, and never use Pitbull's public/retail price as cost (only the signed-in price is his cost).
- Pitbull cart and SanMar robot: never check out, never call /cart/remove, never remove items Claude didn't add.
- Never open real quotes in a preview builder; block saves while only viewing.
- Never email customers receipts automatically; Zelle previews go only to purchasing@buyjmmedia.com.
- Don't delete Brittany's quotes.
- Quotes saved by the inbox watcher carry "potential": true.
- Get the customer's permission before using their logo in an ad.
- ElevenLabs: never repeat or regenerate a generation without asking; each call spends credits. Say how many credits were used.
- Instagram captions: at most 5 hashtags.
- Promo videos: ElevenLabs voiceover/music, deliver 9:16 (Reels) and square (feed).
- Don't invent testimonials, stats, turnaround promises or 'free' claims on customer-facing pages.
- Customer contact: purchasing@buyjmmedia.com, text 281-344-1772; pickups by appointment.

## Repos and sites (GitHub owner: jmdm815)
- hat-order-site: main business app (admin, quotes, mockup studio, public /api/inquiry for the website quote form). Deployed on Vercel from main.
  - standalone/jm-site: the new business website (Vercel project jm-media-site, https://jm-media-site.vercel.app). Builds only when that folder changes.
  - standalone/render-studio: JM Render Studio desktop artifact source (build with esbuild via build.mjs, then republish the artifact).
- partner-quote-site: white-label quoting + mockup tool for the partner shop (https://partner-quote-site.vercel.app). AI drawing limited to 20 uses/week per partner.
- image-enhancement: Vector-Sharp Recreator plus the in-browser Vectorizer at /vectorize (https://image-enhancement-ruby.vercel.app). Vectorizer exports SVG only.
- Other repos: la-balance, la-balance-admin, jm-pickup-checkin, contabilidad-app.
- Next.js versions here have breaking changes: read node_modules/next/dist/docs/ before writing Next code, and follow each repo's AGENTS.md.

## Deploy flow (all repos)
1. Work on a branch; run lint/typecheck/build locally and screenshot pages with Playwright (desktop and phone) before shipping.
2. Commit with the author name/email taken from `git log -1` (don't hard-code the email next to client names).
3. Merge --no-ff into main and push (use `git -c push.negotiate=true push` from shallow clones).
4. Poll the commit status (`gh api repos/jmdm815/<repo>/commits/<sha>/statuses`) until success, then check the live URL.
5. Vercel team: jmdm815s-projects. New Vercel projects for a monorepo folder: set rootDirectory and an ignore command so they build only when that folder changes.

## Mac mini
The Mac mini runs 24/7 with the Claude desktop app. Render Studio saves to ~/Documents/JM Renders. On that Mac, child processes can't read files the app wrote with the desktop fs API: pass data through stdin/env instead of temp files.

## How to work
- Start with one sentence on what you'll do, then do it; ask only when a wrong guess is expensive.
- Deliver finished, verified work: live URL, file sent, or draft created. Keep replies short and in plain language.