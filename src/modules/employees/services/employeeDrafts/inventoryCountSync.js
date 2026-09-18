/**
 * Offline-first plumbing for the Employee Portal stock count.
 *
 * TWO IDEAS, kept deliberately small and pure so they can be tested without a
 * browser, a network or React:
 *
 * 1. THE OUTBOX. A counted quantity is recorded the instant the employee taps,
 *    into local state and an IndexedDB draft. What still owes the server lives
 *    in an outbox keyed by variant id — the LATEST quantity per variant, never a
 *    log of taps, so a size counted forty times still costs one row on the wire.
 *    Nothing is lost when the connection dies mid-count: the outbox is part of
 *    the persisted draft and is flushed when the signal returns or when the
 *    employee sends the count for review.
 *
 * 2. THE OFFLINE CATALOGUE. A lean snapshot of every countable variant so scan
 *    and search still resolve with no signal. It is a LOOKUP INDEX ONLY. The
 *    server stays authoritative for the expected quantity, for permissions and
 *    for every write, so a stale snapshot can never produce a fake difference.
 */

const str = (value) => String(value ?? "").trim();
const lower = (value) => str(value).toLowerCase();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const variantKeyOf = (record = {}) =>
  String(record.product_variant_id ?? record.variant_id ?? record.id ?? "");

/**
 * Record one counted quantity. Returns a NEW outbox object (never mutates), so
 * React state updates stay predictable.
 *
 * `countedAt` is the moment the employee counted, not the moment we manage to
 * send it: an offline count that lands an hour later must still say when it
 * really happened.
 */
export const queueCountedQuantity = (outbox = {}, entry = {}) => {
  const variantId = str(entry.variantId ?? entry.product_variant_id ?? entry.variant_id);
  if (!variantId) return outbox;
  return {
    ...outbox,
    [variantId]: {
      variantId,
      countedQuantity: toNumber(entry.countedQuantity, 0),
      systemQuantity: toNumber(entry.systemQuantity, 0),
      // `false` means "this colour was only put on the sheet". The server then
      // creates the row without claiming anyone counted that size.
      counted: entry.counted !== false,
      countedAt: entry.countedAt || new Date().toISOString(),
    },
  };
};

/** The bulk request body: one row per variant still owed to the server. */
export const outboxToItems = (outbox = {}) =>
  Object.values(outbox || {})
    .filter((entry) => entry && str(entry.variantId))
    .map((entry) => ({
      productVariantId: Number(entry.variantId),
      countedQuantity: toNumber(entry.countedQuantity, 0),
      systemQuantity: toNumber(entry.systemQuantity, 0),
      counted: entry.counted !== false,
      countedAt: entry.counted === false ? null : entry.countedAt || null,
    }));

/**
 * Clear only what was actually accepted, and only if the employee has not
 * counted that variant again since the flush started. A tap during a slow
 * upload must survive: dropping it would silently lose a counted piece.
 */
export const settleOutbox = (outbox = {}, flushed = {}) => {
  const next = { ...(outbox || {}) };
  for (const [variantId, sent] of Object.entries(flushed || {})) {
    const current = next[variantId];
    if (!current) continue;
    if (current.countedAt !== sent.countedAt) continue; // re-counted mid-flush
    delete next[variantId];
  }
  return next;
};

export const outboxSize = (outbox = {}) => Object.keys(outbox || {}).length;

/**
 * A failure that means "no connection", as opposed to the server refusing the
 * write. The shared API client attaches `status` to every HTTP response and
 * leaves it undefined when the request never reached a server.
 */
export const isOfflineFailure = (error) => {
  if (!error) return false;
  if (error.status) return false;
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return true;
  return true;
};

// ---- Offline catalogue ------------------------------------------------------

/** Trim a server row down to what a lookup actually needs. */
export const toCatalogRow = (record = {}) => ({
  product_variant_id: Number(record.product_variant_id ?? record.variant_id ?? record.id ?? 0) || null,
  product_id: Number(record.product_id ?? 0) || null,
  product_name: str(record.product_name ?? record.name),
  color: str(record.color),
  size: str(record.size),
  sku: str(record.sku),
  barcode: str(record.barcode),
  article_code: str(record.article_code),
  product_sku: str(record.product_sku),
  product_barcode: str(record.product_barcode),
  stock: toNumber(record.stock, 0),
  gender: str(record.gender),
  type: str(record.type),
  category: str(record.category),
  brand: str(record.brand),
  manufacturer_name: str(record.manufacturer_name),
  image_url: str(record.image_url),
});

const CODE_FIELDS = ["barcode", "sku", "article_code", "product_barcode", "product_sku"];

/**
 * Offline lookup, mirroring the server's ranking so the employee cannot tell
 * which one answered: an exact code wins outright and pulls in the whole colour
 * (every size of it), otherwise the query matches names and codes loosely.
 */
export const searchCatalogRows = (rows = [], rawQuery = "", limit = 60) => {
  const query = lower(rawQuery);
  if (!query) return [];
  const list = Array.isArray(rows) ? rows : [];

  const exactRow = list.find((row) => CODE_FIELDS.some((field) => lower(row[field]) === query));
  if (exactRow) {
    // A scanned code identifies a colourway; the count is taken per colour, so
    // every size of that colour has to come back, not just the scanned row.
    const colorKey = lower(exactRow.color);
    const matches = list.filter(
      (row) => row.product_id === exactRow.product_id && lower(row.color) === colorKey
    );
    return matches.length ? matches : [exactRow];
  }

  const matches = [];
  for (const row of list) {
    const haystack = `${lower(row.product_name)} ${lower(row.color)} ${lower(row.article_code)} ${lower(row.sku)} ${lower(row.barcode)}`;
    if (haystack.includes(query)) matches.push(row);
    if (matches.length >= limit) break;
  }
  return matches;
};

/** Older than this and the phone refreshes the catalogue when it has signal. */
export const CATALOG_REFRESH_MS = 12 * 60 * 60 * 1000;

export const catalogIsStale = (snapshot, now = Date.now()) => {
  if (!snapshot || !Array.isArray(snapshot.variants) || !snapshot.variants.length) return true;
  const savedAt = Number(snapshot.savedAt || 0);
  if (!savedAt) return true;
  return now - savedAt > CATALOG_REFRESH_MS;
};
