/**
 * The Employee Portal's product catalogue, kept on the phone.
 *
 * WHY: every product search in the portal was a round trip. On a weak line that
 * is a spinner per keystroke, and in a stockroom it is nothing at all. The
 * catalogue is small as data (a few thousand lean rows), so the phone holds ALL
 * of it and answers a search itself, instantly. The network is then a refinement
 * that replaces the local answer when — and only if — it arrives in time.
 *
 * ONE cache for both screens that search products (المنتجات and الجرد), keyed
 * per tenant + employee + branch exactly like the working drafts. The raw portal
 * token is never stored: a cold start finds its cache through a one-way digest
 * of the token, which identifies the cache without being the credential.
 *
 * A LOOKUP INDEX, NEVER AUTHORITY. Stock on it is what the server believed when
 * the snapshot was taken. Every write still goes to the server, which recomputes
 * what it needs; a stale snapshot can make a product findable, never sellable.
 */

import { loadInventoryCatalog, saveInventoryCatalog } from "./employeeDraftStore.js";
import { toCatalogRow } from "./inventoryCountSync.js";

const str = (value) => String(value ?? "").trim();
const lower = (value) => str(value).toLowerCase();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** How long a snapshot is trusted without even asking the server if it changed. */
export const CATALOG_RECHECK_MS = 15 * 60 * 1000;
/** Past this the snapshot is refreshed regardless of the version answer. */
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How long a search waits for the server before the local answer stands. Short
 * on purpose: the employee already has results on screen, so this only bounds
 * how long a "refining…" hint shows on a line that is not going to deliver.
 */
export const SEARCH_NETWORK_TIMEOUT_MS = 6000;

// ---- Row shape ----------------------------------------------------------------

/** A snapshot row as both screens need it: the lookup fields plus the product's. */
export const toPortalCatalogRow = (record = {}) => ({
  ...toCatalogRow(record),
  qr_token: str(record.qr_token),
  product_code: str(record.product_code),
  style: str(record.style),
  product_category: str(record.product_category),
  grade: str(record.grade),
  product_image_url: str(record.product_image_url),
  product_updated_at: toNumber(record.product_updated_at, 0),
});

// ---- Identity hint (token never stored) ---------------------------------------

const HINT_PREFIX = "ep-catalog-ident:";

const digestToken = async (token) => {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : null;
  if (!subtle || typeof TextEncoder === "undefined") return "";
  try {
    const bytes = await subtle.digest("SHA-256", new TextEncoder().encode(`ep-catalog:${str(token)}`));
    return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
};

const readHint = async (token) => {
  if (typeof localStorage === "undefined") return null;
  const digest = await digestToken(token);
  if (!digest) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(HINT_PREFIX + digest) || "null");
    return parsed && parsed.tenantId && parsed.employeeId && parsed.branchId ? parsed : null;
  } catch {
    return null;
  }
};

const writeHint = async (token, identity) => {
  if (typeof localStorage === "undefined" || !identity) return;
  const digest = await digestToken(token);
  if (!digest) return;
  try {
    localStorage.setItem(HINT_PREFIX + digest, JSON.stringify({
      tenantId: str(identity.tenantId),
      employeeId: str(identity.employeeId),
      branchId: str(identity.branchId),
    }));
  } catch {
    /* storage full or blocked: the cache still works once identity is known */
  }
};

export const toCacheIdentity = (identity = {}) => {
  const tenantId = str(identity.tenant_id ?? identity.tenantId);
  const employeeId = str(identity.employee_id ?? identity.employeeId ?? identity.id);
  const branchId = str(identity.branch_id ?? identity.branchId);
  return tenantId && employeeId && branchId ? { tenantId, employeeId, branchId } : null;
};

// ---- Load / refresh -------------------------------------------------------------

const hasRows = (snapshot) => Boolean(snapshot && Array.isArray(snapshot.variants) && snapshot.variants.length);

/**
 * The cached catalogue, with no network at all. This is what makes a search
 * instant on a cold open over a dead line: identity comes from the token digest.
 */
export const readPortalCatalog = async ({ token, identity = null } = {}) => {
  const cacheIdentity = toCacheIdentity(identity || {}) || (await readHint(token));
  if (!cacheIdentity) return null;
  const snapshot = await loadInventoryCatalog(cacheIdentity);
  return hasRows(snapshot) ? snapshot : null;
};

// One download at a time per token, however many screens ask: the hub, المنتجات
// and الجرد can all mount within the same second on a slow phone.
const inflight = new Map();

/**
 * Bring the cached catalogue up to date — politely. Asks the server for a few
 * bytes ("has the catalogue changed?") and downloads the snapshot only when the
 * answer differs, the cache is empty, or it has aged out. Resolves to the best
 * snapshot available and never throws: a failed refresh just keeps the old one.
 *
 * `api` is injected ({ getVersion, getSnapshot }) so this module stays free of
 * the HTTP client and testable without a browser.
 */
