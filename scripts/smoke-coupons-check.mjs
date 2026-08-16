import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import bcrypt from "bcryptjs";
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

const waitForPageWsUrl = async (port, timeoutMs = 120_000) => {
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
          if (el.checked !== nextChecked) {
            el.click();
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        if (el.tagName.toLowerCase() === "textarea") {
          textareaValueSetter?.call(el, String(value));
        } else {
          inputValueSetter?.call(el, String(value));
        }
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
  const clickPickerOption = async (pickerIndex, optionIndex = 0) =>
    evalPage(
      cdp,
      async (sel, idx, optIndex) => {
        const root = document.querySelector(sel);
        if (!root) throw new Error(`Missing container: ${sel}`);
        const triggers = Array.from(root.querySelectorAll('button[aria-haspopup="dialog"]')).filter((button) => button.offsetParent !== null);
        const trigger = triggers[idx];
        if (!trigger) throw new Error(`Picker trigger not found at index ${idx}`);
        trigger.click();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const picker = trigger.closest(".sf-checkout-field") || trigger.parentElement || root;
        const optionButtons = Array.from(picker.querySelectorAll("button")).filter((button) => {
          if (button === trigger) return false;
          const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) return false;
          if (text === "Clear" || text === "Close" || text === "×") return false;
          return button.offsetParent !== null;
        });
        const button = optionButtons[Math.min(optIndex, optionButtons.length - 1)];
        if (!button) throw new Error(`Picker option not found`);
        button.click();
        return button.textContent || "";
      },
      selector,
      pickerIndex,
      optionIndex
    );

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

  const hasNativeSelects = await evalPage(
    cdp,
    (sel) => Array.from(document.querySelectorAll(`${sel} select`)).filter((select) => select.offsetParent !== null).length > 0,
    selector
  );

  if (hasNativeSelects) {
    await selectAt(0);
    await waitForPageCondition(cdp, () => Array.from(document.querySelectorAll("select")).some((select) => select.options.length > 1), [], 20_000);
    await selectAt(1);
    await waitForPageCondition(cdp, () => Array.from(document.querySelectorAll("select")).filter((select) => select.options.length > 1).length >= 2, [], 20_000);
    await selectAt(2);
    await setAddressInput();
    return;
  }

  const choosePickerOptionByText = async (pickerIndex, labelNeedle) =>
    evalPage(
      cdp,
      async (sel, idx, needle) => {
        const root = document.querySelector(sel);
        if (!root) throw new Error(`Missing container: ${sel}`);
        const triggers = Array.from(root.querySelectorAll('button[aria-haspopup="dialog"]')).filter((button) => button.offsetParent !== null);
        const trigger = triggers[idx];
        if (!trigger) throw new Error(`Picker trigger not found at index ${idx}`);
        trigger.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const picker = trigger.closest(".sf-checkout-field") || trigger.parentElement || root;
        const optionButtons = Array.from(picker.querySelectorAll("button")).filter((button) => {
          if (button === trigger) return false;
          const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
          return text && text.includes(needle) && button.offsetParent !== null;
        });
        const button = optionButtons[0];
        if (!button) {
          const visibleTexts = Array.from(picker.querySelectorAll("button"))
            .map((item) => String(item.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
          throw new Error(`Picker option not found for ${needle}. Visible: ${visibleTexts.join(" | ")}`);
        }
        button.click();
        return button.textContent || "";
      },
      selector,
      pickerIndex,
      labelNeedle
    );

  const chooseLabel = (item = {}) => String(item.name_ar || item.governorate_name_ar || item.city_name_ar || item.area_name_ar || item.name_en || item.governorate_name_en || item.city_name_en || item.area_name_en || item.name || "").trim();
  const citiesResponse = await fetchJson(`${backendBaseUrl}/api/shipping/cities?provider=bosta&dropoff=1`);
  const cities = Array.isArray(citiesResponse.body?.cities) ? citiesResponse.body.cities : [];
  const city = cities[0];
  if (!city) throw new Error("No Bosta city available for checkout smoke test");
  const cityLabel = chooseLabel(city);
  await choosePickerOptionByText(0, cityLabel);
  await waitForPageCondition(
    cdp,
    () => {
      const root = document.querySelector(selector);
      const triggers = Array.from(root?.querySelectorAll('button[aria-haspopup="dialog"]') || []).filter((button) => button.offsetParent !== null);
      return Boolean(triggers[1] && !triggers[1].disabled);
    },
    [],
    20_000
  );

  const zonesResponse = await fetchJson(`${backendBaseUrl}/api/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(city.id)}`);
  const zones = Array.isArray(zonesResponse.body?.zones) ? zonesResponse.body.zones : [];
  const zone = zones[0];
  if (!zone) throw new Error("No Bosta zone available for checkout smoke test");
  const zoneLabel = chooseLabel(zone);
  await choosePickerOptionByText(1, zoneLabel);
  await waitForPageCondition(
    cdp,
    () => {
      const root = document.querySelector(selector);
      const triggers = Array.from(root?.querySelectorAll('button[aria-haspopup="dialog"]') || []).filter((button) => button.offsetParent !== null);
      return Boolean(triggers[2] && !triggers[2].disabled);
    },
    [],
    20_000
  );

  const districtsResponse = await fetchJson(`${backendBaseUrl}/api/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(zone.id)}`);
  const districts = Array.isArray(districtsResponse.body?.districts) ? districtsResponse.body.districts : [];
  const district = districts[0];
  if (!district) throw new Error("No Bosta district available for checkout smoke test");
  const districtLabel = chooseLabel(district);
  await choosePickerOptionByText(2, districtLabel);
  await fillByIndex(cdp, selector, [address, "Test Street 1", "12", "3", "7", "Near test landmark", "Smoke test note"]);
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

const clickButtonByAnyText = async (cdp, texts) =>
  evalPage(
    cdp,
    (needles) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((button) => {
        const normalized = String(button.textContent || "").replace(/\s+/g, " ").trim();
        return needles.some((needle) => needle && normalized.includes(needle));
      });
      if (!target) throw new Error(`Button not found: ${needles.join(" | ")}`);
      target.click();
      return true;
    },
    texts
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

const addProductToCart = async (cdp, adminToken) => {
  const buttonLabels = await evalPage(cdp, () =>
    Array.from(document.querySelectorAll("button"))
      .map((button) => String(button.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 40)
  );
  log(`product page buttons: ${buttonLabels.join(" | ")}`);

  const productsResponse = await fetchJson(`${backendBaseUrl}/api/storefront/products?limit=160`);
  const products = Array.isArray(productsResponse.body?.products)
    ? productsResponse.body.products
    : Array.isArray(productsResponse.body?.data)
      ? productsResponse.body.data
      : Array.isArray(productsResponse.body?.items)
        ? productsResponse.body.items
        : [];
  const product = products.find((item) => String(item.slug || "").toLowerCase() === "jordan-4") || products.find((item) => Array.isArray(item.variants) && item.variants.length > 0);
  if (!product) throw new Error("No storefront product available for cart seeding");
  const variant = (Array.isArray(product.variants) ? product.variants : []).find((item) => Number(item.stock || 0) > 0 && item.id) || product.variants?.[0];
  if (!variant?.id) throw new Error(`No available variant found for product ${product.id}`);

  const cartItem = {
    lineId: `${product.id}:${variant.id}`,
    product_id: product.id,
    variant_id: variant.id,
    name: String(product.name || product.title || "").slice(0, 120),
    image_url: variant.image_url || product.image_url || product.image || "",
    size: String(variant.size || "").slice(0, 40),
    color: String(variant.color || "").slice(0, 60),
    price: Number(variant.sale_price || variant.price || product.sale_price || product.price || product.selling_price || 0),
    selling_price: Number(variant.selling_price || variant.sale_price || product.selling_price || product.sale_price || product.price || 0),
    regular_price: Number(variant.regular_price || variant.original_price || variant.base_price || variant.list_price || variant.compare_base_price || variant.compare_at_price || product.regular_price || product.original_price || product.base_price || 0),
    original_price: Number(variant.original_price || variant.base_price || variant.list_price || variant.compare_base_price || variant.compare_at_price || variant.regular_price || product.original_price || product.base_price || 0),
    base_price: Number(variant.base_price || variant.original_price || variant.compare_base_price || variant.regular_price || product.base_price || product.original_price || 0),
    list_price: Number(variant.list_price || variant.original_price || variant.compare_base_price || variant.regular_price || product.list_price || product.original_price || 0),
    compare_base_price: Number(variant.compare_base_price || variant.original_price || variant.base_price || variant.list_price || variant.regular_price || product.compare_base_price || product.original_price || 0),
    compare_at_price: Number(variant.compare_at_price || variant.original_price || variant.base_price || variant.list_price || variant.compare_base_price || variant.regular_price || product.compare_at_price || product.original_price || 0),
    sale_price: Number(variant.sale_price || product.sale_price || 0),
    sale_prices_enabled: Boolean(product.sale_prices_enabled || variant.sale_prices_enabled || product.global_sale_enabled || variant.global_sale_enabled || product.sale_mode_enabled || variant.sale_mode_enabled),
    global_sale_enabled: Boolean(product.global_sale_enabled || variant.global_sale_enabled || product.sale_prices_enabled || variant.sale_prices_enabled || product.sale_mode_enabled || variant.sale_mode_enabled),
    sale_mode_enabled: Boolean(product.sale_mode_enabled || variant.sale_mode_enabled || product.sale_prices_enabled || variant.sale_prices_enabled || product.global_sale_enabled || variant.global_sale_enabled),
    stock: Number(variant.stock || 1),
    quantity: 1,
  };

  await evalPage(cdp, (item) => {
    localStorage.setItem("storefront.cart", JSON.stringify([item]));
    sessionStorage.removeItem("storefront.cart");
    return localStorage.getItem("storefront.cart");
  }, cartItem);
  const cartSnapshot = await evalPage(cdp, () => localStorage.getItem("storefront.cart") || "");
  log(`cart seed snapshot: ${cartSnapshot}`);

  await navigate(cdp, `${frontendBaseUrl}/shop/cart`);
  await waitForPageCondition(cdp, () => document.querySelectorAll(".sf-order-item-row").length > 0, [], 30_000);
};

const reachCheckoutPayment = async (cdp, customerPhone = "") => {
  await navigate(cdp, `${frontendBaseUrl}/shop/checkout`);
  await waitForPageCondition(cdp, () => String(window.location.pathname || "") === "/shop/checkout", [], 30_000);
  await waitForPageCondition(cdp, () => Boolean(document.querySelector("form#storefront-checkout-form")), [], 30_000);

  await fillByIndex(cdp, "form#storefront-checkout-form", ["Smoke Test Customer", customerPhone || "01012345678"]);
  await evalPage(cdp, () => document.querySelector("form#storefront-checkout-form")?.requestSubmit());
  await waitForPageCondition(cdp, () => {
    const bodyText = String(document.body?.innerText || "");
    return bodyText.includes("Address") || bodyText.includes("عنوان التوصيل");
  }, [], 30_000);

  if (customerPhone) {
    await sleep(4000);
    await evalPage(cdp, () => document.querySelector("form#storefront-checkout-form")?.requestSubmit());
    const advanced = await waitForPageCondition(
      cdp,
      () => {
        const bodyText = String(document.body?.innerText || "");
        return bodyText.includes("Payment") || bodyText.includes("طريقة الدفع") || bodyText.includes("Payment method");
      },
      [],
      15_000
    ).then(() => true).catch(() => false);
    if (!advanced) {
      await setCheckoutAddress(cdp, "form#storefront-checkout-form", "Cairo, Nasr City, Test Street 1");
      await evalPage(cdp, () => document.querySelector("form#storefront-checkout-form")?.requestSubmit());
      await waitForPageCondition(cdp, () => {
        const bodyText = String(document.body?.innerText || "");
        return bodyText.includes("Payment") || bodyText.includes("طريقة الدفع") || bodyText.includes("Payment method");
      }, [], 30_000);
    }
    return;
  }

  await setCheckoutAddress(cdp, "form#storefront-checkout-form", "Cairo, Nasr City, Test Street 1");
  await evalPage(cdp, () => document.querySelector("form#storefront-checkout-form")?.requestSubmit());
  await waitForPageCondition(cdp, () => {
    const bodyText = String(document.body?.innerText || "");
    return bodyText.includes("Payment") || bodyText.includes("طريقة الدفع");
  }, [], 30_000);
};

const applyCoupon = async (cdp, code) => {
  await evalPage(
    cdp,
    (couponCode) => {
      const label = Array.from(document.querySelectorAll("label")).find((node) => {
        const text = String(node.textContent || "").toLowerCase();
        return text.includes("coupon") || text.includes("كوبون");
      });
      const input = label?.querySelector("input") || Array.from(document.querySelectorAll("input")).find((field) => String(field.placeholder || "").toLowerCase().includes("coupon"));
      if (!input) throw new Error("Coupon input not found");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, couponCode);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    code
  );
  await clickButtonByAnyText(cdp, ["Apply coupon", "تطبيق الكوبون"]);
};

const uploadProofAndSubmit = async (cdp) => {
  const dom = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: "input[type=\"file\"]" });
  if (!node.nodeId) throw new Error("Transfer proof input not found");
  await cdp.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [proofPath] });
  await clickButtonByAnyText(cdp, ["Submit order", "تم الدفع وإرفاق الإيصال"]);
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

const disableBostaLookups = async (cdp) =>
  evalPage(
    cdp,
    () => {
      if (window.__smokeBostaPatched) return true;
      window.__smokeBostaPatched = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : String(input?.url || "");
        if (url.includes("/shipping/cities?provider=bosta&dropoff=1")) {
          return new Response(JSON.stringify({ cities: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/shipping/zones?provider=bosta&dropoff=1")) {
          return new Response(JSON.stringify({ zones: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/shipping/districts?provider=bosta&dropoff=1")) {
          return new Response(JSON.stringify({ districts: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      };
      return true;
    }
  );

const getSmokeCheckoutPhone = async (dbClient) => {
  const result = await dbClient.query(
    `
    SELECT customer_phone
    FROM orders
    WHERE tenant_id = 1
      AND NULLIF(TRIM(COALESCE(customer_phone, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(shipping_city_id, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(shipping_zone_id, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(shipping_district_id, '')), '') IS NOT NULL
      AND (
        NULLIF(TRIM(COALESCE(governorate, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(city_area, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(customer_address, '')), '') IS NOT NULL
      )
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 1
    `
  );
  const phone = String(result.rows[0]?.customer_phone || "").trim();
  return /^01[0125][0-9]{8}$/.test(phone) ? phone : "";
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
      predicate: ({ text }) => String(text || "").includes('"status":"ok"') || String(text || "").includes('"status": "ok"'),
    });
    log("backend is healthy");

    await waitForHttp(`${frontendBaseUrl}/`, {
      timeoutMs: 180_000,
      predicate: ({ text }) => String(text || "").includes("<!doctype html>") || String(text || "").includes("root"),
    });
    log("frontend is reachable");

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
    log(`using super admin account: ${smokeAdmin.email}`);

    const login = await fetchJson(`${backendBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: smokeAdmin.email, password: smokePassword }),
    });
    if (!login.response.ok) throw new Error(login.body?.message || `Login failed (${login.response.status})`);

    const adminToken = String(login.body?.token || "");
    const adminUser = login.body?.user || {};
    if (!adminToken) throw new Error("Admin token missing");

    await createSmokeCoupon({ token: adminToken, dbClient });
    const checkoutPhone = await getSmokeCheckoutPhone(dbClient);
    log(`checkout phone: ${checkoutPhone || "fallback"}`);

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

    const wsUrl = await waitForPageWsUrl(9226, 120_000);
    const cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    await navigate(cdp, `${frontendBaseUrl}/`);
    await setStorageAndReload(cdp, {
      token: adminToken,
      user: JSON.stringify({ ...adminUser, permissions: Array.isArray(adminUser.permissions) ? adminUser.permissions : ["*"] }),
      app_language: "en",
    });

    await navigate(cdp, `${frontendBaseUrl}/`);
    await waitForPageCondition(cdp, () => Boolean(document.querySelector('a[href="/marketing/coupons"]')), [], 60_000);
    await clickLinkByHref(cdp, "/marketing/coupons");
    await waitForPageCondition(cdp, () => String(window.location.pathname || "").includes("/marketing/coupons"), [], 20_000);
    await waitForPageCondition(
      cdp,
      () => {
        const bodyText = String(document.body?.innerText || "");
        return bodyText.includes("Coupon campaigns") || bodyText.includes("إدارة حملات الكوبونات") || bodyText.includes("New campaign") || bodyText.includes("حملة كوبونات");
      },
      [],
      60_000
    );
    log("admin coupons page is visible from the sidebar");

    await waitForPageCondition(
      cdp,
      () => Array.from(document.querySelectorAll("button")).some((button) => {
        const normalized = String(button.textContent || "").replace(/\s+/g, " ").trim();
        return normalized.includes("New campaign") || normalized.includes("حملة جديدة") || normalized.includes("إنشاء حملة");
      }),
      [],
      60_000
    );
    const buttonLabels = await evalPage(cdp, () =>
      Array.from(document.querySelectorAll("button"))
        .map((button) => String(button.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 30)
    );
    log(`visible buttons: ${buttonLabels.join(" | ")}`);
    await clickButtonByAnyText(cdp, ["New campaign", "حملة جديدة", "إنشاء حملة"]);
    await waitForPageCondition(cdp, () => Boolean(document.querySelector('.fixed.inset-0.z-50')), [], 20_000);
    await fillByIndex(cdp, '.fixed.inset-0.z-50', [
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
    await waitForPageCondition(cdp, () => !document.querySelector('.fixed.inset-0.z-50'), [], 20_000);
    await waitForPageCondition(cdp, () => String(document.body?.innerText || "").includes("Smoke TEST10"), [], 30_000);
    log("coupon campaign created from admin UI");

    await setStorageAndReload(cdp, {
      token: adminToken,
      user: JSON.stringify({ ...adminUser, permissions: Array.isArray(adminUser.permissions) ? adminUser.permissions : ["*"] }),
      app_language: "ar",
    });

    await navigate(cdp, `${frontendBaseUrl}/shop/products`);
    await openFirstProduct(cdp);
    await addProductToCart(cdp, adminToken);
    await disableBostaLookups(cdp);
    await reachCheckoutPayment(cdp, checkoutPhone);

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







