// Guards for the parts of the offline till that decide whether a completed sale
// survives. Everything here is about the failure paths, because the happy path
// was never what lost invoices: a queued sale is lost when a 4xx is treated as
// final, when a local id reaches a bigint column, or when nothing ever retries.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  OFFLINE_ORDER_STATUS,
  classifyOfflineSyncError,
  createOfflineInvoiceReference,
  listOfflineOrders,
  markOfflineOrderFailed,
  requeueOfflineOrder,
  retryPendingOfflineOrders,
  saveOfflineOrderDraft,
} from "../src/modules/pos/lib/posOfflineOrders.js";
import {
  isOfflineCustomerId,
  listOfflineCustomers,
  saveOfflineCustomer,
  toPosCustomerRow,
  toServerCustomerId,
} from "../src/modules/pos/lib/posOfflineCustomers.js";
import {
  createOfflinePosShiftId,
  isOfflinePosShiftId,
  toServerPosShiftId,
} from "../src/modules/pos/lib/posShiftCache.js";
import {
  countOpenOfflineWork,
  probeBackendReachable,
  runOfflineSyncPass,
} from "../src/modules/pos/lib/posOfflineSync.js";
import {
  listOpenOfflineExpenses,
  retryPendingOfflineExpenses,
  saveOfflineExpense,
} from "../src/modules/pos/lib/posOfflineExpenses.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const createIndexedDbMock = () => {
  const stores = new Map();
  const ensureStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };

  return {
    open() {
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, error: null };
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: (name) => stores.has(name) },
          createObjectStore: (name) => ensureStore(name),
          transaction(storeName) {
            const store = ensureStore(storeName);
            const tx = {
              error: null,
              oncomplete: null,
              onerror: null,
              objectStore() {
                return {
                  put(value, key) {
                    store.set(String(key), clone(value));
                    queueMicrotask(() => tx.oncomplete?.());
                  },
                  get(key) {
                    const getRequest = { result: null, onsuccess: null, onerror: null, error: null };
                    queueMicrotask(() => {
                      getRequest.result = clone(store.get(String(key)) || null);
                      getRequest.onsuccess?.();
                    });
                    return getRequest;
                  },
                  getAll() {
                    const getRequest = { result: [], onsuccess: null, onerror: null, error: null };
                    queueMicrotask(() => {
                      getRequest.result = Array.from(store.values()).map(clone);
                      getRequest.onsuccess?.();
                    });
                    return getRequest;
                  },
                  delete(key) {
                    store.delete(String(key));
                    queueMicrotask(() => tx.oncomplete?.());
                  },
                };
              },
            };
            return tx;
          },
          close() {},
        };
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
};

const createLocalStorageMock = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const withBrowser = async (fn) => {
  const previousWindow = globalThis.window;
  const previousIndexedDb = globalThis.indexedDB;
  const previousNavigator = globalThis.navigator;
  const mock = createIndexedDbMock();
  const localStorage = createLocalStorageMock();
  globalThis.window = { indexedDB: mock, localStorage, dispatchEvent: () => true };
  globalThis.indexedDB = mock;
  setNavigator({ onLine: true });
  try {
    await fn({ localStorage });
  } finally {
    globalThis.window = previousWindow;
    globalThis.indexedDB = previousIndexedDb;
    setNavigator(previousNavigator);
  }
};

// Node exposes `navigator` as a getter-only global, so a plain assignment throws.
const setNavigator = (value) => {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
};

