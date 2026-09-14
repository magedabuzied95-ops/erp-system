import { resolveProductImageUrl as resolvePosImageUrl } from "../../../shared/lib/imageUrls.js";

// v3 adds color_group_key to cached variants; older snapshots are dropped so the
// offline picker never groups colours differently from the online one.
// v4: the snapshot stores products ALREADY PRICED by getPosEffectivePrice, and the
// catalog-version watermark only tracks DATA (counts, updated_at, stock, sale mode) — so a
// change to the pricing RULE leaves the watermark identical and a warm terminal would keep
// selling at the old price. Curated Offers now set their own price, so bump this whenever
// pricing logic changes: it is the only thing that re-normalizes an existing snapshot.
// v7: cached variants keep their factories (manufacturer_id + manufacturer_ids).
export const POS_CATALOG_SCHEMA_VERSION = 7;
const POS_CATALOG_DB_NAME = "erp-pos-catalog-cache";
const POS_CATALOG_DB_STORE = "kv";
const POS_CATALOG_DB_KEY = "snapshot";
// Must stay identical to IMAGE_CACHE in public/pos-sw.js. The previous name was
// versioned on the catalog schema and was read by nothing at all: the worker's
// fetch handler returned early for cross-origin requests, so every warmed
// thumbnail sat in a cache no request ever consulted and the offline grid was
// blank. One name, written by the worker and read by the worker.
const POS_PRODUCT_IMAGE_CACHE_NAME = "pos-product-images-v1";
// Retired. Deleted on the first warm so the dead entries stop occupying quota
// that the live cache needs.
const LEGACY_THUMBNAIL_CACHE_NAMES = Array.from(
  { length: POS_CATALOG_SCHEMA_VERSION },
  (_unused, index) => `erp-pos-catalog-thumbnails-v${index + 1}`
);
// A full catalogue, not a sample. The old cap was 120 images, which on a
// 3,000-product catalogue meant roughly one product in twenty-five rendered
// offline. Ordering still puts favourites first, so the cap that remains is a
// storage guard rather than a selection.
const POS_IMAGE_WARM_LIMIT = 4000;

const POS_OFFLINE_DEBUG =
  String(import.meta?.env?.VITE_POS_OFFLINE_DEBUG || "").trim().toLowerCase() === "true";

const isBrowser = () =>
  typeof window !== "undefined" &&
  typeof indexedDB !== "undefined";

const debugLog = (...args) => {
  if (POS_OFFLINE_DEBUG) {
    console.debug(...args);
  }
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizeNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBoolean = (value) =>
  value === true || value === 1 || String(value ?? "").trim().toLowerCase() === "true";

const uniqueStrings = (values = []) => {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const text = normalizeText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
};

const pickImageUrl = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const resolved = resolvePosImageUrl(text);
    if (resolved) return resolved;
  }
  return "";
};

