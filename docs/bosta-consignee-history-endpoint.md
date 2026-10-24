# Bosta — consignee (customer) delivery history endpoint

Captured 2026-10-24 from the Bosta Business dashboard (`business.bosta.co/create-order`)
by typing a phone number into **تفاصيل العميل ← رقم التليفون**. Typing the full
number fires two XHR calls to `app.bosta.co`. The one that carries the
delivered / returned record is **`consignee/ranking`**; it drives the badge under
the phone field (e.g. "العميل نسبة استلامه ممتازة").

Secrets are written as `XXX` throughout.

## 1. The history endpoint — `GET /consignee/ranking`

| | |
|---|---|
| Method | `GET` |
| URL | `https://app.bosta.co/api/v2/consignee/ranking?phone=%2B201024960585&includeRejectedDeliveries=true` |
| Query params | `phone` — E.164 (`+20…`), URL-encoded; `includeRejectedDeliveries=true` |
| Body | none |

Request headers sent by the dashboard (names only):

- `Accept`
- `Authorization` — **`Bearer XXX`** (the dashboard's user session JWT, ~720 chars, held by the SPA; not a cookie)
- `X-DEVICE-FINGERPRINT`
- `x-device-id`
- `Accept-Language`

Auth type: **Bearer token** (dashboard login JWT). No cookie auth, no `x-api-key`.

Response (200, full):

```json
{
  "success": true,
  "message": "Done successfully.",
  "data": {
    "consigneRanking": {
      "consigneePhone": "+201024960585",
      "deliveredDeliveriesCount": 31,
      "returnedDeliveriesCount": 0,
      "consecutiveReturnedDeliveriesCount": 0,
      "deliverySuccessRate": 100,
      "hasHighUnpaidFlexshipReturns": false
    },
    "rtoDiscount": {
      "mode": "DISABLED",
      "ratingLevel": null,
      "percentage": null
    }
  }
}
```

Notes:
- `consigneRanking` (Bosta's spelling) is the cross-merchant record: counts of
  delivered vs returned shipments, the current streak of consecutive returns,
  and a success-rate percentage. A "returned 4 of the last 5" style warning is
  built from `returnedDeliveriesCount` / `consecutiveReturnedDeliveriesCount` /
  `deliverySuccessRate`.
- The response does **not** name the other brands or list individual orders —
  only aggregates.
- `rtoDiscount` relates to Bosta's return-to-origin discount programme; disabled
  on this account.

## 2. Companion call — `POST /consignee/relativeBusinessData`

Fires at the same time. This is **not** the history: it returns the consignee as
saved in *this* business's own address book (name + saved addresses) to
autofill the form.

| | |
|---|---|
| Method | `POST` |
| URL | `https://app.bosta.co/api/v2/consignee/relativeBusinessData` |
| Body | `{"phone":"+201024960585","isCompletePhoneNumber":true,"countryCode":"EG"}` |
| Headers (names) | `Accept`, `Content-Type`, `X-DEVICE-FINGERPRINT`, `x-device-id`, `Authorization` (`Bearer XXX`), `Accept-Language` |

Response shape (addresses shortened here; the live payload lists every saved address):

```json
{
  "success": true,
  "message": "Done successfully.",
  "data": [
    {
      "firstName": "…", "lastName": "…", "fullName": "…",
      "phone": "+201024960585",
      "address": [
        {
          "country":  { "_id": "…", "name": "Egypt", "code": "EG" },
          "city":     { "_id": "…", "name": "Damietta", "nameAr": "دمياط", "sector": 3 },
          "zone":     { "_id": "…", "name": "New Damietta", "nameAr": "دمياط الجديده" },
          "district": { "_id": "…", "name": "New Damietta", "nameAr": "دمياط الجديده" },
          "firstLine": "…",
          "isWorkAddress": false,
          "geoLocation": [31.44, 31.66]
        }
      ]
    }
  ]
}
```

## 3. Does it work with the business API key (`BOSTA_API_KEY`)?

**No — `consignee/ranking` rejects the business API key.** Tested 2026-10-24
with a freshly created dashboard API key (`XXX`, permission "تحكم كامل" / full control):

| Call | Auth sent | Result |
|---|---|---|
| `GET /consignee/ranking` | `Authorization: XXX` (verbatim, like `bosta.client.js`) | **401** `{"success":false,"message":"Invalid authorization token or API key.","errorCode":1028}` |
| `GET /consignee/ranking` | `Authorization: Bearer XXX` | **401**, same body |
| `POST /consignee/relativeBusinessData` | `Authorization: XXX` | **200**, same payload as the dashboard |
| `GET /cities` (sanity check) | `Authorization: XXX` | **200** |

So the key itself is valid and is accepted by the neighbouring `consignee`
route, but `ranking` only accepts the dashboard user's session JWT. The
cross-merchant delivery record is not reachable from the ERP with an API key,
even one with full control.

To rerun the test, use this on a machine that has the key in
`BOSTA_API_KEY` (it never prints the key):

```bash
curl -s -o - -w "\nHTTP %{http_code}\n" -H "Authorization: $BOSTA_API_KEY" -H "Accept: application/json" "https://app.bosta.co/api/v2/consignee/ranking?phone=%2B201024960585&includeRejectedDeliveries=true"
```

On Windows PowerShell, `curl` is an alias for `Invoke-WebRequest` and
`$BOSTA_API_KEY` is an (empty) PowerShell variable, so use this instead. It asks
for the key with hidden input and keeps it out of the command history:

```powershell
$s = Read-Host "Bosta API key" -AsSecureString; $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); try { $r = Invoke-WebRequest -UseBasicParsing -Uri "https://app.bosta.co/api/v2/consignee/ranking?phone=%2B201024960585&includeRejectedDeliveries=true" -Headers @{ Authorization = $key; Accept = "application/json" }; "HTTP $($r.StatusCode)"; $r.Content } catch { "HTTP $([int]$_.Exception.Response.StatusCode)" }; Remove-Variable key, s
```

Note that `bosta.client.js` sends the key **verbatim** in `Authorization`
(no `Bearer` prefix), while the dashboard sends `Bearer <JWT>`. Try the verbatim
form first; if it returns 401/403, the endpoint is dashboard-only (session JWT)
and is not reachable with the integration key.

Expected outcomes:
- `200` with the JSON above → wire it into `server/modules/shipping/providers/bosta.client.js` as `getConsigneeRanking(phone)`.
- `401` / `403` → the endpoint accepts only dashboard user tokens; don't build on it.

## Side effects during capture

No shipment was created, edited, or cancelled; the order form was never
submitted. One incidental write: dismissing the dashboard's onboarding tooltip
sent `PUT /api/v2/businesses/feature-configurations` (marks the tour as seen —
UI preference only).