const readSource = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("a replay refused for a closed shift stays retryable, and a stock conflict parks for review", () => {
  const noShift = classifyOfflineSyncError({
    status: 409,
    responseBody: { code: "OFFLINE_REPLAY_NO_OPEN_SHIFT", message: "no open shift" },
  });
  assert.equal(noShift.status, OFFLINE_ORDER_STATUS.PENDING);
  assert.equal(noShift.retryable, true);

  const stock = classifyOfflineSyncError({
    status: 409,
    responseBody: { code: "OFFLINE_REPLAY_STOCK_CONFLICT", message: "Not enough stock for variant:9" },
  });
  assert.equal(stock.status, OFFLINE_ORDER_STATUS.NEEDS_REVIEW);
  assert.equal(stock.retryable, false);

  // The legacy shape, in case an older backend answers before it is redeployed.
  const legacyStock = classifyOfflineSyncError({ status: 400, message: "Not enough stock for variant:9" });
  assert.equal(legacyStock.status, OFFLINE_ORDER_STATUS.NEEDS_REVIEW);

  assert.equal(classifyOfflineSyncError({ status: 502 }).retryable, true);
  assert.equal(classifyOfflineSyncError({ status: 429 }).retryable, true);
  assert.equal(classifyOfflineSyncError({ message: "Failed to fetch" }).retryable, true);

  // A genuine rejection still keeps the invoice -- it just needs a person.
  const rejected = classifyOfflineSyncError({ status: 403, message: "forbidden" });
  assert.equal(rejected.status, OFFLINE_ORDER_STATUS.NEEDS_REVIEW);
  assert.equal(rejected.retryable, false);
});

test("an invoice parked for review is never retried automatically, but a manual requeue frees it", async () => {
  await withBrowser(async () => {
    const draft = await saveOfflineOrderDraft({
      cart_items: [{ product_id: 4, quantity: 1 }],
      totals: { total: 250 },
      checkout_payload: { items: [{ product_id: 4, quantity: 1 }], total: 250 },
    });

    await markOfflineOrderFailed(draft.local_id, {
      status: 409,
      responseBody: { code: "OFFLINE_REPLAY_STOCK_CONFLICT", message: "Not enough stock" },
    });

    const parked = (await listOfflineOrders())[0];
    assert.equal(parked.status, OFFLINE_ORDER_STATUS.NEEDS_REVIEW);
    assert.equal(parked.error_reason, "stock_conflict");

    let sendCalls = 0;
    const send = async () => {
      sendCalls += 1;
      return { order: { id: 1 } };
    };

    await retryPendingOfflineOrders(send);
    assert.equal(sendCalls, 0, "a parked invoice must not be resent behind a manager's back");

    await requeueOfflineOrder(draft.local_id);
    await retryPendingOfflineOrders(send);
    assert.equal(sendCalls, 1);
    assert.equal((await listOfflineOrders())[0].status, OFFLINE_ORDER_STATUS.SYNCED);
  });
});

test("a queued replay carries the offline markers the server routes on", async () => {
  await withBrowser(async () => {
    const draft = await saveOfflineOrderDraft({
      cart_items: [{ product_id: 4, quantity: 1 }],
      totals: { total: 100 },
      shift_id: 42,
      offline_reference: "OFF-A7-260908-001",
      checkout_payload: { items: [{ product_id: 4, quantity: 1 }], total: 100 },
    });

    assert.equal(draft.shift_id, 42);
    assert.equal(draft.offline_reference, "OFF-A7-260908-001");

    let sentPayload = null;
    await retryPendingOfflineOrders(async (record) => {
      sentPayload = {
        ...(record.checkout_payload || {}),
        offline_origin: true,
        offline_created_at: record.created_at,
        offline_shift_id: record.shift_id,
        offline_reference: record.offline_reference,
      };
      return { order: { id: 5 } };
    });

    assert.equal(sentPayload.offline_origin, true);
    assert.equal(sentPayload.offline_shift_id, 42);
    assert.equal(sentPayload.offline_reference, "OFF-A7-260908-001");
  });
});

test("a local id never passes as a server id", () => {
  const customerId = "offline-cust-abc";
  assert.equal(isOfflineCustomerId(customerId), true);
  assert.equal(toServerCustomerId(customerId), null);
  assert.equal(toServerCustomerId(1234), "1234");
  assert.equal(toServerCustomerId(""), null);

  const shiftId = createOfflinePosShiftId();
  assert.equal(isOfflinePosShiftId(shiftId), true);
  assert.equal(toServerPosShiftId(shiftId), null);
  assert.equal(toServerPosShiftId(88), "88");
});

