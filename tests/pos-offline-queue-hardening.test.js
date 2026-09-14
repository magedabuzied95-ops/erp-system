// Guards for the audited offline-queue failures: an expired login parking the
// whole queue, another cashier's sales replaying under the wrong session, a paid
// invoice deleted with no permission and no trace, a busy pass reading as "no
// connection", colliding receipt numbers, stock sold offline coming back after a
// reload, and chunk recovery killing an offline till.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  OFFLINE_ORDER_STATUS,
  canDiscardOfflineQueueItems,
  createOfflineInvoiceReference,
  deleteOfflineOrder,
  isOfflineDiscardConfirmation,
  listDiscardedOfflineItems,
  listOfflineOrders,
  retryPendingOfflineOrders,
  saveOfflineOrderDraft,
} from "../src/modules/pos/lib/posOfflineOrders.js";
import {
  deleteOfflineExpense,
  listOpenOfflineExpenses,
  retryPendingOfflineExpenses,
  saveOfflineExpense,
} from "../src/modules/pos/lib/posOfflineExpenses.js";
import { BUSY_RESULT, createOfflineSyncScheduler } from "../src/modules/pos/lib/posOfflineSync.js";
import {
  POS_CATALOG_SCHEMA_VERSION,
  applyOfflineSaleToCachedCatalog,
  applySoldLinesToCatalogProducts,
  getPosCatalogSnapshot,
  savePosCatalogSnapshot,
} from "../src/modules/pos/lib/posCatalogCache.js";
import { isOriginReachable, recoverFromChunkLoadError } from "../src/shared/utils/chunkLoadRecovery.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const createIndexedDbMock = () => {
  const stores = new Map();
  const ensureStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    stores,
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
                    const r = { result: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      r.result = store.has(String(key)) ? clone(store.get(String(key))) : null;
                      r.onsuccess?.();
                    });
                    return r;
                  },
                  getAll() {
                    const r = { result: [], onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      r.result = Array.from(store.values()).map(clone);
                      r.onsuccess?.();
                    });
                    return r;
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

const setNavigator = (value) => {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
};

const withBrowser = async (fn, { user = null } = {}) => {
  const previousWindow = globalThis.window;
  const previousIndexedDb = globalThis.indexedDB;
  const previousNavigator = globalThis.navigator;
  const indexedDB = createIndexedDbMock();
  const localStorage = createLocalStorageMock();
  const listeners = new Map();
  if (user) localStorage.setItem("user", JSON.stringify(user));
  globalThis.window = {
    indexedDB,
    localStorage,
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
    dispatchEvent: (event) => {
      for (const handler of listeners.get(event.type) || []) handler(event);
      return true;
    },
  };
  globalThis.indexedDB = indexedDB;
  setNavigator({ onLine: true });
  const login = (next) => localStorage.setItem("user", JSON.stringify(next));
  try {
    await fn({ localStorage, login, window: globalThis.window });
  } finally {
    globalThis.window = previousWindow;
    globalThis.indexedDB = previousIndexedDb;
    setNavigator(previousNavigator);
  }
};

const CASHIER_A = { id: 7, name: "Cashier A", role: "cashier", tenant_id: 1 };
const CASHIER_B = { id: 8, name: "Cashier B", role: "cashier", tenant_id: 1 };
const MANAGER = { id: 2, name: "Manager", role: "manager", tenant_id: 1 };

const httpError = (status, message = "refused") => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const queueInvoice = (total, extra = {}) =>
  saveOfflineOrderDraft({
    cart_items: [{ product_id: 1, variant_id: 11, quantity: 1, price: total }],
    totals: { total },
    checkout_payload: { items: [{ product_id: 1, quantity: 1 }], total },
    ...extra,
  });

// ---------------------------------------------------------------------------
// 1. An expired login
// ---------------------------------------------------------------------------