export const refreshPortalCatalog = ({ token, identity = null, api, force = false, now = Date.now() } = {}) => {
  const flightKey = str(token);
  if (inflight.has(flightKey)) return inflight.get(flightKey);

  const job = (async () => {
    const cached = await readPortalCatalog({ token, identity });
    const age = cached ? now - toNumber(cached.savedAt, 0) : Infinity;
    if (!force && cached && age < CATALOG_RECHECK_MS) return { snapshot: cached, refreshed: false };

    let serverVersion = "";
    let serverIdentity = toCacheIdentity(identity || {});
    try {
      const versionResponse = await api.getVersion(token);
      serverVersion = str(versionResponse?.version);
      serverIdentity = toCacheIdentity(versionResponse?.identity || {}) || serverIdentity;
    } catch {
      // No version answer (weak line, old server): fall through and let age decide.
    }

    const unchanged = Boolean(serverVersion && cached && str(cached.version) === serverVersion);
    if (!force && unchanged && age < CATALOG_MAX_AGE_MS) {
      // Same catalogue: re-stamp it so the next open skips even the version ask.
      if (serverIdentity) {
        saveInventoryCatalog(serverIdentity, { ...cached, savedAt: now });
        void writeHint(token, serverIdentity);
      }
      return { snapshot: { ...cached, savedAt: now }, refreshed: false };
    }

    try {
      const response = await api.getSnapshot(token);
      const rows = (Array.isArray(response?.variants) ? response.variants : []).map(toPortalCatalogRow);
      if (!rows.length) return { snapshot: cached, refreshed: false };
      const snapshotIdentity = toCacheIdentity(response?.identity || {}) || serverIdentity;
      const snapshot = {
        variants: rows,
        version: str(response?.version) || serverVersion,
        generatedAt: response?.generated_at || null,
        savedAt: now,
      };
      if (snapshotIdentity) {
        saveInventoryCatalog(snapshotIdentity, snapshot);
        void writeHint(token, snapshotIdentity);
      }
      return { snapshot, refreshed: true };
    } catch {
      return { snapshot: cached, refreshed: false };
    }
  })().finally(() => inflight.delete(flightKey));

  inflight.set(flightKey, job);
  return job;
};

// ---- Search (mirrors the server's compact products query) ---------------------

const PRODUCT_TEXT_FIELDS = ["product_name", "product_sku", "product_barcode", "qr_token", "product_code", "product_category", "brand", "gender", "type", "style"];
const VARIANT_TEXT_FIELDS = ["color", "size", "sku", "barcode", "article_code"];

const isAll = (value) => {
  const normalized = lower(value);
  return !normalized || normalized === "all" || normalized === "الكل";
};

const sizeSort = (a, b) => {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), "ar");
};

// Rows grouped into products, built once per snapshot object and reused for
// every keystroke after it.
const productIndexCache = new WeakMap();

const buildProductIndex = (snapshot) => {
  const products = new Map();
  for (const row of snapshot.variants) {
    const key = String(row.product_id ?? "");
    if (!key) continue;
    let product = products.get(key);
    if (!product) {
      product = {
        id: row.product_id,
        product_id: row.product_id,
        name: row.product_name,
        brand: row.brand,
        product_type: row.type,
        type: row.type,
        style: row.style,
        gender: row.gender,
        grade: row.grade || row.category,
        category: row.product_category,
        manufacturer_name: row.manufacturer_name,
        sku: row.product_sku,
        barcode: row.product_barcode,
        qr_token: row.qr_token,
        product_image_url: row.product_image_url,
        updated_at: row.product_updated_at,
        rows: [],
        productText: "",
      };
      product.productText = PRODUCT_TEXT_FIELDS.map((field) => lower(row[field])).join("");
      products.set(key, product);
    }
    product.rows.push(row);
  }
  // Same order the server gives: most recently touched product first.
  return [...products.values()].sort((a, b) => (b.updated_at - a.updated_at) || (toNumber(b.id) - toNumber(a.id)));
};

const productIndexOf = (snapshot) => {
  if (!hasRows(snapshot)) return [];
  let index = productIndexCache.get(snapshot);
  if (!index) {
    index = buildProductIndex(snapshot);
    productIndexCache.set(snapshot, index);
  }
  return index;
};