test("a customer captured offline is one record per phone and is selectable like a server one", async () => {
  await withBrowser(async () => {
    const first = await saveOfflineCustomer(
      { name: "Sara", phone: "01000000001", source: "walk_in", allow_personal_transactions: true },
      { tenantId: 1 }
    );
    const second = await saveOfflineCustomer(
      { name: "Sara Ahmed", phone: "01000000001" },
      { tenantId: 1 }
    );

    assert.equal(second.local_id, first.local_id, "the same phone typed twice is one customer");
    assert.equal((await listOfflineCustomers({ tenantId: 1 })).length, 1);

    const row = toPosCustomerRow(second);
    assert.equal(row.id, first.local_id);
    assert.equal(row.phone, "01000000001");
    assert.equal(row.pending_sync, true);
    assert.equal(row.allow_personal_transactions, true);
    // The id it hands the cart must still be refused as a server id.
    assert.equal(toServerCustomerId(row.id), null);
  });
});

test("the offline invoice reference is a per-day sequence that resets on a new day", async () => {
  await withBrowser(async () => {
    const day = new Date("2026-09-08T10:00:00Z");
    const first = createOfflineInvoiceReference(day);
    const second = createOfflineInvoiceReference(day);
    const nextDay = createOfflineInvoiceReference(new Date("2026-09-09T10:00:00Z"));

    assert.match(first, /^OFF-[A-Z0-9]{2}-\d{6}-\d{3}$/);
    assert.ok(first.endsWith("-001"));
    assert.ok(second.endsWith("-002"));
    assert.ok(nextDay.endsWith("-001"), "a new day starts the sequence again");
    assert.notEqual(first, second, "two offline sales must never print the same reference");
  });
});

const jsonResponse = (status) => ({ status, headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null) } });
const htmlResponse = (status) => ({ status, headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) } });

