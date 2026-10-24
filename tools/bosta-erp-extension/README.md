# M1 — Bosta ↔ ERP consignee sync (Chrome extension)

Pulls a customer's **cross-merchant delivery record** from the Bosta dashboard —
how many parcels they received vs returned across *all* merchants, and their
success rate — and saves it onto the customer in the M1 ERP.

## Why an extension (and not a server integration)

Bosta exposes that record at `GET /api/v2/consignee/ranking`, but the endpoint
**only accepts the dashboard's logged-in session token** — the business API key
gets `401 errorCode 1028` (tested 2026-10-24, even with a full-control key). See
`docs/bosta-consignee-history-endpoint.md`. So the record can only be read from
inside a logged-in Bosta tab, which is exactly what this extension does. It uses
your own Bosta session; no Bosta password or token is ever stored or sent to the
ERP server.

## How it works

```
ERP order page --(event)--> content-erp.js --> background.js
   -> finds/opens a business.bosta.co tab
   -> chrome.scripting injects a reader into that tab
      (reads its own session token, calls Bosta API; token stays in the tab)
   -> record (counts only) comes back to content-erp.js
   -> POST /api/shipping/bosta/consignee-history (ERP page login)
   -> event: result --> the card refreshes
```

- The **Bosta token stays inside the Bosta tab.** the injected reader reads it from
  that origin’s `localStorage` and uses it only to call Bosta's own API. Only the
  resulting counts travel onward.
- The **ERP save** is authenticated with the ERP page's own login token, read on
  the ERP origin by `content-erp.js`.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. **Load unpacked** → pick this folder (`tools/bosta-erp-extension`).
4. Make sure you are logged in to `business.bosta.co` in the same Chrome profile.

That's it. Open any ERP order and use **"تحديث من بوسطة"** on the customer's
Bosta record card. The popup (toolbar icon) also does a quick view-only lookup by
phone.

## Icons

No icon files are bundled; Chrome shows a default puzzle-piece icon. To brand it,
add `icon16.png` / `icon48.png` / `icon128.png` here and an `"icons"` block in
`manifest.json`.

## If it says the extension is unavailable

- The card waits ~8s for the extension to answer. If nothing responds, confirm
  the extension is loaded and enabled, then reload the ERP tab.
- `NO_BOSTA_LOGIN` / `401`: open `business.bosta.co` and sign in again.

## Hosts it runs on

`business.bosta.co`, `app.bosta.co`, `erp.m1store-egy.com`, `jomla.m1store-egy.com`,
and `localhost` (for dev). Update `host_permissions` and the ERP content-script
matches in `manifest.json` if any host changes.