const sanitizePosCatalogVariant = (variant = {}) => {
  const stock = Math.max(0, normalizeNumber(variant.stock_quantity ?? variant.stock));
  const imageUrl = pickImageUrl(
    variant.thumbnail_url,
    variant.image_url,
    variant.variant_image_url,
    variant.product_image_url
  );

  return {
    id: variant.id ?? variant.variant_id ?? null,
    variant_id: variant.variant_id ?? variant.id ?? null,
    product_id: variant.product_id ?? null,
    name: normalizeText(variant.name || variant.product_name || ""),
    product_name: normalizeText(variant.product_name || variant.name || ""),
    color: normalizeText(variant.color || ""),
    // Kept so the offline snapshot groups colours exactly like the online catalog.
    color_group_key: normalizeText(variant.color_group_key || variant.colorGroupKey || ""),
    colorGroupKey: normalizeText(variant.colorGroupKey || variant.color_group_key || ""),
    size: normalizeText(variant.size || ""),
    sku: normalizeText(variant.sku || ""),
    barcode: normalizeText(variant.barcode || ""),
    article_code: normalizeText(variant.article_code || variant.articleCode || ""),
    articleCode: normalizeText(variant.articleCode || variant.article_code || ""),
    color_article_code: normalizeText(variant.color_article_code || variant.colorArticleCode || ""),
    colorArticleCode: normalizeText(variant.colorArticleCode || variant.color_article_code || ""),
    image_url: imageUrl,
    variant_image_url: imageUrl,
    product_image_url: imageUrl,
    thumbnail_url: imageUrl,
    price: normalizeNumber(variant.price ?? variant.final_price ?? variant.sale_price ?? 0),
    regular_price: normalizeNumber(variant.regular_price ?? variant.original_price ?? variant.price ?? 0),
    original_price: normalizeNumber(variant.original_price ?? variant.regular_price ?? variant.price ?? 0),
    sale_price: normalizeNumber(variant.sale_price ?? variant.price ?? variant.final_price ?? 0),
    // Pricing inputs + resolved sale display, so a warm-open snapshot can be
    // re-priced in memory when the sale-mode toggle flips (and renders the same
    // SALE badges a fresh download would). Without these, toggling on a warm
    // session silently did nothing until a full catalog re-download.
    stored_sale_price: normalizeNumber(variant.stored_sale_price ?? 0),
    current_selling_price: variant.current_selling_price ?? null,
    purchase_selling_price: variant.purchase_selling_price ?? null,
    sale_price_enabled: Boolean(variant.sale_price_enabled),
    sale_start_at: variant.sale_start_at ?? null,
    sale_end_at: variant.sale_end_at ?? null,
    sale_reason: normalizeText(variant.sale_reason || ""),
    sale_source: normalizeText(variant.sale_source || ""),
    sale_badge: normalizeText(variant.sale_badge || ""),
    sale_mode_applied: Boolean(variant.sale_mode_applied),
    is_offer_story: Boolean(variant.is_offer_story ?? variant.isOfferStory),
    isOfferStory: Boolean(variant.isOfferStory ?? variant.is_offer_story),
    category_id: variant.category_id ?? null,
    parent_category_id: variant.parent_category_id ?? null,
    brand_id: variant.brand_id ?? null,
    // The factory filter matches the colour's factories; without these a warm open
    // only knew the product-level factory, which most products leave empty.
    manufacturer_id: variant.manufacturer_id ?? variant.variant_manufacturer_id ?? null,
    manufacturer_name: normalizeText(variant.manufacturer_name || variant.variant_manufacturer_name || ""),
    manufacturer_ids: Array.isArray(variant.manufacturer_ids) ? variant.manufacturer_ids : [],
    stock,
    stock_quantity: stock,
    available: stock > 0,
  };
};

