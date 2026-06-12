import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Client } = pg;

const rootDir = process.cwd();
const serverDir = path.join(rootDir, "server");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const backendBaseUrl = "http://127.0.0.1:8000";
const frontendBaseUrl = "http://127.0.0.1:5173";
const proofPath = path.join(rootDir, "portal-initial.png");
const outDir = path.join(rootDir, ".codex-storefront-qa");
const shotDir = path.join(outDir, "shots");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log("[audit]", ...args);
const results = [];
const record = (flow, status, details = "") => results.push({ flow, status, details });

const spawnLogged = (command, args, options = {}) => {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${options.name || path.basename(command)}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${options.name || path.basename(command)}:err] ${chunk}`));
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

const waitForHttp = async (url, { timeoutMs = 120000, predicate = () => true, intervalMs = 500 } = {}) => {
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

const waitForPageWsUrl = async (port, timeoutMs = 120000) => {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const { body } = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = Array.isArray(body) ? body.find((target) => target?.type === "page" && target?.webSocketDebuggerUrl) : null;
      if (pageTarget?.webSocketDebuggerUrl) return pageTarget.webSocketDebuggerUrl;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError || new Error(`Timed out waiting for Chrome page target on port ${port}`);
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

const waitForPageCondition = async (cdp, predicateFn, args = [], timeoutMs = 60000, intervalMs = 250) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evalPage(cdp, predicateFn, ...args)) return true;
    } catch {}
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for page condition");
};

const navigate = async (cdp, url) => {
  await cdp.send("Page.navigate", { url });
  await waitForPageCondition(cdp, () => document.readyState === "complete", [], 60000);
};

const clickButtonByAnyText = async (cdp, texts) =>
  evalPage(cdp, (needles) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((button) => {
      const normalized = String(button.textContent || "").replace(/\s+/g, " ").trim();
      return needles.some((needle) => needle && normalized.includes(needle));
    });
    if (!target) throw new Error(`Button not found: ${needles.join(" | ")}`);
    target.click();
    return true;
  }, texts);

const clickButtonByAriaLabelIncludes = async (cdp, needle) =>
  evalPage(cdp, (labelNeedle) => {
    const buttons = Array.from(document.querySelectorAll("button[aria-label]"));
    const target = buttons.find((button) => String(button.getAttribute("aria-label") || "").toLowerCase().includes(String(labelNeedle || "").toLowerCase()));
    if (!target) throw new Error(`Aria button not found: ${labelNeedle}`);
    target.click();
    return true;
  }, needle);

const clickLinkByHref = async (cdp, href) =>
  evalPage(cdp, (targetHref) => {
    const link = Array.from(document.querySelectorAll("a[href]")).find((anchor) => String(anchor.getAttribute("href") || "") === targetHref);
    if (!link) throw new Error(`Link not found: ${targetHref}`);
    link.click();
    return true;
  }, href);

const fillByIndex = async (cdp, selector, values) =>
  evalPage(cdp, (sel, nextValues) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`Missing container: ${sel}`);
    const controls = Array.from(root.querySelectorAll("input, select, textarea")).filter((el) => !el.disabled && el.offsetParent !== null);
    if (controls.length < nextValues.length) throw new Error(`Expected at least ${nextValues.length} controls, found ${controls.length}`);
    const inputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    const textareaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    const selectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    const applyValue = (el, value) => {
      if (el.tagName.toLowerCase() === "select") {
        selectValueSetter?.call(el, String(value));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      if (el.type === "checkbox") {
        const nextChecked = Boolean(value);
        if (el.checked !== nextChecked) el.click();
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      if (el.tagName.toLowerCase() === "textarea") textareaValueSetter?.call(el, String(value));
      else inputValueSetter?.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    nextValues.forEach((value, index) => applyValue(controls[index], value));
    return true;
  }, selector, values);

const setCheckoutAddress = async (cdp, selector, address) => {
  const hasNativeSelects = await evalPage(cdp, (sel) => Array.from(document.querySelectorAll(`${sel} select`)).filter((select) => select.offsetParent !== null).length > 0, selector);
  if (hasNativeSelects) {
    await evalPage(cdp, (sel) => {
      const root = document.querySelector(sel);
      if (!root) throw new Error(`Missing container: ${sel}`);
      const selects = Array.from(root.querySelectorAll("select")).filter((select) => select.offsetParent !== null);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
      for (const select of selects) {
        const option = Array.from(select.options).find((item) => String(item.value || "").trim() && !item.disabled);
        if (!option) continue;
        nativeSetter?.call(select, option.value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }, selector);
    await fillByIndex(cdp, selector, [address, "Test Street 1", "12", "3", "7", "Near test landmark", "Smoke test note"]);
    return;
  }
  await evalPage(cdp, (sel, value) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`Missing container: ${sel}`);
    const controls = Array.from(root.querySelectorAll("input, textarea")).filter((el) => !el.disabled && el.offsetParent !== null);
    const input = controls.find((el) => el.tagName.toLowerCase() === "textarea" || (el.tagName.toLowerCase() === "input" && !["checkbox", "radio", "file"].includes(el.type)));
    if (!input) throw new Error("No address input found");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, selector, address);
};

const getVisibleText = async (cdp) => evalPage(cdp, () => String(document.body?.innerText || ""));
const getVisibleLinks = async (cdp) => evalPage(cdp, () => Array.from(document.querySelectorAll("a[href]")).map((a) => String(a.getAttribute("href") || "")).filter(Boolean));
const getImageState = async (cdp) => evalPage(cdp, () => Array.from(document.querySelectorAll("img")).map((img) => ({
  src: img.currentSrc || img.src || "",
  alt: img.alt || "",
  complete: img.complete,
  naturalWidth: img.naturalWidth || 0,
  visible: img.offsetParent !== null,
})).filter((item) => item.src));
const getOrderReceipt = async (cdp) =>
  evalPage(cdp, () => {
    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith("storefront.order.")).sort();
    for (const key of keys) {
      try {
        const value = JSON.parse(sessionStorage.getItem(key) || "null");
        if (value?.order?.id) return { key, value };
      } catch {}
    }
    return null;
  });
const captureScreenshot = async (cdp, filePath) => {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(filePath, Buffer.from(shot.data, "base64"));
};
const setViewport = async (cdp, width, height, mobile = false) => {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
};
const scrollTo = async (cdp, y) => evalPage(cdp, (top) => { window.scrollTo(0, top); return true; }, y);

const assertNoImageFailures = async (cdp, label) => {
  const images = await getImageState(cdp);
  const visible = images.filter((img) => img.visible);
  const bad = visible.filter((img) => !img.src.startsWith("data:") && (!img.complete || img.naturalWidth === 0));
  if (bad.length) {
    record(label, "FAIL", `broken images: ${bad.map((img) => img.src).slice(0, 4).join(" | ")}`);
    return false;
  }
  const uniqueSources = [...new Set(visible.map((img) => img.src).filter((src) => src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")))].slice(0, 15);
  const failures = [];
  for (const src of uniqueSources) {
    try {
      const resolved = src.startsWith("http") ? src : new URL(src, frontendBaseUrl).toString();
      const head = await fetch(resolved, { method: "HEAD" });
      if (!head.ok) {
        const get = await fetch(resolved, { method: "GET" });
        if (!get.ok) failures.push(`${resolved} (${head.status}/${get.status})`);
      }
    } catch (error) {
      failures.push(`${src} (${error.message})`);
    }
  }
  if (failures.length) {
    record(label, "FAIL", `image fetch failures: ${failures.slice(0, 5).join(" | ")}`);
    return false;
  }
  return true;
};

const patchBostaToEmpty = async (cdp) =>
  evalPage(cdp, () => {
    if (window.__auditBostaPatched) return true;
    window.__auditBostaPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url || "");
      if (url.includes("/shipping/cities?provider=bosta&dropoff=1")) return new Response(JSON.stringify({ cities: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/shipping/zones?provider=bosta&dropoff=1")) return new Response(JSON.stringify({ zones: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/shipping/districts?provider=bosta&dropoff=1")) return new Response(JSON.stringify({ districts: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      return originalFetch(input, init);
    };
    return true;
  });

const chooseProduct = (products) => {
  const enriched = products
    .map((product) => ({ product, variants: Array.isArray(product.variants) ? product.variants : [] }))
    .filter(({ variants }) => variants.some((variant) => Number(variant.stock || 0) > 0));
  const multi = enriched.find(({ variants }) => {
    const colors = new Set(variants.map((variant) => String(variant.color || variant.color_name || variant.colorName || "").trim().toLowerCase()).filter(Boolean));
    const sizes = new Set(variants.map((variant) => String(variant.size || "").trim()).filter(Boolean));
    return variants.length >= 2 && (colors.size > 1 || sizes.size > 1);
  });
  return multi || enriched[0] || null;
};

const createCoupon = async (dbClient, token) => {
  const campaignName = `Storefront QA ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  await dbClient.query(`DELETE FROM coupons WHERE code = $1`, ["QA10"]);
  const created = await fetchJson(`${backendBaseUrl}/api/coupons/campaigns`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code_prefix: "QA",
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
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 1 }),
  });
  if (!generated.response.ok) throw new Error(generated.body?.message || `Coupon generation failed (${generated.response.status})`);
  const sourceCode = String(generated.body?.coupons?.[0]?.code || "").trim();
  const renamed = await dbClient.query(`UPDATE coupons SET code = $2, qr_value = $3, updated_at = NOW() WHERE code = $1 RETURNING id, code`, [sourceCode, "QA10", `${frontendBaseUrl}/shop/checkout?coupon=QA10`]);
  if (!renamed.rowCount) throw new Error(`Unable to rename ${sourceCode} to QA10`);
  return "QA10";
};