test("reachability is decided by the server answering, not by navigator.onLine", async () => {
  const previousNavigator = globalThis.navigator;
  try {
    setNavigator({ onLine: true });

    assert.equal(
      await probeBackendReachable({ fetchImpl: async () => jsonResponse(200) }),
      true
    );
    // Wi-Fi is up, the backend is not. This is the case `navigator.onLine` gets wrong.
    assert.equal(
      await probeBackendReachable({ fetchImpl: async () => jsonResponse(503) }),
      false
    );
    assert.equal(
      await probeBackendReachable({
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
      false
    );
    // A 401 means the server is there; auth is a separate, per-record failure.
    assert.equal(
      await probeBackendReachable({ fetchImpl: async () => jsonResponse(401) }),
      true
    );

    setNavigator({ onLine: false });
    assert.equal(
      await probeBackendReachable({ fetchImpl: async () => jsonResponse(200) }),
      false
    );
  } finally {
    setNavigator(previousNavigator);
  }
});

test("a sync pass holds everything back while the server is unreachable", async () => {
  await withBrowser(async () => {
    await saveOfflineOrderDraft({
      cart_items: [{ product_id: 1, quantity: 1 }],
      totals: { total: 60 },
      checkout_payload: { items: [{ product_id: 1, quantity: 1 }], total: 60 },
    });

    setNavigator({ onLine: false });
    const result = await runOfflineSyncPass({ tenantId: 1 });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "unreachable");
    assert.equal((await listOfflineOrders())[0].status, OFFLINE_ORDER_STATUS.PENDING);
  });
});

test("the checkout never sends a local customer id, and an offline sale still produces a receipt", () => {
  const source = readSource("src/modules/pos/pages/POSPro.jsx");

  // The payload's customer_id goes through the guard, not the raw selection.
  assert.match(source, /customer_id:\s*serverCustomerId,/);
  assert.match(source, /const serverCustomerId = toServerCustomerId\(customerId\);/);
  // Same for the shift id, which is written into a BIGINT column.
  assert.match(source, /shift_id:\s*toServerPosShiftId\(checkoutShift\?\.id\),/);

  // The offline branch of the checkout ends the sale the way the online one
  // does: a stored receipt, the success modal, and the automatic print.
  const offlineBranch = source.slice(source.indexOf("shouldStoreOfflineOrderDraft(err)"));
  assert.ok(offlineBranch.includes("setLastOrder(offlineReceipt)"));
  assert.ok(offlineBranch.includes("setCheckoutSuccessOpen(true)"));
  assert.ok(offlineBranch.includes("receiptRuntimeSettings.printReceiptAutomatically"));

  // Closing a shift over unsynced invoices would settle a drawer the server has
  // not seen in full.
  assert.ok(source.includes("pos.toasts.closeShiftBlockedByQueue"));
});

test("the server treats an offline replay as a routing problem, not a rejection", () => {
  const source = readSource("server/controllers/ordersController.js");

  assert.ok(source.includes("OFFLINE_REPLAY_NO_OPEN_SHIFT"));
  assert.ok(source.includes("OFFLINE_REPLAY_STOCK_CONFLICT"));
  // The reroute only ever fires for a replay -- an ordinary sale with no open
  // shift must still be refused.
  assert.match(source, /if \(!openShift && offline_origin\) \{/);
  // Both id columns are bigint, so both are coerced before they reach a query.
  assert.match(source, /shift_id: toPositiveIntegerOrNull\(firstValue\(body\.shift_id, body\.shiftId\)\)/);
  assert.ok(source.includes("offline_original_shift_id"));
});

test("an expense raised offline queues, replays under one key, and never posts twice", async () => {
  await withBrowser(async () => {
    const saved = await saveOfflineExpense({
      category: "delivery",
      amount: 45,
      payment_method: "cash",
      notes: "delivery man",
      shift_id: 42,
      branch_id: 3,
      request_payload: { category: "delivery", amount: 45, payment_method: "cash" },
    });

    assert.ok(saved.idempotency_key.startsWith("pos-expense-"));
    assert.equal(saved.status, OFFLINE_ORDER_STATUS.PENDING);
    assert.equal((await listOpenOfflineExpenses()).length, 1);

    const sent = [];
    const send = async (record) => {
      sent.push({
        ...(record.request_payload || {}),
        shift_id: record.shift_id,
        idempotency_key: record.idempotency_key,
        offline_origin: true,
      });
      return { expense: { id: 900 } };
    };

    await retryPendingOfflineExpenses(send);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].idempotency_key, saved.idempotency_key);
    assert.equal(sent[0].offline_origin, true);
    assert.equal(sent[0].shift_id, 42);

    // A second pass must not withdraw the same cash again.
    await retryPendingOfflineExpenses(send);
    assert.equal(sent.length, 1);
    assert.equal((await listOpenOfflineExpenses()).length, 0);
  });
});

test("an expense refused because no shift is open holds instead of failing", async () => {
  await withBrowser(async () => {
    const saved = await saveOfflineExpense({
      category: "water",
      amount: 20,
      payment_method: "cash",
      request_payload: { category: "water", amount: 20 },
    });

    await retryPendingOfflineExpenses(async () => {
      const error = new Error("no open shift");
      error.status = 409;
      error.responseBody = { code: "OFFLINE_REPLAY_NO_OPEN_SHIFT" };
      throw error;
    });

    const held = (await listOpenOfflineExpenses())[0];
    assert.equal(held.local_id, saved.local_id);
    assert.equal(held.status, OFFLINE_ORDER_STATUS.PENDING, "still queued, not marked failed");
    assert.equal(held.error_reason, "no_open_shift");
  });
});

test("queued expenses block the shift close alongside invoices", async () => {
  await withBrowser(async () => {
    await saveOfflineExpense({ category: "snacks", amount: 15, request_payload: {} });
    const work = await countOpenOfflineWork({ tenantId: 1 });
    assert.equal(work.expenses, 1);
    assert.equal(work.drawerAffecting, 1, "an expense moves drawer cash, so the close must wait for it");
    assert.equal(work.total, 1);
  });
});