const sanitizePosCatalogProduct = (product = {}) => {
  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => sanitizePosCatalogVariant(variant))
    : [];
  const totalStock = variants.reduce((sum, variant) => sum + normalizeNumber(variant.stock_quantity ?? variant.stock), 0);
  const imageUrl = pickImageUrl(
    product.thumbnail_url,
    product.product_image_url,
    product.image_url,
    variants[0]?.thumbnail_url,
    variants[0]?.image_url
  );

  return {
    id: product.id ?? product.product_id ?? null,
    product_id: product.product_id ?? product.id ?? null,
    name: normalizeText(product.name || product.product_name || ""),
    product_name: normalizeText(product.product_name || product.name || ""),
    price: normalizeNumber(product.price ?? product.final_price ?? product.sale_price ?? product.min_price ?? 0),
    final_price: normalizeNumber(product.final_price ?? product.price ?? product.sale_price ?? product.min_price ?? 0),
    sale_price: normalizeNumber(product.sale_price ?? product.price ?? product.final_price ?? product.min_price ?? 0),
    regular_price: normalizeNumber(product.regular_price ?? product.original_price ?? product.price ?? 0),
    original_price: normalizeNumber(product.original_price ?? product.regular_price ?? product.price ?? 0),
    base_price: normalizeNumber(product.base_price ?? product.price ?? 0),
    min_price: normalizeNumber(product.min_price ?? product.price ?? 0),
    max_price: normalizeNumber(product.max_price ?? product.price ?? 0),
    min_regular_price: normalizeNumber(product.min_regular_price ?? product.regular_price ?? product.original_price ?? product.price ?? 0),
    max_regular_price: normalizeNumber(product.max_regular_price ?? product.regular_price ?? product.original_price ?? product.price ?? 0),
    stock: totalStock,
    total_stock: totalStock,
    stock_quantity: totalStock,
    available: totalStock > 0,
    image_url: imageUrl,
    product_image_url: imageUrl,
    thumbnail_url: imageUrl,
    sku: normalizeText(product.sku || ""),
    barcode: normalizeText(product.barcode || ""),
    article_code: normalizeText(product.article_code || product.articleCode || ""),
    articleCode: normalizeText(product.articleCode || product.article_code || ""),
    color_article_code: normalizeText(product.color_article_code || product.colorArticleCode || ""),
    colorArticleCode: normalizeText(product.colorArticleCode || product.color_article_code || ""),
    sale_badge: normalizeText(product.sale_badge || ""),
    sale_source: normalizeText(product.sale_source || ""),
    sale_mode_applied: Boolean(product.sale_mode_applied),
    stored_sale_price: normalizeNumber(product.stored_sale_price ?? 0),
    sale_price_enabled: Boolean(product.sale_price_enabled),
    sale_start_at: product.sale_start_at ?? null,
    sale_end_at: product.sale_end_at ?? null,
    sale_reason: normalizeText(product.sale_reason || ""),
    is_offer_story: Boolean(product.is_offer_story ?? product.isOfferStory),
    isOfferStory: Boolean(product.isOfferStory ?? product.is_offer_story),
    parent_category_id: product.parent_category_id ?? product.parentCategoryId ?? null,
    is_pos_favorite: normalizeBoolean(product.is_pos_favorite ?? product.isPosFavorite),
    isPosFavorite: normalizeBoolean(product.isPosFavorite ?? product.is_pos_favorite),
    brand_id: product.brand_id ?? product.brandId ?? null,
    brand_name: normalizeText(product.brand_name || product.brandName || product.brand || ""),
    brand: normalizeText(product.brand || product.brand_name || product.brandName || ""),
    category_id: product.category_id ?? product.categoryId ?? null,
    category: normalizeText(product.category || product.category_name || ""),
    category_name: normalizeText(product.category_name || product.category || ""),
    main_category_id: product.main_category_id ?? product.mainCategoryId ?? null,
    main_category_name: normalizeText(product.main_category_name || product.mainCategoryName || ""),
    sub_category_id: product.sub_category_id ?? product.subCategoryId ?? null,
    sub_category_name: normalizeText(product.sub_category_name || product.subCategoryName || ""),
    child_category_id: product.child_category_id ?? product.childCategoryId ?? null,
    child_category_name: normalizeText(product.child_category_name || product.childCategoryName || ""),
    subcategory_name: normalizeText(product.subcategory_name || product.subcategoryName || ""),
    subcategory: normalizeText(product.subcategory || ""),
    manufacturer_id: product.manufacturer_id ?? product.manufacturerId ?? product.variant_manufacturer_id ?? null,
    manufacturer_name: normalizeText(product.manufacturer_name || product.manufacturerName || product.manufacturer || ""),
    manufacturer: normalizeText(product.manufacturer || product.manufacturer_name || product.manufacturerName || ""),
    gender: normalizeText(product.gender || ""),
    product_type: normalizeText(product.product_type || product.productType || ""),
    productType: normalizeText(product.productType || product.product_type || ""),
    grade: normalizeText(product.grade || ""),
    audiences: Array.isArray(product.audiences) ? product.audiences : [],
    product_audiences: Array.isArray(product.product_audiences) ? product.product_audiences : [],
    variants,
  };
};

const sanitizePosCatalogProducts = (products = []) =>
  (Array.isArray(products) ? products : []).map((product) => sanitizePosCatalogProduct(product));

const extractSnapshotProducts = (input) => {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.products)) return input.products;
  return [];
};

const readSnapshotMeta = (snapshot) => {
  if (!snapshot || snapshot.schema_version !== POS_CATALOG_SCHEMA_VERSION) return null;
  const products = extractSnapshotProducts(snapshot);
  return {
    schema_version: snapshot.schema_version,
    cached_at: snapshot.cached_at || "",
    product_count: products.length,
    variant_count: products.reduce((count, product) => count + (Array.isArray(product?.variants) ? product.variants.length : 0), 0),
    image_url_count: extractPosCatalogSnapshotImageUrls(snapshot).length,
  };
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(POS_CATALOG_DB_NAME, POS_CATALOG_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POS_CATALOG_DB_STORE)) {
        db.createObjectStore(POS_CATALOG_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open POS catalog cache"));
  });

