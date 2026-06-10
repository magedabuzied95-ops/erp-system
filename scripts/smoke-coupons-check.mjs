import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

const { Client } = pg;

const rootDir = process.cwd();
const serverDir = path.join(rootDir, "server");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const backendBaseUrl = "http://127.0.0.1:8000";
const frontendPort = 5175;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const proofDir = path.join(rootDir, ".codex-smoke");
const proofPath = path.join(proofDir, "coupon-proof.png");

const adminEmail = "admin@erp.local";
const adminPassword = "admin123";

const sleep = (ms) => delay(ms);
const log = (...args) => console.log("[smoke]", ...args);

const spawnLogged = (command, args, options = {}) => {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${options.name || path.basename(command)}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${options.name || path.basename(command)}:err] ${chunk}`));
  return child;
};

const stopChild = async (child) => {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {}
  await sleep(500);
  if (!child.killed) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
};

const waitForHttp = async (url, { timeoutMs = 120_000, predicate = () => true, intervalMs = 500 } = {}) => {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (response.ok && predicate({ response, text })) return { response, text };
      lastError = new Error(`Unexpected response ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
};

const waitForWsUrl = async (port, timeoutMs = 120_000) => {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const { body } = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (body?.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError || new Error(`Timed out waiting for Chrome on port ${port}`);
};

const connectCdp = async (wsUrl) => {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || `CDP ${message.id} failed`));
    else entry.resolve(message.result);
  });

  return { socket, send };
};

const evalPage = async (cdp, fn, ...args) => {
  const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Page evaluation failed");
  }
  return result.result?.value;
};

const waitForPageCondition = async (cdp, predicateFn, args = [], timeoutMs = 60_000, intervalMs = 250) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evalPage(cdp, predicateFn, ...args)) return true;
    } catch {
      // ignore intermediate navigation errors
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for page condition");
};

const navigate = async (cdp, url) => {
  await cdp.send("Page.navigate", { url });
  await waitForPageCondition(cdp, () => document.readyState === "complete", [], 60_000);
};

const setStorageAndReload = async (cdp, entries) => {
  await evalPage(
    cdp,
    (payload) => {
      Object.entries(payload).forEach(([key, value]) => localStorage.setItem(key, value));
    },
    entries
  );
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForPageCondition(cdp, () => document.readyState === "complete", [], 60_000);
};