test("an expired login keeps every invoice pending, stops the pass, and replays after login", async () => {
  await withBrowser(async ({ window }) => {
    await queueInvoice(100);
    await queueInvoice(200);
    await queueInvoice(300);

    let loginEvents = 0;
    window.addEventListener("pos-offline-login-required", () => { loginEvents += 1; });

    let calls = 0;
    const first = await retryPendingOfflineOrders(async () => {
      calls += 1;
      throw httpError(401, "Session expired or unauthorized");
    });

    assert.equal(calls, 1, "the pass must stop at the first 401 instead of refusing every invoice");
    assert.equal(first.login_required, true);
    assert.equal(loginEvents, 1, "the till is told to ask for a login");
    const records = await listOfflineOrders();
    assert.ok(
      records.every((record) => record.status === OFFLINE_ORDER_STATUS.PENDING),
      `nothing may be parked for review: ${JSON.stringify(records.map((r) => r.status))}`
    );

    const second = await retryPendingOfflineOrders(async () => ({ order: { id: 1 } }));
    assert.equal(second.synced.length, 3, "after login every held invoice goes through automatically");
  }, { user: CASHIER_A });
});

test("403 and 429 also stop the pass without parking anything", async () => {
  for (const status of [403, 429]) {
    await withBrowser(async () => {
      await queueInvoice(10);
      await queueInvoice(20);
      let calls = 0;
      await retryPendingOfflineOrders(async () => {
        calls += 1;
        throw httpError(status);
      });
      assert.equal(calls, 1, `${status} must stop the pass`);
      const statuses = (await listOfflineOrders()).map((record) => record.status);
      assert.ok(!statuses.includes(OFFLINE_ORDER_STATUS.NEEDS_REVIEW), `${status} parked an invoice`);
    });
  }
});

test("invoices and expenses parked by an old 401 are offered for retry again", async () => {
  await withBrowser(async () => {
    const parkedAuth = await queueInvoice(100);
    const parkedReal = await queueInvoice(200);
    // Stored exactly as the old classifier left them.
    const store = globalThis.indexedDB.stores.get("orders");
    store.set(parkedAuth.local_id, {
      ...clone(parkedAuth),
      status: "needs_review",
      error_reason: "rejected",
      error: "Session expired or unauthorized",
    });
    store.set(parkedReal.local_id, {
      ...clone(parkedReal),
      status: "needs_review",
      error_reason: "rejected",
      error: "Invalid payload",
    });

    const expense = await saveOfflineExpense({ category: "water", amount: 5, request_payload: {} });
    globalThis.indexedDB.stores.get("expenses").set(expense.local_id, {
      ...clone(expense),
      status: "needs_review",
      error_reason: "rejected",
      error_status: 403,
      error: "forbidden",
    });

    const sent = [];
    await retryPendingOfflineOrders(async (record) => {
      sent.push(record.local_id);
      return { order: { id: 9 } };
    });
    assert.deepEqual(sent, [parkedAuth.local_id], "only the auth-parked invoice is requeued");
    const real = (await listOfflineOrders()).find((record) => record.local_id === parkedReal.local_id);
    assert.equal(real.status, "needs_review", "a genuine rejection stays with the manager");

    let expenseCalls = 0;
    await retryPendingOfflineExpenses(async () => {
      expenseCalls += 1;
      return { expense: { id: 3 } };
    });
    assert.equal(expenseCalls, 1, "the auth-parked expense is requeued too");
  });
});

test("a queued expense shares the stop-on-401 rule", async () => {
  await withBrowser(async () => {
    await saveOfflineExpense({ category: "a", amount: 1, request_payload: {} });
    await saveOfflineExpense({ category: "b", amount: 2, request_payload: {} });
    let calls = 0;
    const result = await retryPendingOfflineExpenses(async () => {
      calls += 1;
      throw httpError(401);
    });
    assert.equal(calls, 1);
    assert.equal(result.login_required, true);
    const open = await listOpenOfflineExpenses();
    assert.ok(open.every((record) => record.status === OFFLINE_ORDER_STATUS.PENDING));
  });
});

// ---------------------------------------------------------------------------
// 2. Ownership
// ---------------------------------------------------------------------------