const toCompactProduct = (product, inStockOnly) => {
  const variants = product.rows
    .filter((row) => !inStockOnly || row.stock > 0)
    .map((row) => ({
      id: row.product_variant_id,
      variant_id: row.product_variant_id,
      product_id: row.product_id,
      color: row.color,
      size: row.size,
      sku: row.sku,
      barcode: row.barcode,
      article_code: row.article_code,
      stock: Math.max(0, row.stock),
      image_url: row.image_url,
      variant_image_url: row.image_url,
    }));
  const image = product.product_image_url || variants.find((variant) => variant.image_url)?.image_url || "";
  const totalStock = variants.reduce((sum, variant) => sum + variant.stock, 0);
  return {
    id: product.id,
    product_id: product.product_id,
    name: product.name,
    brand: product.brand,
    product_type: product.product_type,
    type: product.type,
    style: product.style,
    gender: product.gender,
    grade: product.grade,
    category: product.category,
    manufacturer_name: product.manufacturer_name,
    sku: product.sku,
    barcode: product.barcode,
    qr_token: product.qr_token,
    image_url: image,
    product_image_url: image,
    total_stock: totalStock,
    stock: totalStock,
    colors: [...new Set(variants.map((variant) => variant.color).filter(Boolean))],
    sizes: [...new Set(variants.map((variant) => variant.size).filter(Boolean))].sort(sizeSort),
    variants,
  };
};

/**
 * The products page's list query, answered from the phone. Same fields searched,
 * same filters, same in-stock rule and same ordering as the server's compact
 * endpoint — so when the server's answer does arrive it refines the list rather
 * than reshuffling it under the employee's thumb.
 */
export const searchPortalProducts = (snapshot, { q = "", filters = {}, size = "all", page = 1, limit = 48, inStockOnly = true } = {}) => {
  const index = productIndexOf(snapshot);
  if (!index.length) return { products: [], has_more: false, total: 0 };

  const query = lower(q);
  const wantBrand = isAll(filters.brand) ? "" : lower(filters.brand);
  const wantManufacturer = isAll(filters.manufacturer) ? "" : lower(filters.manufacturer);
  const wantGender = isAll(filters.gender) ? "" : lower(filters.gender);
  const wantType = isAll(filters.type) ? "" : lower(filters.type);
  const wantCategory = isAll(filters.category) ? "" : lower(filters.category);
  const wantColor = isAll(filters.color) ? "" : lower(filters.color);
  const wantSize = isAll(size) ? "" : lower(size);

  const matches = [];
  for (const product of index) {
    if (wantBrand && lower(product.brand) !== wantBrand) continue;
    if (wantManufacturer && lower(product.manufacturer_name) !== wantManufacturer) continue;
    if (wantGender && lower(product.gender) !== wantGender) continue;
    if (wantType && lower(product.product_type) !== wantType && lower(product.style) !== wantType) continue;
    // The portal's grade chip travels as `category`; accept either column so the
    // local answer is never narrower than the server's.
    if (wantCategory && lower(product.category) !== wantCategory && lower(product.grade) !== wantCategory) continue;

    const liveRows = product.rows;
    if (inStockOnly && !liveRows.some((row) => row.stock > 0)) continue;
    if (wantColor && !liveRows.some((row) => lower(row.color) === wantColor)) continue;
    if (wantSize && !liveRows.some((row) => row.stock > 0 && lower(row.size) === wantSize)) continue;

    if (query) {
      const inProduct = product.productText.includes(query);
      const inVariant = !inProduct && liveRows.some((row) => VARIANT_TEXT_FIELDS.some((field) => lower(row[field]).includes(query)));
      if (!inProduct && !inVariant) continue;
    }
    matches.push(product);
  }

  const safeLimit = Math.max(1, toNumber(limit, 48));
  const start = (Math.max(1, toNumber(page, 1)) - 1) * safeLimit;
  const slice = matches.slice(start, start + safeLimit).map((product) => toCompactProduct(product, inStockOnly));
  return { products: slice, has_more: start + safeLimit < matches.length, total: matches.length };
};

// ---- Images -------------------------------------------------------------------

/** Every distinct picture in the catalogue, colour pictures first. */
export const extractCatalogImageUrls = (snapshot, resolveUrl = (url) => url) => {
  if (!hasRows(snapshot)) return [];
  const urls = new Set();
  for (const row of snapshot.variants) {
    for (const raw of [row.image_url, row.product_image_url]) {
      const resolved = str(resolveUrl(raw));
      if (resolved) urls.add(resolved);
    }
  }
  return [...urls];
};

/**
 * Whether this is a moment to pull thousands of pictures. Warming is a courtesy
 * for later; on the very line this feature exists for (2G, data-saver) it would
 * compete with the employee's own requests, so it waits for a better one.
 */
export const connectionAllowsImageWarm = (connection = typeof navigator !== "undefined" ? navigator.connection : null) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !["slow-2g", "2g"].includes(String(connection.effectiveType || ""));
};

/**
 * Hand the catalogue's pictures to the portal service worker, which stores them
 * in the same cache its fetch handler serves from. Resolves to the worker's
 * counts, or null when no worker controls the page yet (first ever open).
 */
export const warmPortalCatalogImages = (urls = []) =>
  new Promise((resolve) => {
    const controller = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
    if (!controller || typeof MessageChannel !== "function" || !urls.length) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 10 * 60 * 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.counts || null);
    };
    controller.postMessage({ type: "employee-portal:warm-images", urls }, [channel.port2]);
  });