const readStoreValue = async (key) => {
  if (!isBrowser()) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_CATALOG_DB_STORE, "readonly");
      const store = tx.objectStore(POS_CATALOG_DB_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("Failed to read POS catalog cache"));
    });
  } finally {
    db.close();
  }
};

const writeStoreValue = async (key, value) => {
  if (!isBrowser()) return null;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_CATALOG_DB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to write POS catalog cache"));
      tx.objectStore(POS_CATALOG_DB_STORE).put(value, key);
    });
    return value;
  } finally {
    db.close();
  }
};

const deleteStoreValue = async (key) => {
  if (!isBrowser()) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(POS_CATALOG_DB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to clear POS catalog cache"));
      tx.objectStore(POS_CATALOG_DB_STORE).delete(key);
    });
  } finally {
    db.close();
  }
};

export const buildPosCatalogSnapshot = (products = [], catalogVersion = "") => {
  const sanitizedProducts = sanitizePosCatalogProducts(products);
  const cachedAt = new Date().toISOString();
  return {
    schema_version: POS_CATALOG_SCHEMA_VERSION,
    cached_at: cachedAt,
    catalog_version: normalizeText(catalogVersion),
    products: sanitizedProducts,
    meta: {
      schema_version: POS_CATALOG_SCHEMA_VERSION,
      cached_at: cachedAt,
      catalog_version: normalizeText(catalogVersion),
      product_count: sanitizedProducts.length,
      variant_count: sanitizedProducts.reduce((count, product) => count + (Array.isArray(product?.variants) ? product.variants.length : 0), 0),
      image_url_count: extractPosCatalogSnapshotImageUrls(sanitizedProducts).length,
    },
  };
};

export const extractPosCatalogSnapshotImageUrls = (snapshotOrProducts = []) => {
  const products = extractSnapshotProducts(snapshotOrProducts);
  const urls = [];

  const prioritizedProducts = [...products].sort((left, right) =>
    Number(normalizeBoolean(right?.is_pos_favorite ?? right?.isPosFavorite)) -
    Number(normalizeBoolean(left?.is_pos_favorite ?? left?.isPosFavorite))
  );

  prioritizedProducts.forEach((product) => {
    urls.push(product?.thumbnail_url, product?.image_url, product?.product_image_url);
    (Array.isArray(product?.variants) ? product.variants : []).forEach((variant) => {
      urls.push(variant?.thumbnail_url, variant?.image_url, variant?.variant_image_url, variant?.product_image_url);
    });
  });

  return uniqueStrings(urls.map((value) => pickImageUrl(value))).slice(0, POS_IMAGE_WARM_LIMIT);
};

export const savePosCatalogSnapshot = async (products = [], catalogVersion = "") => {
  const snapshot = buildPosCatalogSnapshot(products, catalogVersion);
  try {
    await writeStoreValue(POS_CATALOG_DB_KEY, snapshot);
    debugLog("POS_OFFLINE_CATALOG_SNAPSHOT_SAVED", snapshot.meta);
  } catch (error) {
    debugLog("POS_OFFLINE_CATALOG_SNAPSHOT_SAVE_FAILED", error?.message || error);
  }
  return snapshot;
};

export const getPosCatalogSnapshot = async () => {
  try {
    const snapshot = await readStoreValue(POS_CATALOG_DB_KEY);
    if (!snapshot || snapshot.schema_version !== POS_CATALOG_SCHEMA_VERSION) return null;
    const products = sanitizePosCatalogProducts(extractSnapshotProducts(snapshot));
    return {
      schema_version: snapshot.schema_version,
      cached_at: snapshot.cached_at || "",
      catalog_version: normalizeText(snapshot.catalog_version),
      products,
      meta: readSnapshotMeta({ ...snapshot, products }),
    };
  } catch (error) {
    debugLog("POS_OFFLINE_CATALOG_SNAPSHOT_READ_FAILED", error?.message || error);
    return null;
  }
};