const fillByIndex = async (cdp, selector, values) => {
  await evalPage(
    cdp,
    (sel, nextValues) => {
      const root = document.querySelector(sel);
      if (!root) throw new Error(`Missing container: ${sel}`);
      const controls = Array.from(root.querySelectorAll("input, select, textarea")).filter((el) => !el.disabled && el.offsetParent !== null);
      if (controls.length < nextValues.length) throw new Error(`Expected at least ${nextValues.length} controls, found ${controls.length}`);
      const applyValue = (el, value) => {
        if (el.tagName.toLowerCase() === "select") {
          el.value = String(value);
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        if (el.type === "checkbox") {
          el.checked = Boolean(value);
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        el.value = String(value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      nextValues.forEach((value, index) => applyValue(controls[index], value));
      return true;
    },
    selector,
    values
  );
};

const setCheckoutAddress = async (cdp, selector, address) => {
  const selectAt = async (index) =>
    evalPage(
      cdp,
      (sel, idx) => {
        const root = document.querySelector(sel);
        if (!root) throw new Error(`Missing container: ${sel}`);
        const controls = Array.from(root.querySelectorAll("input, select, textarea")).filter((el) => !el.disabled && el.offsetParent !== null);
        const selects = controls.filter((el) => el.tagName.toLowerCase() === "select");
        const select = selects[idx];
        if (!select) return false;
        const option = Array.from(select.options).find((item) => String(item.value || "").trim() && !item.disabled);
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return select.value;
      },
      selector,
      index
    );

  const setAddressInput = async () =>
    evalPage(
      cdp,
      (sel, value) => {
        const root = document.querySelector(sel);
        if (!root) throw new Error(`Missing container: ${sel}`);
        const controls = Array.from(root.querySelectorAll("input, select, textarea")).filter((el) => !el.disabled && el.offsetParent !== null);
        const input = controls.find((el) => {
          if (el.tagName.toLowerCase() === "textarea") return true;
          if (el.tagName.toLowerCase() !== "input") return false;
          return !["checkbox", "radio", "file"].includes(el.type);
        });
        if (!input) return false;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input.value;
      },
      selector,
      address
    );

  await selectAt(0);
  await waitForPageCondition(cdp, () => Array.from(document.querySelectorAll("select")).some((select) => select.options.length > 1), [], 20_000);
  await selectAt(1);
  await waitForPageCondition(cdp, () => Array.from(document.querySelectorAll("select")).filter((select) => select.options.length > 1).length >= 2, [], 20_000);
  await selectAt(2);
  await setAddressInput();
};

const clickButtonByText = async (cdp, text) =>
  evalPage(
    cdp,
    (needle) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((button) => String(button.textContent || "").replace(/\s+/g, " ").trim().includes(needle));
      if (!target) throw new Error(`Button not found: ${needle}`);
      target.click();
      return true;
    },
    text
  );

const clickLinkByHref = async (cdp, href) =>
  evalPage(
    cdp,
    (targetHref) => {
      const link = Array.from(document.querySelectorAll("a[href]")).find((anchor) => String(anchor.getAttribute("href") || "") === targetHref);
      if (!link) throw new Error(`Link not found: ${targetHref}`);
      link.click();
      return true;
    },
    href
  );

const getVisibleText = async (cdp) => evalPage(cdp, () => String(document.body?.innerText || ""));

const getToastText = async (cdp) =>
  evalPage(
    cdp,
    () => {
      const nodes = Array.from(document.querySelectorAll('[role="status"], [role="alert"], .Toastify__toast-body, [data-sonner-toast]'));
      return nodes.map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).pop() || "";
    }
  );

const createSmokeCoupon = async ({ token, dbClient }) => {
  const campaignName = `Smoke TEST10 ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  await dbClient.query(`DELETE FROM coupons WHERE code = $1`, ["TEST10"]);

  const created = await fetchJson(`${backendBaseUrl}/api/coupons/campaigns`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: campaignName,
      code_prefix: "TEST",
      discount_type: "percentage",
      discount_value: 10,
      minimum_order_amount: 0,
      usage_limit_per_coupon: 1,
      total_coupons: 1,
      channel: "all",
      is_active: true,
    }),
  });
  if (!created.response.ok) throw new Error(created.body?.message || `Campaign create failed (${created.response.status})`);

  const campaign = created.body.campaign;
  const generated = await fetchJson(`${backendBaseUrl}/api/coupons/campaigns/${campaign.id}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ quantity: 1 }),
  });
  if (!generated.response.ok) throw new Error(generated.body?.message || `Coupon generation failed (${generated.response.status})`);

  const sourceCode = String(generated.body?.coupons?.[0]?.code || "").trim();
  const renamed = await dbClient.query(
    `UPDATE coupons SET code = $2, qr_value = $3, updated_at = NOW() WHERE code = $1 RETURNING id, code`,
    [sourceCode, "TEST10", `${frontendBaseUrl}/checkout?coupon=TEST10`]
  );
  if (!renamed.rowCount) throw new Error(`Unable to rename ${sourceCode} to TEST10`);

  log(`coupon ready: ${sourceCode} -> TEST10`);
  return { campaign, code: "TEST10" };
};

const openFirstProduct = async (cdp) => {
  await navigate(cdp, `${frontendBaseUrl}/shop/products`);
  await waitForPageCondition(cdp, () => Boolean(Array.from(document.querySelectorAll('a[href^="/shop/product/"]')).find((link) => link.offsetParent !== null)), [], 60_000);
  const productHref = await evalPage(
    cdp,
    () => Array.from(document.querySelectorAll('a[href^="/shop/product/"]')).find((link) => link.offsetParent !== null)?.getAttribute("href") || ""
  );
  if (!productHref) throw new Error("No storefront product found");
  await clickLinkByHref(cdp, productHref);
  await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/product/"), [], 60_000);
  return productHref;
};

const addProductToCart = async (cdp) => {
  await clickButtonByText(cdp, "إضافة للسلة");
  const captureVisible = await waitForPageCondition(cdp, () => Boolean(document.querySelector('[aria-labelledby="customer-capture-title"]')), [], 5_000).catch(() => false);
  if (captureVisible) {
    await clickButtonByText(cdp, "تخطي الآن");
    await waitForPageCondition(cdp, () => !document.querySelector('[aria-labelledby="customer-capture-title"]'), [], 20_000);
  }
  await navigate(cdp, `${frontendBaseUrl}/shop/cart`);
  await waitForPageCondition(cdp, () => document.querySelectorAll(".sf-cart-row").length > 0, [], 30_000);
};