test("another cashier's queued sales stay pending under a different login", async () => {
  await withBrowser(async ({ login }) => {
    const mine = await queueInvoice(100, { cashier: { id: 7, tenant_id: 1 } });
    assert.equal(mine.owner_user_id, "7");
    assert.equal(mine.owner_tenant_id, "1");
    const expense = await saveOfflineExpense({ category: "tea", amount: 4, request_payload: {} });
    assert.equal(expense.owner_user_id, "7", "an expense is stamped from the logged-in user");

    login(CASHIER_B);
    const sent = [];
    const result = await retryPendingOfflineOrders(async (record) => {
      sent.push(record.local_id);
      return { order: { id: 1 } };
    });
    assert.deepEqual(sent, [], "B's session must not replay A's sale");
    assert.deepEqual(result.foreign, [mine.local_id]);
    assert.equal((await listOfflineOrders())[0].status, OFFLINE_ORDER_STATUS.PENDING);

    let expenseCalls = 0;
    await retryPendingOfflineExpenses(async () => {
      expenseCalls += 1;
      return {};
    });
    assert.equal(expenseCalls, 0, "B's session must not replay A's expense");

    login(CASHIER_A);
    const back = await retryPendingOfflineOrders(async () => ({ order: { id: 1 } }));
    assert.equal(back.synced.length, 1, "A logging back in sends it");
  }, { user: CASHIER_A });
});

test("a record queued before owners existed keeps replaying", async () => {
  await withBrowser(async () => {
    const legacy = await queueInvoice(50);
    const store = globalThis.indexedDB.stores.get("orders");
    const raw = clone(store.get(legacy.local_id));
    delete raw.owner_user_id;
    delete raw.owner_tenant_id;
    store.set(legacy.local_id, raw);

    const result = await retryPendingOfflineOrders(async () => ({ order: { id: 1 } }));
    assert.equal(result.synced.length, 1);
  }, { user: CASHIER_B });
});

// ---------------------------------------------------------------------------
// 3. Deleting a paid queued record
// ---------------------------------------------------------------------------

test("only a manager may delete a queued invoice or expense, and it is logged", async () => {
  assert.equal(canDiscardOfflineQueueItems(CASHIER_A), false);
  assert.equal(canDiscardOfflineQueueItems({ ...CASHIER_A, permissions: ["orders.delete"] }), false);
  assert.equal(canDiscardOfflineQueueItems(null), false);
  assert.equal(canDiscardOfflineQueueItems({ id: 1 }), false, "a user with no role is not a manager");
  assert.equal(canDiscardOfflineQueueItems(MANAGER), true);
  assert.equal(canDiscardOfflineQueueItems({ id: 3, role: "accountant", permissions: ["pos.offline_queue.discard"] }), true);
  assert.equal(isOfflineDiscardConfirmation("حذف"), true);
  assert.equal(isOfflineDiscardConfirmation("delete"), true);
  assert.equal(isOfflineDiscardConfirmation("yes"), false);

  await withBrowser(async ({ login }) => {
    const invoice = await queueInvoice(450, { offline_reference: "OFF-ABCDEFGH-260914-004" });
    const expense = await saveOfflineExpense({ category: "delivery", amount: 30, request_payload: {} });

    await assert.rejects(deleteOfflineOrder(invoice.local_id), { code: "OFFLINE_DISCARD_FORBIDDEN" });
    await assert.rejects(deleteOfflineExpense(expense.local_id), { code: "OFFLINE_DISCARD_FORBIDDEN" });
    assert.equal((await listOfflineOrders()).length, 1, "a refused delete deletes nothing");
    assert.equal(listDiscardedOfflineItems().length, 0);

    login(MANAGER);
    await deleteOfflineOrder(invoice.local_id);
    await deleteOfflineExpense(expense.local_id);
    assert.equal((await listOfflineOrders()).length, 0);

    const log = listDiscardedOfflineItems();
    assert.equal(log.length, 2);
    const [orderEntry, expenseEntry] = log;
    assert.equal(orderEntry.kind, "order");
    assert.equal(orderEntry.total, 450);
    assert.equal(orderEntry.reference, "OFF-ABCDEFGH-260914-004");
    assert.equal(orderEntry.discarded_by.id, "2");
    assert.ok(orderEntry.discarded_at);
    assert.equal(orderEntry.items.length, 1);
    assert.equal(expenseEntry.kind, "expense");
    assert.equal(expenseEntry.total, 30);
  }, { user: CASHIER_A });
});

