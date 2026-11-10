# Inbox watcher (scheduled task instructions)

Schedule: every 15 minutes, 7am–7pm Mon–Fri, America/Chicago (fall back to hourly if the
scheduler's minimum interval is longer). Push notification on finish.

Each run is a fresh session; it uses the JM_Email connector and the hat-site API
(`Authorization: Bearer <AGENT_API_KEY>`). It never sends email and never edits existing
quotes/invoices.

1. For inboxes `purchasing` and `business jm`: `search_threads` with
   `newer_than:2d -in:sent -in:spam -in:trash -category:promotions -category:social`.
   Skip threads whose latest message is from buyjmmedia.com.
2. dedupeKey = `email:<inbox>:<latest inbound message id>`;
   `GET /api/admin/shop-tasks?dedupeKey=…` — skip if a task exists.
3. Classify: needs Jhairson (customers, POs, order/quote requests, art approvals, payments,
   pickups, vendors' real questions) → task; automated/marketing/receipts → ignore
   (unsure → low-priority task).
4. Task: `POST /api/admin/shop-tasks` with title, 2–5 line notes, priority (high = deadline
   ≤3 business days, PO, payment/complaint, repeated follow-up), due (their deadline, else
   next business day), account, from, subject, emailUrl, source "email", dedupeKey.
5. Order/quote requests: decipher garments/colors/sizes/decoration/deadline (look up
   styles via /api/admin/quote/search-products and /manual-product; decorations via
   /api/admin/decoration-types), match customer/past quotes, compute
   (`POST /api/admin/quote`) and save (`POST /api/admin/quotes`) with notes starting
   "DRAFT from email — review before sending." + assumptions; PATCH the task with quoteId.
   ALWAYS include `"dedupeKey": "email:<inbox>:<messageId>"` in the save body (same key
   as the task). Save ONCE: if the response has `"duplicate": true` (or a 409), that quote
   already exists — use its record, never save again. Don't re-check the quote list to
   decide whether a save worked; it can lag a few seconds.
   Then `create_draft` (reply_to_message_id) — short, friendly, restates the order, gives the
   price if quoted, asks only for missing details; PATCH task draftReply:true.
6. No draft replies for vendors or sensitive matters (complaints, disputes) — task only.
7. Finish with a short summary (emails checked, tasks, quotes, drafts, anything urgent).
