import { resolveProductImageUrl as resolvePosImageUrl } from "../../../shared/lib/imageUrls.js";

export const POS_CATALOG_SCHEMA_VERSION = 1;
const POS_CATALOG_DB_NAME = "erp-pos-catalog-cache";
const POS_CATALOG_DB_STORE = "kv";
const POS_CATALOG_DB_KEY = "snapshot";
const POS_CATALOG_THUMBNAIL_CACHE_NAME = `erp-pos-catalog-thumbnails-v${POS_CATALOG_SCHEMA_VERSION}`;

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
    size: normalizeText(variant.size || ""),
    sku: normalizeText(variant.sku || ""),
    barcode: normalizeText(variant.barcode || ""),
    article_code: normalizeText(variant.article_code || ""),
    color_article_code: normalizeText(variant.color_article_code || variant.colorArticleCode || ""),
    image_url: imageUrl,
    variant_image_url: imageUrl,
    product_image_url: imageUrl,
    thumbnail_url: imageUrl,
    price: normalizeNumber(variant.price ?? variant.final_price ?? variant.sale_price ?? 0),
    regular_price: normalizeNumber(variant.regular_price ?? variant.original_price ?? variant.price ?? 0),
    original_price: normalizeNumber(variant.original_price ?? variant.regular_price ?? variant.price ?? 0),
    sale_price: normalizeNumber(variant.sale_price ?? variant.price ?? variant.final_price ?? 0),
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
    sale_badge: normalizeText(product.sale_badge || ""),
    sale_source: normalizeText(product.sale_source || ""),
    sale_mode_applied: Boolean(product.sale_mode_applied),
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

export const buildPosCatalogSnapshot = (products = []) => {
  const sanitizedProducts = sanitizePosCatalogProducts(products);
  const cachedAt = new Date().toISOString();
  return {
    schema_version: POS_CATALOG_SCHEMA_VERSION,
    cached_at: cachedAt,
    products: sanitizedProducts,
    meta: {
      schema_version: POS_CATALOG_SCHEMA_VERSION,
      cached_at: cachedAt,
      product_count: sanitizedProducts.length,
      variant_count: sanitizedProducts.reduce((count, product) => count + (Array.isArray(product?.variants) ? product.variants.length : 0), 0),
      image_url_count: extractPosCatalogSnapshotImageUrls(sanitizedProducts).length,
    },
  };
};

export const extractPosCatalogSnapshotImageUrls = (snapshotOrProducts = []) => {
  const products = extractSnapshotProducts(snapshotOrProducts);
  const urls = [];

  products.forEach((product) => {
    urls.push(product?.thumbnail_url, product?.image_url, product?.product_image_url);
    (Array.isArray(product?.variants) ? product.variants : []).forEach((variant) => {
      urls.push(variant?.thumbnail_url, variant?.image_url, variant?.variant_image_url, variant?.product_image_url);
    });
  });

  return uniqueStrings(urls.map((value) => pickImageUrl(value)));
};

export const savePosCatalogSnapshot = async (products = []) => {
  const snapshot = buildPosCatalogSnapshot(products);
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
      products,
      meta: readSnapshotMeta({ ...snapshot, products }),
    };
  } catch (error) {
    debugLog("POS_OFFLINE_CATALOG_SNAPSHOT_READ_FAILED", error?.message || error);
    return null;
  }
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
      await window.caches.delete(POS_CATALOG_THUMBNAIL_CACHE_NAME);
    } catch (error) {
      debugLog("POS_OFFLINE_CATALOG_THUMBNAIL_CACHE_CLEAR_FAILED", error?.message || error);
    }
  }
};

export const preloadPosCatalogThumbnails = async (snapshotOrProducts = []) => {
  if (!isBrowser() || !window.caches?.open) return;
  const urls = extractPosCatalogSnapshotImageUrls(snapshotOrProducts);
  if (!urls.length) return;

  try {
    const cache = await window.caches.open(POS_CATALOG_THUMBNAIL_CACHE_NAME);
    for (const url of urls) {
      try {
        await cache.add(url);
      } catch {
        // Thumbnails are best-effort only.
      }
    }
    debugLog("POS_OFFLINE_CATALOG_THUMBNAILS_PRELOADED", { image_url_count: urls.length });
  } catch (error) {
    debugLog("POS_OFFLINE_CATALOG_THUMBNAILS_PRELOAD_FAILED", error?.message || error);
  }
};