test("the POS service worker caches and serves product images from any origin", () => {
  const worker = readSource("public/pos-sw.js");
  // The rules themselves now live in one shared module, used by all three PWA
  // workers -- three copies of them is how the original bug survived. Their
  // behaviour is driven for real in tests/pwa-offline-media.test.js; what is
  // POS-specific, and asserted here, is the ORDERING.
  const shared = readSource("public/sw-image-cache.js");

  // The image branch has to run BEFORE the same-origin early return, or a photo
  // on the API origin is never seen by the worker at all.
  const fetchHandlerAt = worker.indexOf('addEventListener("fetch"');
  const imageBranchAt = worker.indexOf("productImages.isImageRequest(request, url)", fetchHandlerAt);
  const crossOriginGateAt = worker.indexOf("url.origin !== self.location.origin", fetchHandlerAt);
  assert.ok(imageBranchAt > 0, "the fetch handler must have a product-image branch");
  // Matched verbatim, so a disabled branch (`false &&`, a feature flag) reads as
  // a regression rather than passing on the strength of the call still being there.
  assert.ok(
    worker.includes("if (productImages.isImageRequest(request, url)) {"),
    "the branch condition must be the check itself, not a disabled version of it"
  );
  assert.ok(
    imageBranchAt < crossOriginGateAt,
    "product images must be handled before the cross-origin early return"
  );

  // Opaque responses are the whole point: a cross-origin image without CORS
  // headers cannot be stored any other way, and cache.add would reject it.
  assert.ok(shared.includes('response.type === "opaque"'));
  assert.ok(shared.includes('mode: "no-cors"'));
  assert.ok(!/cache\.add\(/.test(shared), "cache.add cannot store an opaque image response");

  // The image cache must survive a shell version bump, so it must not carry the
  // prefix the activate handler evicts.
  assert.match(worker, /const IMAGE_CACHE = "pos-product-images-v\d+"/);
  assert.ok(!worker.includes('IMAGE_CACHE = `pos-shell-'));
});

test("the page and the worker agree on one image cache, and the whole catalogue is warmed", () => {
  const worker = readSource("public/pos-sw.js");
  const cacheLib = readSource("src/modules/pos/lib/posCatalogCache.js");

  const workerName = worker.match(/const IMAGE_CACHE = "([^"]+)"/)?.[1];
  const pageName = cacheLib.match(/const POS_PRODUCT_IMAGE_CACHE_NAME = "([^"]+)"/)?.[1];
  assert.ok(workerName);
  assert.equal(pageName, workerName, "a cache written by one and read by the other must share a name");

  // The old preloader capped the warm at 120 images, which on a real catalogue
  // left almost every product blank offline.
  assert.ok(!cacheLib.includes(".slice(0, 120)"));
  assert.match(cacheLib, /POS_IMAGE_WARM_LIMIT = \d{3,}/);
});

test("the mobile topbar keeps the cashier's identity readable when an action is added", () => {
  const source = readSource("src/modules/pos/pages/POSPro.jsx");

  // Measured at 280-414px: without a floor on the identity block, adding one
  // more action button drove the salesperson's name to 11px at 280px. The floor
  // pushes the squeeze onto the customer chip, whose text is the same customer
  // the identity block's third line already names.
  assert.match(source, /<div className="min-w-\[7rem\] flex-1">/);
  assert.ok(
    source.includes('<div className="flex min-w-0 items-center gap-2">'),
    "the mobile action group must be able to shrink, or the identity block absorbs the whole squeeze"
  );
  assert.match(
    source,
    /min-w-0 max-w-\[8\.75rem\] shrink items-center[\s\S]{0,400}mobileSelectedCustomerLabel/,
    "the customer chip must be the element that yields width"
  );
});
