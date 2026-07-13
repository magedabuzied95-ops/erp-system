import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  listOfflineOrders,
  retryPendingOfflineOrders,
  saveOfflineOrderDraft,
  shouldStoreOfflineOrderDraft,
} from "../src/modules/pos/lib/posOfflineOrders.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const createIndexedDbMock = () => {
  const stores = new Map();

  const ensureStore = (name) => {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }
    return stores.get(name);
  };

  return {
    open(_name, _version) {
      const request = {
        result: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        error: null,
      };

      queueMicrotask(() => {
        const db = {
          objectStoreNames: {
            contains: (name) => stores.has(name),
          },
          createObjectStore: (name) => ensureStore(name),
          transaction(storeName, _mode) {
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

const withIndexedDb = async (fn) => {
  const previousWindow = globalThis.window;
  const previousIndexedDb = globalThis.indexedDB;
  const mock = createIndexedDbMock();
  globalThis.window = { indexedDB: mock };
  globalThis.indexedDB = mock;
  try {
    await fn();
  } finally {
    globalThis.window = previousWindow;
    globalThis.indexedDB = previousIndexedDb;
  }
};

test("offline order saved with idempotency_key", async () => {
  await withIndexedDb(async () => {
    const draft = await saveOfflineOrderDraft({
      cashier: { id: 7, name: "Cashier One" },
      customer: { id: 11, name: "Retail Customer", phone: "0100000000" },
      cart_items: [{ product_id: 1, quantity: 2 }],
      payment_method: "cash",
      totals: { subtotal: 100, total: 100, paid_amount: 100, change_amount: 0 },
      checkout_payload: {
        customer_name: "Retail Customer",
        items: [{ product_id: 1, quantity: 2 }],
        total: 100,
      },
    });

    assert.ok(draft.local_id);
    assert.ok(draft.idempotency_key);
    assert.equal(draft.status, "pending_sync");
    assert.equal(draft.checkout_payload.idempotency_key, draft.idempotency_key);

    const records = await listOfflineOrders();
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "pending_sync");
  });
});

test("synced order is not resent", async () => {
  await withIndexedDb(async () => {
    const draft = await saveOfflineOrderDraft({
      cart_items: [{ product_id: 1, quantity: 1 }],
      totals: { total: 50 },
      checkout_payload: { items: [{ product_id: 1, quantity: 1 }], total: 50 },
    });

    let calls = 0;
    const sendOrder = async () => {
      calls += 1;
      return {
        success: true,
        order: { id: 901, invoice_number: "INV-901" },
        order_id: 901,
        invoice_number: "INV-901",
      };
    };

    try {
      const first = await retryPendingOfflineOrders(sendOrder);
      assert.equal(first.synced.length, 1);
      assert.equal(calls, 1);

      const second = await retryPendingOfflineOrders(sendOrder);
      assert.equal(second.synced.length, 0);
      assert.equal(calls, 1);

      const records = await listOfflineOrders();
      assert.equal(records[0].status, "synced");
      assert.equal(records[0].server_order_id, 901);
      assert.equal(records[0].order_number, "INV-901");
      assert.equal(records[0].local_id, draft.local_id);
    } finally {}
  });
});

test("failed sync can be retried", async () => {
  await withIndexedDb(async () => {
    await saveOfflineOrderDraft({
      cart_items: [{ product_id: 1, quantity: 1 }],
      totals: { total: 60 },
      checkout_payload: { items: [{ product_id: 1, quantity: 1 }], total: 60 },
    });

    let attempt = 0;
    const sendOrder = async () => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error("NetworkError when attempting to fetch");
        throw error;
      }
      return {
        success: true,
        order: { id: 902, invoice_number: "INV-902" },
        order_id: 902,
        invoice_number: "INV-902",
      };
    };

    const first = await retryPendingOfflineOrders(sendOrder);
    assert.equal(first.failed.length, 1);
    let records = await listOfflineOrders();
    assert.equal(records[0].status, "failed_sync");

    const second = await retryPendingOfflineOrders(sendOrder);
    assert.equal(second.synced.length, 1);
    records = await listOfflineOrders();
    assert.equal(records[0].status, "synced");
    assert.equal(records[0].server_order_id, 902);
  });
});

test("concurrent sync requests send a pending order once", async () => {
  await withIndexedDb(async () => {
    await saveOfflineOrderDraft({
      cart_items: [{ product_id: 2, quantity: 1 }],
      totals: { total: 75 },
      checkout_payload: { items: [{ product_id: 2, quantity: 1 }], total: 75 },
    });

    let calls = 0;
    const sendOrder = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { success: true, order: { id: 903, invoice_number: "INV-903" } };
    };

    const [first, second] = await Promise.all([
      retryPendingOfflineOrders(sendOrder),
      retryPendingOfflineOrders(sendOrder),
    ]);

    assert.equal(calls, 1);
    assert.equal(first.synced.length, 1);
    assert.equal(second.synced.length, 1);
    const records = await listOfflineOrders();
    assert.equal(records[0].status, "synced");
  });
});

test("validation and 400 errors are not stored offline", () => {
  assert.equal(shouldStoreOfflineOrderDraft({ status: 400, message: "Invalid payload" }), false);
  assert.equal(shouldStoreOfflineOrderDraft({ status: 422, responseBody: { message: "Stock" } }), false);
});

test("POS checkout captures an offline-safe snapshot before the network request", () => {
  const pagePath = path.join(process.cwd(), "src", "modules", "pos", "pages", "POSPro.jsx");
  const source = fs.readFileSync(pagePath, "utf8");

  assert.match(source, /let offlineCheckoutSnapshot = null;/);
  assert.match(source, /offlineCheckoutSnapshot = \{/);
  assert.match(source, /offlineCheckoutSnapshot && shouldStoreOfflineOrderDraft\(err\)/);
  assert.match(source, /idempotency_key: draftIdempotencyKey/);
});
