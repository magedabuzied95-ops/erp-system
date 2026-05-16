import { generateBarcode } from "./catalog";

const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const formatFieldValue = (value) => (value === null || value === undefined ? "" : String(value));

const normalizeSizeValue = (value) => String(value ?? "").trim().toLowerCase();

const normalizeNumberValue = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parseBulkSizes = (value = "") => {
  const seen = new Set();
  const sizes = [];

  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
      const values = [];

      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (Number.isInteger(start) && Number.isInteger(end)) {
          const step = start <= end ? 1 : -1;
          for (let size = start; step > 0 ? size <= end : size >= end; size += step) {
            values.push(String(size));
          }
        }
      } else {
        values.push(part);
      }

      values.forEach((size) => {
        const normalized = String(size || "").trim();
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        sizes.push(normalized);
      });
    });

  return sizes;
};

export const createVariantRow = (defaults = {}) => ({
  id: defaults.id || makeId(),
  variantId: defaults.variantId || null,
  isStarter: defaults.isStarter ?? !defaults.variantId,
  size: formatFieldValue(defaults.size),
  stock: formatFieldValue(defaults.stock),
  available_stock: formatFieldValue(defaults.available_stock),
  sku: formatFieldValue(defaults.sku),
  barcode: formatFieldValue(
    Object.prototype.hasOwnProperty.call(defaults, "barcode")
      ? defaults.barcode
      : generateBarcode()
  ),
  price: formatFieldValue(defaults.price),
  image_url: formatFieldValue(defaults.image_url),
  manufacturer_id: formatFieldValue(defaults.manufacturer_id),
  edition_name: formatFieldValue(defaults.edition_name),
});

export const isPlaceholderVariantRow = (row = {}, productPrice = 0) => {
  const hasVariantId = Boolean(row.variantId || row.variant_id || row.idFromServer);
  const size = String(row.size || "").trim();
  const stock = normalizeNumberValue(row.stock);
  const sku = String(row.sku || "").trim();
  const price = normalizeNumberValue(row.price);
  const currentPrice = normalizeNumberValue(productPrice);

  return (
    !hasVariantId &&
    !size &&
    stock === 0 &&
    !sku &&
    (price === 0 || price === currentPrice)
  );
};

export const applyBulkSizesToGroups = ({
  groups = [],
  sizes = [],
  targetGroupId = null,
  price = 0,
} = {}) => {
  let addedCount = 0;
  let removedPlaceholderCount = 0;
  const groupLogs = [];
  const updatedGroups = groups.map((group) => {
    if (targetGroupId && group.id !== targetGroupId) return group;

    const originalRows = Array.isArray(group.sizes) ? group.sizes : [];
    const realRows = originalRows.filter((row) => !isPlaceholderVariantRow(row, price));
    const removedForGroup = originalRows.length - realRows.length;
    removedPlaceholderCount += removedForGroup;

    const existingSizes = new Set(
      realRows
        .map((row) => normalizeSizeValue(row.size))
        .filter(Boolean)
    );
    const missingSizes = sizes.filter((size) => !existingSizes.has(normalizeSizeValue(size)));
    const nextRows = [
      ...realRows,
      ...missingSizes.map((size) =>
        createVariantRow({
          variantId: null,
          isStarter: false,
          size,
            stock: 0,
            sku: "",
            barcode: generateBarcode(),
            price: price || 0,
            image_url: group.image_url || "",
            manufacturer_id: group.manufacturer_id || "",
          })
        ),
    ];

    groupLogs.push({
      groupId: group.id,
      removedPlaceholders: removedForGroup,
      existingNormalizedSizes: Array.from(existingSizes),
      finalSizes: nextRows.map((row) => row.size).filter(Boolean),
    });

    if (missingSizes.length === 0 && removedForGroup === 0) return group;

    addedCount += missingSizes.length;
    return {
      ...group,
      sizes: nextRows,
    };
  });

  console.log("[bulk-sizes] placeholder rows removed", removedPlaceholderCount);
  console.log("[bulk-sizes] existing normalized sizes", groupLogs.map((item) => ({
    groupId: item.groupId,
    existingNormalizedSizes: item.existingNormalizedSizes,
  })));
  console.log("[bulk-sizes] final sizes", groupLogs.map((item) => ({
    groupId: item.groupId,
    finalSizes: item.finalSizes,
  })));

  return { groups: updatedGroups, addedCount, removedPlaceholderCount };
};

export const parseBulkPrice = (value = "") => {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!raw) return null;
  const price = Number(raw);
  return Number.isFinite(price) && price >= 0 ? price : null;
};

export const applyBulkPriceToGroups = ({
  groups = [],
  price = 0,
  targetGroupId = null,
} = {}) => {
  const updatedGroups = groups.map((group) => {
    if (targetGroupId && group.id !== targetGroupId) return group;

    return {
      ...group,
      sizes: (Array.isArray(group.sizes) ? group.sizes : []).map((row) => ({
        ...row,
        price: formatFieldValue(price),
      })),
    };
  });

  return { groups: updatedGroups };
};

export const parseBulkStock = (value = "") => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const stock = Number(raw);
  return Number.isInteger(stock) && stock >= 0 ? stock : null;
};

export const applyBulkStockToGroups = ({
  groups = [],
  stock = 0,
  targetGroupId = null,
} = {}) => {
  const updatedGroups = groups.map((group) => {
    if (targetGroupId && group.id !== targetGroupId) return group;

    return {
      ...group,
      sizes: (Array.isArray(group.sizes) ? group.sizes : []).map((row) => ({
        ...row,
        stock: formatFieldValue(stock),
      })),
    };
  });

  return { groups: updatedGroups };
};