const soldLineVariantId = (line = {}) => {
  const value = line.variant_id ?? line.variantId ?? null;
  if (value === null || value === undefined || value === "" || String(value).startsWith("product:")) return null;
  // A simple product's cart line can carry its product id as the "variant".
  const fullVariations = String(line.variation_mode || "").trim().toLowerCase() === "full_variations";
  if (!fullVariations && String(value) === String(line.product_id ?? line.productId ?? "")) return null;
  return String(value);
};

/**
 * Pure: the snapshot's products with `lines` taken out of stock. Matches a
 * variant by id, then by colour + size; a line with no variant lowers the
 * product itself. Totals are recomputed from the variants, never decremented
 * separately, so the two can not drift.
 */
export const applySoldLinesToCatalogProducts = (products = [], lines = []) => {
  const nextProducts = (Array.isArray(products) ? products : []).map((product) => ({
    ...product,
    variants: Array.isArray(product?.variants) ? product.variants.map((variant) => ({ ...variant })) : [],
  }));

  for (const line of Array.isArray(lines) ? lines : []) {
    const productId = line?.product_id ?? line?.productId ?? null;
    const quantity = Math.max(0, normalizeNumber(line?.quantity ?? line?.qty));
    if (productId === null || productId === undefined || quantity <= 0) continue;
    const product = nextProducts.find((entry) => String(entry.id ?? entry.product_id) === String(productId));
    if (!product) continue;

    const variantId = soldLineVariantId(line);
    const variant =
      (variantId !== null &&
        product.variants.find((entry) => String(entry.variant_id ?? entry.id) === variantId)) ||
      (line?.color || line?.size
        ? product.variants.find(
            (entry) =>
              normalizeText(entry.color).toLowerCase() === normalizeText(line.color).toLowerCase() &&
              normalizeText(entry.size).toLowerCase() === normalizeText(line.size).toLowerCase()
          )
        : null);

    if (variant) {
      const nextStock = Math.max(0, normalizeNumber(variant.stock_quantity ?? variant.stock) - quantity);
      variant.stock = nextStock;
      variant.stock_quantity = nextStock;
      variant.available = nextStock > 0;
    } else if (product.variants.length === 0) {
      const nextStock = Math.max(0, normalizeNumber(product.stock_quantity ?? product.stock) - quantity);
      product.stock = nextStock;
      product.total_stock = nextStock;
      product.stock_quantity = nextStock;
      product.available = nextStock > 0;
      continue;
    } else {
      continue;
    }

    const totalStock = product.variants.reduce(
      (sum, entry) => sum + normalizeNumber(entry.stock_quantity ?? entry.stock),
      0
    );
    product.stock = totalStock;
    product.total_stock = totalStock;
    product.stock_quantity = totalStock;
    product.available = totalStock > 0;
  }

  return nextProducts;
};

// Offline sales can land seconds apart; each read-modify-write waits for the
// previous one so the second sale never overwrites the first sale's decrement.
let offlineSaleWriteChain = Promise.resolve();

/**
 * An offline sale lowered stock only in memory, so a reload during the outage
 * brought the sold pairs back and the till could sell them twice. This writes
 * the same decrement into the cached snapshot. The catalog version is kept: the
 * next online refresh replaces the snapshot with the server's numbers anyway.
 */
