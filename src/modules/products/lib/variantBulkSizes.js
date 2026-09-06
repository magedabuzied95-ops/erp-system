import { generateBarcode } from "./catalog.js";
import { normalizeArticleCodes, rowInheritsColorArticleCodes } from "../../../../shared/articleCode.js";
import {
  CROCS_SIZE_GROUPS,
  compareCrocsSizes,
  isKnownCrocsSize,
  normalizeCrocsSizeValue,
} from "../../../shared/lib/crocsSizes.js";

export const CROCS_SIZE_LIBRARY = Object.fromEntries(
  CROCS_SIZE_GROUPS.map((group) => [group.id, group.sizes])
);

export const CROCS_SIZE_LIBRARY_OPTIONS = CROCS_SIZE_GROUPS;

export const formatCrocsSizeLibraryLabel = (size = {}) => {
  return normalizeCrocsSizeValue(size?.size ?? size?.value ?? size);
};

export const getCrocsSizeLibraryItems = (libraryId = "") =>
  (CROCS_SIZE_LIBRARY_OPTIONS.find((item) => item.id === libraryId)?.sizes || []).map((size) => ({
    size,
    value: size,
    eu: size,
    displayLabel: formatCrocsSizeLibraryLabel(size),
  }));

export const getCrocsSizeInputDisplayLabel = (value = "") => normalizeCrocsSizeValue(value);

const getProductSizeSortValue = (value = "") => {
  const rawValue =
    typeof value === "object" && value !== null
      ? String(value.size || value.eu || value.label || "").trim()
      : String(value || "").trim();
  const normalizedValue = rawValue.toLowerCase().replace(/\s+/g, "");
  const numericMatch = normalizedValue.match(/\d+(?:\.\d+)?/);
  return {
    normalizedValue,
    numericValue: numericMatch ? Number(numericMatch[0]) : Number.POSITIVE_INFINITY,
  };
};

export const sortProductSizes = (sizes = []) =>
  [...(Array.isArray(sizes) ? sizes : [])].sort((left, right) => {
    const leftValue = typeof left === "object" && left !== null ? left.size ?? left.eu ?? left.label ?? "" : left;
    const rightValue = typeof right === "object" && right !== null ? right.size ?? right.eu ?? right.label ?? "" : right;
    if (isKnownCrocsSize(leftValue) || isKnownCrocsSize(rightValue)) {
      return compareCrocsSizes(leftValue, rightValue);
    }

    const leftSort = getProductSizeSortValue(left);
    const rightSort = getProductSizeSortValue(right);

    if (leftSort.numericValue !== rightSort.numericValue) {
      return leftSort.numericValue - rightSort.numericValue;
    }

    if (leftSort.normalizedValue !== rightSort.normalizedValue) {
      return leftSort.normalizedValue.localeCompare(rightSort.normalizedValue, "en", {
        numeric: true,
        sensitivity: "base",
      });
    }

    return 0;
  });

export const isCrocsProductType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.includes("croc") || normalized.includes("كروكس");
};

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
  sizeManualOverride: Boolean(defaults.sizeManualOverride),
  stock: formatFieldValue(defaults.stock),
  available_stock: formatFieldValue(defaults.available_stock),
  sku: formatFieldValue(defaults.sku),
  skuManualOverride: Boolean(defaults.skuManualOverride),
  article_code: formatFieldValue(
    defaults.article_code ??
      defaults.articleCode ??
      defaults.variant_article_code ??
      normalizeArticleCodes(defaults.article_codes)[0]
  ),
  article_codes: normalizeArticleCodes(
    defaults.article_codes,
    defaults.articleCodes,
    defaults.article_code ?? defaults.articleCode ?? defaults.variant_article_code
  ),
  // Left undefined on purpose: a row with no code of its own follows the colour
  // until someone types one there, and only an explicit flag overrides that.
  article_code_inherited:
    typeof defaults.article_code_inherited === "boolean" ? defaults.article_code_inherited : undefined,
  barcode: formatFieldValue(
    Object.prototype.hasOwnProperty.call(defaults, "barcode")
      ? defaults.barcode
      : generateBarcode()
  ),
  barcodeManualOverride: Boolean(defaults.barcodeManualOverride),
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

const isRemovableStarterRow = (row = {}, productPrice = 0) => {
  const hasSavedId = Boolean(row.variantId || row.variant_id || row.idFromServer || row.database_id);
  const hasManualSize = Boolean(row.sizeManualOverride);
  const hasManualSku = Boolean(row.skuManualOverride && String(row.sku || "").trim());
  const hasManualBarcode = Boolean(
    row.barcodeManualOverride ||
      row.manualBarcode ||
      row.barcode_manually_entered ||
      row.isManualBarcode
  );
  const hasPlannedQty = normalizeNumberValue(row.planned_qty ?? row.planned_quantity) > 0;
  const hasRealStock =
    normalizeNumberValue(row.stock) > 0 ||
    normalizeNumberValue(row.available_stock) > 0 ||
    normalizeNumberValue(row.quantity) > 0;
  const rowPrice = normalizeNumberValue(row.price);
  const currentPrice = normalizeNumberValue(productPrice);
  const hasPriceOverride = rowPrice > 0 && rowPrice !== currentPrice;

  return (
    !hasSavedId &&
    !String(row.size || "").trim() &&
    !hasManualSize &&
    !hasManualSku &&
    !hasManualBarcode &&
    !hasPlannedQty &&
    !hasRealStock &&
    !hasPriceOverride
  );
};