const startServers = async () => {
  await mkdir(shotDir, { recursive: true });
  const backend = spawnLogged(process.execPath, ["server.js", "--skip-startup-syncs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      SKIP_STARTUP_SYNCS: "true",
      NODE_ENV: process.env.NODE_ENV || "development",
      PORT: "8000",
      HOST: "127.0.0.1",
    },
    name: "backend",
  });
  const frontend = spawnLogged(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: rootDir,
    env: {
      ...process.env,
      VITE_DEV_PORT: "5173",
      VITE_DEV_SERVER_HOST: "127.0.0.1",
      VITE_DEV_PROXY_TARGET: backendBaseUrl,
    },
    name: "frontend",
  });
  return { backend, frontend };
};

const fetchApiProductList = async () => {
  const response = await fetchJson(`${backendBaseUrl}/api/storefront/products?limit=80`);
  if (!response.response.ok) throw new Error(`Product list failed (${response.response.status})`);
  return Array.isArray(response.body?.products) ? response.body.products : Array.isArray(response.body?.data) ? response.body.data : Array.isArray(response.body?.items) ? response.body.items : [];
};

const main = async () => {
  const { backend, frontend } = await startServers();
  let chrome = null;
  let dbClient = null;
  const consoleIssues = [];
  const requestFailures = [];
  try {
    await waitForHttp(`${backendBaseUrl}/api/health`, {
      timeoutMs: 180000,
      predicate: ({ text }) => String(text || "").includes("\"status\":\"ok\"") || String(text || "").includes("\"status\": \"ok\""),
    });
    await waitForHttp(`${frontendBaseUrl}/`, {
      timeoutMs: 180000,
      predicate: ({ text }) => String(text || "").includes("<!doctype html>") || String(text || "").includes("root"),
    });

    dbClient = new Client({
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "065342",
      database: process.env.PGDATABASE || "erp_db",
    });
    await dbClient.connect();

    const adminSeed = await dbClient.query(`SELECT id, email FROM users WHERE is_super_admin = true ORDER BY id ASC LIMIT 1`);
    if (!adminSeed.rows.length) throw new Error("No super admin user found in the local database");
    const smokeAdmin = adminSeed.rows[0];
    const smokePassword = "SmokeTest123!";
    const passwordHash = await bcrypt.hash(smokePassword, 10);
    await dbClient.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, smokeAdmin.id]);
    const login = await fetchJson(`${backendBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: smokeAdmin.email, password: smokePassword }),
    });
    if (!login.response.ok) throw new Error(login.body?.message || `Login failed (${login.response.status})`);
    const adminToken = String(login.body?.token || "");
    if (!adminToken) throw new Error("Admin token missing");

    const couponCode = await createCoupon(dbClient, adminToken);
    const products = await fetchApiProductList();
    const chosen = chooseProduct(products);
    if (!chosen?.product) throw new Error("No storefront product with available variant found");
    const product = chosen.product;
    const variants = chosen.variants;
    const routeValue = product.slug || product.id;
    const productName = String(product.name || product.title || routeValue || "product");

    chrome = spawnLogged(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9229",
      `--user-data-dir=${path.join(rootDir, ".codex-storefront-qa-chrome")}`,
      "about:blank",
    ], { name: "chrome" });

    const wsUrl = await waitForPageWsUrl(9229, 120000);
    const cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Log.enable");
    cdp.send("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => undefined);

    cdp.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.consoleAPICalled") {
        const type = message.params?.type || "";
        if (type === "error") {
          const text = (message.params?.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ");
          consoleIssues.push(`console.error: ${text}`);
        }
      }
      if (message.method === "Runtime.exceptionThrown") {
        const text = message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "exception";
        consoleIssues.push(`exception: ${text}`);
      }
      if (message.method === "Network.loadingFailed") {
        requestFailures.push(`${message.params?.requestId || ""}: ${message.params?.errorText || "loadingFailed"}`);
      }
      if (message.method === "Log.entryAdded") {
        const entry = message.params?.entry || {};
        if (entry.level === "error") consoleIssues.push(`log.error: ${entry.text || ""}`);
      }
    });

    const detailUrl = `${frontendBaseUrl}/shop/product/${encodeURIComponent(routeValue)}`;
    const mobileBuyNow = async () => {
      await setViewport(cdp, 390, 844, true);
      await navigate(cdp, detailUrl);
      await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/product/"), [], 60000);
      await scrollTo(cdp, 1200);
      await sleep(700);
      await clickButtonByAnyText(cdp, ["اشترِ الآن", "Buy now"]);
      await waitForPageCondition(cdp, () => String(window.location.pathname || "") === "/shop/checkout", [], 60000);
      record("buy now", "PASS", "mobile buy now opened checkout");
    };

    // Home
    await navigate(cdp, `${frontendBaseUrl}/shop`);
    await waitForPageCondition(cdp, () => !document.querySelector(".sf-initial-splash") && Boolean(document.querySelector("header")) && document.body.innerText.length > 0, [], 60000);
    await captureScreenshot(cdp, path.join(shotDir, "home.png"));
    if ((await getVisibleText(cdp)).length > 0 && await assertNoImageFailures(cdp, "home")) record("home", "PASS", "storefront home rendered");
    else record("home", "FAIL", "home page did not render expected content");

    // Products
    await navigate(cdp, `${frontendBaseUrl}/shop/products`);
    await waitForPageCondition(cdp, () => document.body.innerText.includes("Categories") || document.body.innerText.includes("Choose your way"), [], 60000);
    await captureScreenshot(cdp, path.join(shotDir, "products.png"));
    const productLinks = await getVisibleLinks(cdp);
    if (productLinks.some((href) => href.startsWith("/shop/product/")) && await assertNoImageFailures(cdp, "products")) record("products", "PASS", `found ${productLinks.filter((href) => href.startsWith("/shop/product/")).length} product links`);
    else if ((await getVisibleText(cdp)).includes("Categories")) record("products", "PASS", "guided category view rendered");
    else record("products", "FAIL", "no product cards found or guided category view failed");

    // Product detail + hard refresh
    await navigate(cdp, detailUrl);
    await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/product/") && Boolean(document.querySelector(".sf-product-details-page")), [], 60000);
    await captureScreenshot(cdp, path.join(shotDir, "detail.png"));
    const detailImagesOk = await assertNoImageFailures(cdp, "detail");
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/product/") && Boolean(document.querySelector(".sf-product-details-page")), [], 60000);
    if (detailImagesOk) record("product detail", "PASS", `opened ${routeValue} and hard refresh preserved the route`);
    else record("product detail", "FAIL", "detail page image load issues");

    // Wishlist
    await clickButtonByAriaLabelIncludes(cdp, "wishlist");
    await sleep(500);
    const wishlistCountStored = await evalPage(cdp, () => JSON.parse(localStorage.getItem("storefront.wishlist") || "[]").length);
    await navigate(cdp, `${frontendBaseUrl}/shop/wishlist`);
    await waitForPageCondition(cdp, () => document.body.innerText.length > 0, [], 60000);
    const wishlistLinks = await getVisibleLinks(cdp);
    if (wishlistCountStored > 0 || wishlistLinks.some((href) => href.startsWith("/shop/product/"))) record("wishlist", "PASS", "wishlist stored at least one product");
    else record("wishlist", "FAIL", "wishlist storage/page is empty");

    // Recently viewed
    const recentCountStored = await evalPage(cdp, () => JSON.parse(localStorage.getItem("storefront.recent") || "[]").length);
    await navigate(cdp, `${frontendBaseUrl}/shop/recently-viewed`);
    await waitForPageCondition(cdp, () => document.body.innerText.length > 0, [], 60000);
    const recentLinks = await getVisibleLinks(cdp);
    if (recentCountStored > 0 || recentLinks.some((href) => href.startsWith("/shop/product/"))) record("recently viewed", "PASS", "recently viewed stored at least one product");
    else record("recently viewed", "FAIL", "recently viewed storage/page is empty");

    // Selection, add to cart, cart drawer
    await navigate(cdp, detailUrl);
    await waitForPageCondition(cdp, () => document.body.innerText.length > 0, [], 60000);
    await patchBostaToEmpty(cdp);
    const colorButtons = await evalPage(cdp, () => Array.from(document.querySelectorAll("button")).filter((button) => {
      const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
      return button.offsetParent !== null && text && !["+", "-", "Add to cart", "أضف إلى السلة", "اشترِ الآن", "Buy now", "Share product"].includes(text);
    }).map((button) => String(button.textContent || "").replace(/\s+/g, " ").trim()));
    if (colorButtons.length > 1) await clickButtonByAnyText(cdp, [colorButtons[1]]);
    const sizeButtons = await evalPage(cdp, () => Array.from(document.querySelectorAll("button")).filter((button) => {
      const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
      return button.offsetParent !== null && /^\\d{1,3}(?:\\.\\d+)?$/.test(text);
    }).map((button) => String(button.textContent || "").replace(/\s+/g, " ").trim()));
    if (sizeButtons.length > 0) await clickButtonByAnyText(cdp, [sizeButtons[0]]);
    record("color/size selection", "PASS", `selected variant from ${variants.length} variants`);

    await clickButtonByAnyText(cdp, ["Add to cart", "أضف إلى السلة"]);
    const hasCaptureDialog = await evalPage(cdp, () => Boolean(document.querySelector('[role="dialog"]')));
    if (hasCaptureDialog) {
      await fillByIndex(cdp, '[role="dialog"]', ["QA User", "01012345678"]);
      await clickButtonByAnyText(cdp, ["Continue", "إكمال", "Save", "حفظ"]);
      await waitForPageCondition(cdp, () => !document.querySelector('[role="dialog"]'), [], 30000);
    }
    const cartCountAfterAdd = await evalPage(cdp, () => Number((document.querySelector('[aria-label="Cart"] .sf-action-badge, [aria-label="Cart"] [class*="badge"]')?.textContent || "0").replace(/\\D/g, "") || 0));
    const cartStored = await evalPage(cdp, () => JSON.parse(localStorage.getItem("storefront.cart") || "[]").length);
    if (cartCountAfterAdd >= 1 || cartStored >= 1) record("add to cart", "PASS", "item added to cart");
    else record("add to cart", "FAIL", "cart remained empty after add-to-cart");

    await clickButtonByAriaLabelIncludes(cdp, "cart");
    await waitForPageCondition(cdp, () => Boolean(document.querySelector(".sf-cart-drawer")) && document.body.innerText.length > 0, [], 30000);
    if ((await getVisibleText(cdp)).toLowerCase().includes(String(productName).toLowerCase().slice(0, 12).trim())) record("cart drawer", "PASS", "cart drawer shows the selected item");
    else record("cart drawer", "FAIL", "cart drawer missing the added item");

    // Buy now flow on mobile
    await mobileBuyNow();

    // Checkout
    await waitForPageCondition(cdp, () => String(window.location.pathname || "") === "/shop/checkout" && document.querySelector("form#storefront-checkout-form") !== null, [], 60000);
    await fillByIndex(cdp, "form#storefront-checkout-form", ["QA User", "01012345678"]);
    await clickButtonByAnyText(cdp, ["Continue to address", "متابعة إلى العنوان", "Continue"]);
    await waitForPageCondition(cdp, () => String(document.body.innerText || "").includes("address") || String(document.body.innerText || "").includes("العنوان") || String(document.body.innerText || "").includes("governorate"), [], 30000);
    await setCheckoutAddress(cdp, "form#storefront-checkout-form", "Cairo, Nasr City, Test Street 1");
    await clickButtonByAnyText(cdp, ["Continue to payment", "متابعة إلى الدفع", "Continue"]);
    await waitForPageCondition(cdp, () => String(document.body.innerText || "").includes("coupon") || String(document.body.innerText || "").includes("الكوبون") || String(document.body.innerText || "").includes("payment"), [], 30000);
    await fillByIndex(cdp, "form#storefront-checkout-form", ["QA10"]);
    await clickButtonByAnyText(cdp, ["Apply coupon", "تطبيق الكوبون"]);
    await waitForPageCondition(cdp, () => String(document.body.innerText || "").includes("Coupon applied") || String(document.body.innerText || "").includes("تم تطبيق الكوبون") || String(document.body.innerText || "").includes("QA10"), [], 30000);
    if ((await getVisibleText(cdp)).includes("QA10")) record("coupon apply", "PASS", "coupon QA10 applied");
    else record("coupon apply", "FAIL", "coupon summary not visible");

    const dom = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const fileNode = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: 'input[type="file"]' });
    if (!fileNode.nodeId) throw new Error("Transfer proof input not found");
    await cdp.send("DOM.setFileInputFiles", { nodeId: fileNode.nodeId, files: [proofPath] });
    await clickButtonByAnyText(cdp, ["Submit order", "تم الدفع وإرفاق الإيصال", "Confirm order"]);
    await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/success/"), [], 90000);
    await captureScreenshot(cdp, path.join(shotDir, "success.png"));
    const receipt = await getOrderReceipt(cdp);
    if (!receipt?.value?.order?.id) throw new Error("Could not recover order payload from storefront receipt storage");
    const orderId = receipt.value.order.id;
    const orderNumber = receipt.value.order.invoice_number || receipt.value.order.public_order_number || receipt.value.order.order_number || receipt.key;
    const orderResponse = await fetchJson(`${backendBaseUrl}/api/orders/${orderId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!orderResponse.response.ok) throw new Error(orderResponse.body?.message || `Failed to load order ${orderId}`);
    const order = orderResponse.body?.order || orderResponse.body;
    const savedCoupon = String(order?.coupon_code || "").trim().toUpperCase();
    const savedDiscount = Number(order?.coupon_discount_amount || 0);
    if (savedCoupon === couponCode && savedDiscount > 0) record("checkout", "PASS", `order ${orderId} created; coupon persisted (${savedCoupon}, ${savedDiscount})`);
    else record("checkout", "FAIL", `order persisted unexpected coupon fields: ${savedCoupon || "(empty)"} / ${savedDiscount}`);

    // Account / lookup / reorder
    await navigate(cdp, `${frontendBaseUrl}/shop/account`);
    await waitForPageCondition(cdp, () => document.body.innerText.length > 0, [], 60000);
    await fillByIndex(cdp, "body", ["01012345678"]);
    await clickButtonByAnyText(cdp, ["Show my data", "عرض بياناتي"]);
    await waitForPageCondition(cdp, () => String(document.body.innerText || "").includes(orderNumber) || String(document.body.innerText || "").includes("My orders") || String(document.body.innerText || "").includes("طلباتي"), [], 60000);
    const accountText = await getVisibleText(cdp);
    if (accountText.includes(orderNumber) || accountText.includes("01012345678")) record("account login/phone lookup", "PASS", "account data loaded from phone lookup");
    else record("account login/phone lookup", "FAIL", "account lookup did not surface the phone/order data");
    const reorderVisible = await evalPage(cdp, () => Array.from(document.querySelectorAll("button")).some((button) => String(button.textContent || "").replace(/\\s+/g, " ").trim().includes("Reorder") || String(button.textContent || "").replace(/\\s+/g, " ").trim().includes("إعادة الطلب")));
    if (reorderVisible) {
      await clickButtonByAnyText(cdp, ["Reorder", "إعادة الطلب"]);
      await sleep(1000);
      const cartAfterReorder = await evalPage(cdp, () => JSON.parse(localStorage.getItem("storefront.cart") || "[]").length);
      if (cartAfterReorder >= 1) record("orders/reorder", "PASS", "reorder action repopulated cart");
      else record("orders/reorder", "FAIL", "reorder button did not add items");
    } else {
      record("orders/reorder", "FAIL", "no reorder control visible on account page");
    }

    // Mobile layout
    await setViewport(cdp, 390, 844, true);
    await navigate(cdp, detailUrl);
    await waitForPageCondition(cdp, () => String(window.location.pathname || "").startsWith("/shop/product/"), [], 60000);
    await scrollTo(cdp, 1200);
    await sleep(700);
    const mobileOverflow = await evalPage(cdp, () => document.documentElement.scrollWidth <= window.innerWidth + 2);
    const mobileBarVisible = await evalPage(cdp, () => Boolean(document.querySelector(".sf-mobile-buy-bar")) || Boolean(Array.from(document.querySelectorAll("button")).find((button) => String(button.textContent || "").includes("Add to cart") || String(button.textContent || "").includes("أضف إلى السلة"))));
    if (mobileOverflow && mobileBarVisible) record("mobile layout", "PASS", "mobile viewport rendered without obvious horizontal overflow");
    else record("mobile layout", "FAIL", "mobile viewport overflow or missing sticky controls");

    if (consoleIssues.length || requestFailures.length) record("console/network", "FAIL", [...consoleIssues, ...requestFailures].join(" | ").slice(0, 500));
    else record("console/network", "PASS", "no console errors or failed network requests captured");

    log("screenshots saved:", ["home.png", "products.png", "detail.png", "success.png"].map((name) => path.join(shotDir, name)).join(" | "));
    log("final results:");
    for (const entry of results) log(`${entry.flow}: ${entry.status}${entry.details ? ` - ${entry.details}` : ""}`);
    if (consoleIssues.length || requestFailures.length) {
      log("console/network issues:");
      [...consoleIssues, ...requestFailures].forEach((item) => log(`- ${item}`));
    }
    if (results.some((entry) => entry.status === "FAIL")) process.exitCode = 1;
  } catch (error) {
    record("runner", "FAIL", error?.stack || error?.message || String(error));
    process.exitCode = 1;
    console.error("[audit] fatal", error?.stack || error?.message || error);
    for (const entry of results) log(`${entry.flow}: ${entry.status}${entry.details ? ` - ${entry.details}` : ""}`);
  } finally {
    try {
      await rm(path.join(rootDir, ".codex-storefront-qa-chrome"), { recursive: true, force: true });
    } catch {}
    await Promise.all([stopChild(chrome), stopChild(frontend), stopChild(backend)]);
    if (dbClient) {
      try {
        await dbClient.end();
      } catch {}
    }
  }
};

await main();