export const applyOfflineSaleToCachedCatalog = (lines = []) => {
  const task = offlineSaleWriteChain.then(async () => {
    try {
      const snapshot = await readStoreValue(POS_CATALOG_DB_KEY);
      if (!snapshot || snapshot.schema_version !== POS_CATALOG_SCHEMA_VERSION) return false;
      const products = applySoldLinesToCatalogProducts(extractSnapshotProducts(snapshot), lines);
      await writeStoreValue(POS_CATALOG_DB_KEY, {
        ...snapshot,
        products,
        offline_sales_applied_at: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      debugLog("POS_OFFLINE_CATALOG_SALE_APPLY_FAILED", error?.message || error);
      return false;
    }
  });
  offlineSaleWriteChain = task.catch(() => false);
  return task;
};

export const getPosCatalogCacheMeta = async () => {
  const snapshot = await getPosCatalogSnapshot();
  return snapshot?.meta || null;
};

export const clearPosCatalogSnapshot = async () => {
  try {
    await deleteStoreValue(POS_CATALOG_DB_KEY);
  } catch (error) {
    debugLog("POS_OFFLINE_CATALOG_SNAPSHOT_CLEAR_FAILED", error?.message || error);
  }
  if (isBrowser() && window.caches?.delete) {
    try {
      await window.caches.delete(POS_PRODUCT_IMAGE_CACHE_NAME);
      await dropLegacyThumbnailCaches();
    } catch (error) {
      debugLog("POS_OFFLINE_CATALOG_THUMBNAIL_CACHE_CLEAR_FAILED", error?.message || error);
    }
  }
};

const dropLegacyThumbnailCaches = async () => {
  if (!isBrowser() || !window.caches?.delete) return;
  await Promise.all(
    LEGACY_THUMBNAIL_CACHE_NAMES.map((name) => window.caches.delete(name).catch(() => false))
  );
};

const warmImagesThroughServiceWorker = (urls) =>
  new Promise((resolve, reject) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller || typeof MessageChannel !== "function") {
      reject(new Error("no POS service worker is controlling this page"));
      return;
    }
    const channel = new MessageChannel();
    // A whole catalogue can take a while on a slow line; the fallback below is
    // for "no worker", not for "slow worker", so this is generous.
    const timer = setTimeout(() => reject(new Error("service worker warm timed out")), 10 * 60 * 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data?.type === "POS_WARM_IMAGES_DONE") resolve(event.data.counts || {});
      else reject(new Error(event.data?.message || "service worker warm failed"));
    };
    controller.postMessage({ type: "POS_WARM_IMAGES", urls }, [channel.port2]);
  });

// Used when no worker controls the page (a first load before activation, or a
// browser with service workers off). `cache.put` with a no-cors response is the
// only page-side way to store a cross-origin image: `cache.add` runs its own
// `response.ok` check, which an opaque response can never pass -- that check is
// why the previous preloader silently stored nothing.
const warmImagesFromPage = async (urls) => {
  const cache = await window.caches.open(POS_PRODUCT_IMAGE_CACHE_NAME);
  const counts = { requested: urls.length, stored: 0, hit: 0, failed: 0 };
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      try {
        if (await cache.match(url)) {
          counts.hit += 1;
          continue;
        }
        const response = await fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
        if (response && (response.type === "opaque" || response.ok)) {
          await cache.put(url, response);
          counts.stored += 1;
        } else {
          counts.failed += 1;
        }
      } catch {
        counts.failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return counts;
};

/**
 * Puts the catalogue's photos on the device. The till is a picture grid -- a
 * cashier picks a product by looking at it -- so an offline catalogue without
 * images is not a usable catalogue.
 */
export const preloadPosCatalogThumbnails = async (snapshotOrProducts = []) => {
  if (!isBrowser() || !window.caches?.open) return null;
  const urls = extractPosCatalogSnapshotImageUrls(snapshotOrProducts);
  if (!urls.length) return null;

  void dropLegacyThumbnailCaches();

  try {
    const counts = await warmImagesThroughServiceWorker(urls);
    debugLog("POS_OFFLINE_CATALOG_IMAGES_WARMED", { via: "service_worker", ...counts });
    return counts;
  } catch (workerError) {
    debugLog("POS_OFFLINE_CATALOG_IMAGES_WORKER_UNAVAILABLE", workerError?.message || workerError);
  }

  try {
    const counts = await warmImagesFromPage(urls);
    debugLog("POS_OFFLINE_CATALOG_IMAGES_WARMED", { via: "page", ...counts });
    return counts;
  } catch (error) {
    debugLog("POS_OFFLINE_CATALOG_IMAGES_WARM_FAILED", error?.message || error);
    return null;
  }
};

/** How much of the catalogue this device can actually draw with no connection. */
export const getPosImageCacheStatus = async () => {
  if (!isBrowser() || !window.caches?.open) return { cached: 0 };
  try {
    const cache = await window.caches.open(POS_PRODUCT_IMAGE_CACHE_NAME);
    const keys = await cache.keys();
    return { cached: keys.length };
  } catch {
    return { cached: 0 };
  }
};
