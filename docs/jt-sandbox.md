# J&T Express Egypt in M1

## Operating mode

The VPS runs `JT_ENV=sandbox`. Admins may create synthetic J&T tests. M1 customer orders cannot be submitted while Sandbox is active. No shipment is created automatically. Production calls require explicit `JT_ENV=production`, `JT_PRODUCTION_ENABLED=1`, the exact production host and complete production configuration. No secrets are stored in source or shipment tables.

The current J&T Egypt Introduction signs the **exact** JSON `bizContent` plus `privateKey`, then Base64 encodes the raw MD5 bytes. The millisecond `timestamp` is a separate header. Business digest is Base64 of raw `MD5(customerCode + uppercaseHexMD5(customerPassword + "jadada236t2") + privateKey)`. This was checked against a successful direct demo API call. The older header formula including timestamp was rejected by Egypt Sandbox.

## Configuration

Sandbox variables: `JT_ENV`, `JT_SANDBOX_ENABLED`, `JT_SANDBOX_API_ACCOUNT`, `JT_SANDBOX_PRIVATE_KEY`, `JT_SANDBOX_CUSTOMER_CODE`, `JT_SANDBOX_CUSTOMER_PASSWORD`. `JT_BASE_URL` may be omitted; when present it must match the demo API root exactly.

Future production variables: `JT_ENV`, `JT_PRODUCTION_ENABLED`, `JT_BASE_URL`, `JT_API_ACCOUNT`, `JT_PRIVATE_KEY`, `JT_CUSTOMER_CODE`, `JT_CUSTOMER_PASSWORD`, `JT_SENDER_NAME`, `JT_SENDER_PHONE`, `JT_SENDER_COUNTRY`, `JT_SENDER_PROVINCE`, `JT_SENDER_CITY`, `JT_SENDER_AREA`, `JT_SENDER_STREET`, `JT_PAY_TYPE`. COD requires explicit `JT_COD_ENABLED=1` after commercial confirmation. `JT_REGION_MAP_JSON` is an official J&T region map keyed by `"<M1 governorate>|<M1 city_area>"` and containing `{ "prov": "...", "city": "...", "area": "..." }`. No region is guessed. Production configuration is validated at backend startup.

## Architecture and routes

The J&T client signs and sends form encoded requests with a 30-second timeout. Query, trace and label may retry once after network or 5xx failure. Create and cancel do not retry blindly. Each M1 order has stable `txlogisticId=M1-<tenant>-<order>` and a unique database reservation to prevent duplicate Create. A timed-out Create remains pending and Query can reconcile it. The additive `jt_shipments` and `jt_callback_events` tables store shipment state and callback replay keys.

Admin-only routes under `/api/orders/:id/shipping/jt`: GET `/` status and missing fields; POST `/create`, `/query`, `/track`, `/label`, `/cancel`. Create is blocked in Sandbox. The label route streams a checked PDF without saving files. Synthetic Sandbox routes under `/api/shipping/jt/sandbox`: GET `/status`; POST `/orders`, `/orders/query`, `/orders/cancel`, `/trace`, `/label`. Sandbox Create ignores M1 order data and generates a unique test ID.

## Callback

Public HTTPS endpoint: `https://api.m1store-egy.com/api/shipping/jt/callback` (POST). It accepts form encoded `bizContent` and `apiAccount`, `digest`, `timestamp` headers. It checks account, signature and a five-minute clock window. Only documented scan types are accepted; repeated events are idempotent and unknown shipments or mismatched bill codes are rejected. Successful or repeated valid events return `{ "code": "1", "msg": "success", "data": "SUCCESS" }`. The URL must also be registered in J&T Console.

Scan mapping: `已调派业务员` → assigned; `已揽收` and `已取件` → picked_up; `已入仓` → in_transit; `已取消` → cancelled. Unknown statuses do not update M1. In production mode, accepted events also update the M1 order shipping status.

## Mapping and failures

M1 name, Egyptian phone, street and approved region map become J&T receiver fields. Sender and payment type are configured. Shoe orders use `goodsType=ITN1` according to current Egypt documentation, `EZ`, delivery type `04`, one parcel, explicit weight and an item description. COD maps to `itemsValue` only after it is enabled. Missing address, phone, region, weight, sender or items blocks Create and appears in the Admin panel.

Signature, address, parameter, duplicate, J&T server and network errors are categorized for admins without exposing secrets. An ambiguous Create result is reconciled by Query using the fixed transaction ID. Base64 labels must begin with `%PDF-`; the response uses a safe filename and no disk path.

## Production checklist and rollback

Obtain formal J&T approval and credentials, confirmed sender and payType/COD terms, and the official region list. Register and test the callback in J&T Console. Owner approval is required for contracts, rates and the first real shipment. Configure production environment variables only after approval; never reuse test credentials. Test an authorized pilot before wider use.

Deploy with `/opt/erp/deploy-production.sh`, which backs up the database and backend image and rolls back failed builds. In Sandbox, setting `JT_SANDBOX_ENABLED=0` disables calls. In production, removing `JT_PRODUCTION_ENABLED` prevents startup. Revert this integration commit and redeploy for code rollback; the additive tables need not be dropped.
