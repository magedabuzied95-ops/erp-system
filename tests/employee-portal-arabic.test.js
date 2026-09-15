import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-09-10: on a phone set to English the employee portal showed its own Arabic
// buttons next to an English "Shipping orders" one (the dictionary followed the phone),
// and nobody found the page. The portal home and the shipping page pin Arabic at
// runtime, without writing the ERP's language setting.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the employee portal home and the shipping page run in Arabic", () => {
  const home = read("../src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(home, /useEmployeePortalArabic\(\);/);
  const shipping = read("../src/modules/employees/pages/EmployeePortalOnlineOrders.jsx");
  assert.match(shipping, /= useEmployeePortalArabic\(\);/);
});

// 2026-09-15: الرسائل took الطلبات's slot, right after الشحن (owner request); الطلبات
// stays reachable from its badge on the home.
test("الشحن sits in the bottom bar after المهام, then الرسائل where الطلبات was, each opening its own page", () => {
  const home = read("../src/modules/employees/pages/EmployeePayrollPortal.jsx");
  const tabs = home.slice(home.indexOf("const mobileTabs = ["), home.indexOf("];", home.indexOf("const mobileTabs = [")));
  const order = ["\"tasks\"", "ONLINE_ORDERS_NAV_KEY", "INBOX_NAV_KEY", "\"display-refill\""].map((token) => tabs.indexOf(token));
  assert.ok(order.every((index) => index > 0) && order.every((index, i) => i === 0 || order[i - 1] < index), `order was ${order}`);
  assert.doesNotMatch(tabs, /"requests"/, "الطلبات left the bottom bar");
  assert.match(home, /\{ key: "requests", count: badgeCounts\.pendingNotifications/, "الطلبات is still reachable from the home");
  assert.match(tabs, /\.\.\.\(inboxEnabled \? \[\[INBOX_NAV_KEY/, "only switched-on employees get الرسائل");
  assert.match(home, /onClick=\{\(\) => \(key === ONLINE_ORDERS_NAV_KEY \? openOnlineOrdersPage\(\) : key === INBOX_NAV_KEY \? navigate\(/);
  assert.doesNotMatch(home, /employee-inbox-link/, "no second الرسائل entry on the home");
  assert.doesNotMatch(home, /employee-online-orders-link/, "the home no longer carries a second entry");
});

// 2026-09-11 "heavy, and the first tap crashes": a cold tap reloaded the whole app (full
// load), and after a deploy the page's old chunk was gone. The page is fetched while the
// home is idle, the tap navigates inside the app once it is in memory, and only a chunk
// that cannot be fetched falls back to a full load — which lands on the fresh build.
test("الشحن is prefetched on idle and opened in-app, with a full load only as the fallback", () => {
  const home = read("../src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(home, /createChunkPreloader\(\(\) => import\("\.\/EmployeePortalOnlineOrders"\)\)/);
  assert.match(home, /idle\(\(\) => \{ preloadOnlineOrdersPage\(\)\.catch\(\(\) => \{\}\); \}/);
  assert.match(home, /preloadOnlineOrdersPage\(\)\s*\.then\(\(\) => navigate\(path\)\)\s*\.catch\(\(\) => window\.location\.assign\(path\)\)/);
  assert.match(home, /const path = `\$\{employeeFeatureBasePath\}\/\$\{encodeURIComponent\(token\)\}\/online-orders`;/);
});

test("the installed employee app routes الشحن itself — it never mounts App.jsx", () => {
  const main = read("../src/main.jsx");
  const routes = main.slice(main.indexOf("if (isEmployeeAppRoute)"), main.indexOf("} else {"));
  const onlineOrders = routes.indexOf('path="/employee-app/:token/online-orders"');
  const home = routes.indexOf('path="/employee-app/:token"');
  assert.ok(onlineOrders > 0 && onlineOrders < home, "the page route must exist and come before the home");
  assert.match(routes, /lazy\(\(\) => importWithChunkRetry\(\(\) => import\("\.\/modules\/employees\/pages\/EmployeePortalOnlineOrders\.jsx"\)\)\)/);
  assert.match(routes, /<PortalUpdateWatcher \/>/);
});

test("a chunk preloader shares one load and forgets a failed one", async () => {
  const { createChunkPreloader } = await import("../src/shared/utils/chunkLoadRecovery.js");
  let calls = 0;
  let fail = true;
  const preload = createChunkPreloader(() => {
    calls += 1;
    return fail ? Promise.reject(new Error("boom")) : Promise.resolve({ default: "page" });
  });
  await assert.rejects(preload({ quiet: true }), /boom/);
  fail = false;
  const first = preload();
  assert.equal(preload(), first, "concurrent callers share the promise");
  assert.deepEqual(await first, { default: "page" });
  assert.equal(calls, 2, "the failed load was retried, the good one was not repeated");
});

test("the switch is runtime only — it never persists a language choice", () => {
  const hook = read("../src/modules/employees/lib/employeePortalLanguage.js");
  assert.match(hook, /activateRuntimeLanguage\("ar"\)/);
  assert.doesNotMatch(hook, /persistApplicationLanguage|localStorage/);
});