const reachCheckoutPayment = async (cdp) => {
  await navigate(cdp, `${frontendBaseUrl}/shop/checkout`);
  await waitForPageCondition(cdp, () => String(window.location.pathname || "") === "/shop/checkout", [], 30_000);

  await fillByIndex(cdp, "form#storefront-checkout-form", ["Smoke Test Customer", "01012345678"]);
  await evalPage(cdp, () => document.querySelector("form#storefront-checkout-form")?.requestSubmit());
  await waitForPageCondition(cdp, () => String(document.body?.innerText || "").includes("عنوان التوصيل"), [], 30_000);

  await setCheckoutAddress(cdp, "form#storefront-checkout-form", "Cairo, Nasr City, Test Street 1");
  await evalPage(cdp, () => document.querySelector("form#storefront-checkout-form")?.requestSubmit());
  await waitForPageCondition(cdp, () => String(document.body?.innerText || "").includes("طريقة الدفع"), [], 30_000);
};

const applyCoupon = async (cdp, code) => {
  await evalPage(
    cdp,
    (couponCode) => {
      const label = Array.from(document.querySelectorAll("label")).find((node) => String(node.textContent || "").includes("الكوبون") || String(node.textContent || "").includes("coupon"));
      const input = label?.querySelector("input") || Array.from(document.querySelectorAll("input")).find((field) => String(field.placeholder || "").toLowerCase().includes("coupon"));
      if (!input) throw new Error("Coupon input not found");
      input.value = couponCode;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    code
  );
  await clickButtonByText(cdp, "تطبيق الكوبون");
};

const uploadProofAndSubmit = async (cdp) => {
  const dom = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: 'input[type="file"]' });
  if (!node.nodeId) throw new Error("Transfer proof input not found");
  await cdp.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [proofPath] });
  await clickButtonByText(cdp, "تم الدفع وإرفاق الإيصال");
  await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/success/"), [], 90_000);
};

const getReceipt = async (cdp) =>
  evalPage(
    cdp,
    () => {
      const keys = Object.keys(sessionStorage).filter((key) => key.startsWith("storefront.order.")).sort();
      for (const key of keys) {
        try {
          const value = JSON.parse(sessionStorage.getItem(key) || "null");
          if (value?.order?.id) return { key, value };
        } catch {}
      }
      return null;
    }
  );

const openAdminOrder = async (cdp, orderId) => {
  await navigate(cdp, `${frontendBaseUrl}/orders/${orderId}`);
  await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/orders/") && String(document.body?.innerText || "").length > 0, [], 60_000);
};