test("the queue panel gates the delete behind the manager check and a typed confirmation", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "modules", "pos", "components", "PosOfflineQueueModal.jsx"),
    "utf8"
  );
  assert.match(source, /const canDiscard = useMemo\(\(\) => canDiscardOfflineQueueItems\(currentUser\), \[currentUser\]\);/);
  assert.match(source, /if \(!canDiscard\) \{[\s\S]{0,200}disabled/);
  assert.match(source, /disabled=\{busy \|\| !confirmed\}/);
  assert.match(source, /بتاعة كاشير تاني — لازم يسجل دخول ويرفعها/);
  // Both lists go through the one gated control.
  assert.match(source, /renderDiscardControl\(expense, onDiscardExpense, "h-7"\)/);
  assert.match(source, /renderDiscardControl\(order, onDiscardOrder\)/);
});

// ---------------------------------------------------------------------------
// 7. A pass already running
// ---------------------------------------------------------------------------

test("a pass requested mid-pass answers busy and runs right after, and syncNow waits for a real result", async () => {
  await withBrowser(async () => {
    // Owned by another cashier, so a forced pass has nothing it may actually send.
    await queueInvoice(10, { cashier: { id: 7, tenant_id: 1 } });
    let releaseProbe;
    let probes = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => {
      probes += 1;
      if (probes === 1) {
        return new Promise((resolve) => {
          releaseProbe = () => resolve({ status: 503, headers: { get: () => "application/json" } });
        });
      }
      return Promise.resolve({ status: 503, headers: { get: () => "application/json" } });
    };
    const results = [];
    const scheduler = createOfflineSyncScheduler({ onResult: ({ result }) => results.push(result), minIntervalMs: 60000 });
    try {
      // Wait for the start pass to reach its probe.
      for (let i = 0; i < 50 && !releaseProbe; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
      assert.ok(releaseProbe, "the start pass should be probing");
      assert.equal(scheduler.isSyncing(), true);

      const manual = scheduler.syncNow();
      let manualSettled = false;
      manual.then(() => { manualSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(manualSettled, false, "syncNow must wait for the running pass, not answer at once");

      // The scheduler's own run() mid-pass is a distinct busy answer, not null.
      assert.equal(BUSY_RESULT.status, "busy");

      releaseProbe();
      const result = await manual;
      assert.ok(result, "syncNow returns a real pass result");
      assert.notEqual(result.status, "busy");
      assert.equal(result.reachable, false);
      assert.ok(probes >= 2, "the manual pass ran after the first one ended");
    } finally {
      scheduler.stop();
      globalThis.fetch = previousFetch;
    }
  }, { user: CASHIER_B });
});

test("the scheduler source never answers a mid-pass request with null", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "modules", "pos", "lib", "posOfflineSync.js"), "utf8");
  assert.doesNotMatch(source, /if \(stopped \|\| inFlight\) return null;/);
  assert.match(source, /followUp = \{ reason, force: Boolean\(force \|\| followUp\?\.force\) \};\s*return Promise\.resolve\(\{ \.\.\.BUSY_RESULT \}\);/);
  assert.match(source, /if \(next && !stopped\) void run\(next\);/);
});

// ---------------------------------------------------------------------------
// 8. Receipt numbers
// ---------------------------------------------------------------------------

test("the offline receipt carries a persisted device id of at least six characters", async () => {
  await withBrowser(async ({ localStorage }) => {
    localStorage.setItem("erp.pos.offline_device_tag", "A7");
    // A short id under the new key (a hand-edited or truncated value) is not trusted either.
    localStorage.setItem("erp.pos.offline_device_id", "A7");
    const day = new Date("2026-09-14T10:00:00Z");
    const first = createOfflineInvoiceReference(day);
    const second = createOfflineInvoiceReference(day);
    const [, deviceA] = first.split("-");
    const [, deviceB] = second.split("-");
    assert.match(first, /^OFF-[A-Z0-9]{6,}-260914-001$/);
    assert.equal(deviceA, deviceB, "the device id is persisted, not re-drawn per receipt");
    assert.notEqual(deviceA, "A7", "a legacy 2-character tag is not reused");
  });
});

// ---------------------------------------------------------------------------
// 9. Stock sold offline
// ---------------------------------------------------------------------------