const isStrictlyEmptyBulkRow = (row = {}) => {
  const size = String(row.size || "").trim();
  const sku = String(row.sku || "").trim();
  const barcode = String(row.barcode || "").trim();
  const stock = normalizeNumberValue(row.stock);
  return !size && !sku && !barcode && stock === 0;
};

const isReusableBulkEmptyRow = (row = {}, productPrice = 0) => {
  if (isStrictlyEmptyBulkRow(row)) return true;
  return isRemovableStarterRow(row, productPrice);
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
    if (group?.__skipBulkSizes) {
      const { __skipBulkSizes, ...cleanGroup } = group;
      return cleanGroup;
    }
    if (targetGroupId && group.id !== targetGroupId) return group;

    const originalRows = Array.isArray(group.sizes) ? group.sizes : [];
    const reusableRowIndexes = [];
    originalRows.forEach((row, index) => {
      if (isReusableBulkEmptyRow(row, price)) {
        reusableRowIndexes.push(index);
      }
    });

    const existingSizes = new Set(
      originalRows
        .map((row) => normalizeSizeValue(row.size))
        .filter(Boolean)
    );
    const missingSizes = [];
    const missingSizeKeys = new Set();
    sizes.forEach((size) => {
      const key = normalizeSizeValue(size);
      if (!key || existingSizes.has(key) || missingSizeKeys.has(key)) return;
      missingSizeKeys.add(key);
      missingSizes.push(size);
    });

    let consumedReusableRow = false;
    let nextMissingSizeIndex = 0;
    const nextRows = originalRows
      .map((row) => {
        if (!isReusableBulkEmptyRow(row, price)) return row;

        if (!consumedReusableRow && nextMissingSizeIndex < missingSizes.length) {
          const size = missingSizes[nextMissingSizeIndex];
          nextMissingSizeIndex += 1;
          consumedReusableRow = true;
          return {
            ...row,
            isStarter: false,
            size,
            stock: formatFieldValue(row.stock || 0),
            sku: "",
            skuManualOverride: false,
            barcode: String(row.barcode || "").trim() || generateBarcode(),
            barcodeManualOverride: false,
            price: formatFieldValue(row.price || 0),
            image_url: row.image_url || group.image_url || "",
            manufacturer_id: row.manufacturer_id || group.manufacturer_id || "",
            ...(rowInheritsColorArticleCodes(row)
              ? {
                  article_codes: normalizeArticleCodes(group.color_article_codes, group.color_article_code),
                  article_code: normalizeArticleCodes(group.color_article_codes, group.color_article_code)[0] || "",
                  article_code_inherited: true,
                }
              : {}),
          };
        }

        removedPlaceholderCount += 1;
        return null;
      })
      .filter(Boolean);

    // A size added in bulk starts out following the colour Article Code, the
    // same as a size added by hand.
    const groupArticleCodes = normalizeArticleCodes(group.color_article_codes, group.color_article_code);
    const appendedRows = missingSizes.slice(nextMissingSizeIndex).map((size) =>
      createVariantRow({
        variantId: null,
        isStarter: false,
        size,
        stock: 0,
        sku: "",
        barcode: generateBarcode(),
        price: 0,
        image_url: group.image_url || "",
        manufacturer_id: group.manufacturer_id || "",
        article_codes: groupArticleCodes,
        article_code_inherited: true,
      })
    );

    nextRows.push(...appendedRows);

    groupLogs.push({
      groupId: group.id,
      removedPlaceholders: reusableRowIndexes.length - (consumedReusableRow ? 1 : 0),
      existingNormalizedSizes: Array.from(existingSizes),
      finalSizes: nextRows.map((row) => row.size).filter(Boolean),
    });

    if (missingSizes.length === 0 && reusableRowIndexes.length === 0) return group;

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
  let changedCount = 0;
  const updatedGroups = groups.map((group) => {
    if (group?.__skipBulkStock) {
      const { __skipBulkStock, ...cleanGroup } = group;
      return cleanGroup;
    }
    if (targetGroupId && group.id !== targetGroupId) return group;

    return {
      ...group,
      sizes: (Array.isArray(group.sizes) ? group.sizes : []).map((row) => {
        changedCount += 1;
        return {
          ...row,
          stock: formatFieldValue(stock),
        };
      }),
    };
  });

  return { groups: updatedGroups, changedCount };
};