const main = async () => {
  await mkdir(proofDir, { recursive: true });
  await writeFile(
    proofPath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5qXioAAAAASUVORK5CYII=", "base64")
  );

  const backend = spawnLogged(process.execPath, ["server.js", "--skip-startup-syncs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      SKIP_STARTUP_SYNCS: "true",
      NODE_ENV: process.env.NODE_ENV || "development",
      PORT: "8000",
      HOST: "0.0.0.0",
    },
    name: "backend",
  });

  const frontend = spawnLogged(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], {
    cwd: rootDir,
    env: {
      ...process.env,
      VITE_DEV_PORT: String(frontendPort),
      VITE_DEV_SERVER_HOST: "127.0.0.1",
      VITE_DEV_PROXY_TARGET: backendBaseUrl,
    },
    name: "frontend",
  });

  let chrome = null;
  let dbClient = null;

  try {
    await waitForHttp(`${backendBaseUrl}/api/health`, {
      timeoutMs: 180_000,
      predicate: ({ text }) => String(text || "").includes("healthy"),
    });
    log("backend is healthy");

    await waitForHttp(`${frontendBaseUrl}/`, {
      timeoutMs: 180_000,
      predicate: ({ text }) => String(text || "").includes("<!doctype html>") || String(text || "").includes("root"),
    });
    log("frontend is reachable");

    const login = await fetchJson(`${backendBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    if (!login.response.ok) throw new Error(login.body?.message || `Login failed (${login.response.status})`);

    const adminToken = String(login.body?.token || "");
    const adminUser = login.body?.user || {};
    if (!adminToken) throw new Error("Admin token missing");

    dbClient = new Client({
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "065342",
      database: process.env.PGDATABASE || "erp_db",
    });
    await dbClient.connect();

    await createSmokeCoupon({ token: adminToken, dbClient });

    chrome = spawnLogged(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9226",
        `--user-data-dir=${path.join(rootDir, ".codex-chrome-smoke")}`,
        "about:blank",
      ],
      { name: "chrome" }
    );

    const wsUrl = await waitForWsUrl(9226, 120_000);
    const cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    await setStorageAndReload(cdp, {
      token: adminToken,
      user: JSON.stringify({ ...adminUser, permissions: Array.isArray(adminUser.permissions) ? adminUser.permissions : ["*"] }),
      app_language: "en",
    });

    await navigate(cdp, `${frontendBaseUrl}/marketing/coupons`);
    await waitForPageCondition(cdp, () => Boolean(document.querySelector('a[href="/marketing/coupons"]')) && String(document.body?.innerText || "").includes("Coupons"), [], 60_000);
    log("admin coupons page is visible from the sidebar");

    await clickButtonByText(cdp, "New campaign");
    await waitForPageCondition(cdp, () => Boolean(document.querySelector('[role="dialog"]')), [], 20_000);
    await fillByIndex(cdp, '[role="dialog"]', [
      "Smoke TEST10",
      "TEST",
      "percentage",
      "10",
      "0",
      "",
      "1",
      "1",
      "",
      "",
      "all",
      true,
    ]);
    await clickButtonByText(cdp, "Save");
    await waitForPageCondition(cdp, () => !document.querySelector('[role="dialog"]'), [], 20_000);
    await waitForPageCondition(cdp, () => String(document.body?.innerText || "").includes("Smoke TEST10"), [], 30_000);
    log("coupon campaign created from admin UI");

    await setStorageAndReload(cdp, {
      token: adminToken,
      user: JSON.stringify({ ...adminUser, permissions: Array.isArray(adminUser.permissions) ? adminUser.permissions : ["*"] }),
      app_language: "ar",
    });

    await navigate(cdp, `${frontendBaseUrl}/shop/products`);
    await openFirstProduct(cdp);
    await addProductToCart(cdp);
    await reachCheckoutPayment(cdp);

    await applyCoupon(cdp, "BADCODE");
    await waitForPageCondition(cdp, () => String(document.body?.innerText || "").includes("كود الكوبون غير صالح"), [], 20_000);
    log("invalid coupon message verified in Arabic");

    await applyCoupon(cdp, "TEST10");
    await waitForPageCondition(cdp, () => String(document.body?.innerText || "").includes("تم تطبيق الكوبون: TEST10"), [], 20_000);
    log("TEST10 applied and discount shown in checkout");

    await uploadProofAndSubmit(cdp);
    const receipt = await getReceipt(cdp);
    if (!receipt?.value?.order?.id) throw new Error("Could not recover order payload from storefront receipt storage");

    const orderId = receipt.value.order.id;
    const orderNumber = receipt.value.order.invoice_number || receipt.value.order.public_order_number || receipt.value.order.order_number || receipt.key;
    log(`checkout completed: orderId=${orderId}, orderNumber=${orderNumber}`);

    await openAdminOrder(cdp, orderId);

    const orderResponse = await fetchJson(`${backendBaseUrl}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!orderResponse.response.ok) throw new Error(orderResponse.body?.message || `Failed to load order ${orderId}`);

    const order = orderResponse.body?.order || orderResponse.body;
    const couponCode = String(order?.coupon_code || "").trim().toUpperCase();
    const discountAmount = Number(order?.coupon_discount_amount || 0);
    if (couponCode !== "TEST10") throw new Error(`Expected coupon_code TEST10, got ${couponCode || "(empty)"}`);
    if (!(discountAmount > 0)) throw new Error(`Expected positive coupon_discount_amount, got ${discountAmount}`);
    log(`admin order persisted coupon fields: coupon_code=${couponCode}, coupon_discount_amount=${discountAmount}`);

    log("smoke test completed successfully");
    log("flag used: SKIP_STARTUP_SYNCS=true");
  } finally {
    await Promise.all([stopChild(chrome), stopChild(frontend), stopChild(backend)]);
    if (dbClient) {
      try {
        await dbClient.end();
      } catch {}
    }
    try {
      await rm(proofPath, { force: true });
      await rm(proofDir, { recursive: true, force: true });
    } catch {}
  }
};

main().catch((error) => {
  console.error("[smoke] failed:", error?.stack || error?.message || error);
  process.exitCode = 1;
});