test("an offline sale lowers the cached catalog so a reload does not bring the stock back", async () => {
  await withBrowser(async () => {
    await savePosCatalogSnapshot([
      {
        id: 1,
        name: "Shoe",
        variants: [
          { id: 11, product_id: 1, color: "Black", size: "42", stock_quantity: 3 },
          { id: 12, product_id: 1, color: "Black", size: "43", stock_quantity: 2 },
        ],
      },
      { id: 2, name: "Socks", variants: [], stock: 5 },
    ], "v1");

    const [okFirst, okSecond] = await Promise.all([
      applyOfflineSaleToCachedCatalog([{ product_id: 1, variant_id: 11, quantity: 1 }]),
      applyOfflineSaleToCachedCatalog([
        { product_id: 1, variant_id: 11, quantity: 1 },
        { product_id: 2, variant_id: 2, quantity: 1 },
      ]),
    ]);
    assert.equal(okFirst, true);
    assert.equal(okSecond, true);

    const snapshot = await getPosCatalogSnapshot();
    assert.equal(snapshot.schema_version, POS_CATALOG_SCHEMA_VERSION);
    const shoe = snapshot.products.find((product) => product.id === 1);
    assert.equal(shoe.variants.find((variant) => variant.id === 11).stock_quantity, 1, "both concurrent sales applied, neither overwrote the other");
    assert.equal(shoe.variants.find((variant) => variant.id === 12).stock_quantity, 2);
    assert.equal(shoe.total_stock, 3);
    assert.equal(
      applySoldLinesToCatalogProducts([{ id: 1, variants: [{ id: 11, stock: 1 }] }], [{ product_id: 1, variant_id: 11, quantity: 4 }])[0]
        .variants[0].stock_quantity,
      0,
      "stock never goes negative"
    );
  });

  const simple = applySoldLinesToCatalogProducts(
    [{ id: 2, name: "Socks", variants: [], stock: 5 }],
    [{ product_id: 2, variant_id: 2, quantity: 1 }]
  );
  assert.equal(simple[0].stock, 4, "a simple product line (variant id = product id) lowers the product");

  const byColourSize = applySoldLinesToCatalogProducts(
    [{ id: 5, variants: [{ id: 51, color: "Red", size: "40", stock: 4 }] }],
    [{ product_id: 5, variant_id: "product:5", color: "red", size: "40", quantity: 1 }]
  );
  assert.equal(byColourSize[0].variants[0].stock_quantity, 3);
});

// ---------------------------------------------------------------------------
// 4. Chunk recovery offline
// ---------------------------------------------------------------------------

test("chunk recovery offline purges nothing and does not reload", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  let replaced = 0;
  let cachesDeleted = 0;
  let unregistered = 0;
  const events = [];
  globalThis.window = {
    location: { href: "https://erp.test/pos", replace: () => { replaced += 1; } },
    sessionStorage: createLocalStorageMock(),
    localStorage: createLocalStorageMock(),
    caches: { keys: async () => ["pos-shell-v12-shell"], delete: async () => { cachesDeleted += 1; return true; } },
    setTimeout,
    dispatchEvent: (event) => events.push(event.type),
  };
  try {
    setNavigator({
      onLine: false,
      serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unregistered += 1; } }] },
    });
    const chunkError = new Error("Failed to fetch dynamically imported module: https://erp.test/assets/PosRestockModal-abc.js");

    assert.equal(await isOriginReachable(), false);
    assert.equal(await recoverFromChunkLoadError(chunkError), false);
    assert.equal(replaced, 0, "no reload while offline");
    assert.equal(cachesDeleted, 0, "no cache purge while offline");
    assert.equal(unregistered, 0, "the POS worker stays registered");
    assert.deepEqual(events, ["erp:chunk-recovery-offline"]);

    // Link up but the origin unreachable: same answer.
    setNavigator({ onLine: true });
    const unreachable = await recoverFromChunkLoadError(chunkError, { probe: async () => false });
    assert.equal(unreachable, false);
    assert.equal(replaced, 0);
  } finally {
    globalThis.window = previousWindow;
    setNavigator(previousNavigator);
  }
});

test("the error boundary shows the needs-internet screen instead of the reload spinner offline", () => {
  const boundary = fs.readFileSync(path.join(process.cwd(), "src", "shared", "components", "DebugErrorBoundary.jsx"), "utf8");
  assert.match(boundary, /if \(!recovering && isChunkRecoveryBlockedOffline\(\) && !this\.unmounted\)/);
  assert.match(boundary, /if \(this\.state\.chunkOffline\) \{\s*return <ChunkOfflineFallback onBack=\{this\.handleChunkOfflineBack\} \/>;/);
});
