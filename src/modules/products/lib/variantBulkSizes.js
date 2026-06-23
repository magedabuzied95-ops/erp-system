import { generateBarcode } from "./catalog";

export const CROCS_SIZE_LIBRARY = {
  adult: [
    { eu: "35/36", us: "M3/W5", cm: "22", label: "35/36 (M3/W5) - 22 CM" },
    { eu: "36/37", us: "M4/W6", cm: "23", label: "36/37 (M4/W6) - 23 CM" },
    { eu: "37/38", us: "M5/W7", cm: "24", label: "37/38 (M5/W7) - 24 CM" },
    { eu: "38/39", us: "M6/W8", cm: "25", label: "38/39 (M6/W8) - 25 CM" },
    { eu: "39/40", us: "M7/W9", cm: "25.5", label: "39/40 (M7/W9) - 25.5 CM" },
    { eu: "41/42", us: "M8/W10", cm: "26.5", label: "41/42 (M8/W10) - 26.5 CM" },
    { eu: "42/43", us: "M9/W11", cm: "27.5", label: "42/43 (M9/W11) - 27.5 CM" },
    { eu: "43/44", us: "M10/W12", cm: "28", label: "43/44 (M10/W12) - 28 CM" },
    { eu: "44/45", us: "M11/W13", cm: "29", label: "44/45 (M11/W13) - 29 CM" },
    { eu: "45/46", us: "M12", cm: "30", label: "45/46 (M12) - 30 CM" },
  ],
  kids: [
    { eu: "20/21", us: "C4-C5", cm: "12", label: "20/21 (C4-C5) - 12 CM" },
    { eu: "22/23", us: "C6-C7", cm: "13", label: "22/23 (C6-C7) - 13 CM" },
    { eu: "24/25", us: "C8-C9", cm: "14", label: "24/25 (C8-C9) - 14 CM" },
    { eu: "27/28", us: "C10-C11", cm: "16", label: "27/28 (C10-C11) - 16 CM" },
    { eu: "29/30", us: "C12-C13", cm: "18", label: "29/30 (C12-C13) - 18 CM" },
    { eu: "32/33", us: "J1", cm: "20", label: "32/33 (J1) - 20 CM" },
    { eu: "33/34", us: "J2", cm: "21", label: "33/34 (J2) - 21 CM" },
    { eu: "34/35", us: "J3", cm: "22", label: "34/35 (J3) - 22 CM" },
  ],
};

export const CROCS_SIZE_LIBRARY_OPTIONS = [
  { id: "adult", label: "Crocs Adult", sizes: CROCS_SIZE_LIBRARY.adult },
  { id: "kids", label: "Crocs Kids", sizes: CROCS_SIZE_LIBRARY.kids },
];

export const formatCrocsSizeLibraryLabel = (size = {}) => {
  const eu = String(size?.eu || "").trim();
  const us = String(size?.us || "").trim();
  const cm = String(size?.cm || "").trim();
  return [eu, us, cm ? `${cm} CM` : ""].filter(Boolean).join(" — ");
};

export const getCrocsSizeLibraryItems = (libraryId = "") =>
  (CROCS_SIZE_LIBRARY_OPTIONS.find((item) => item.id === libraryId)?.sizes || []).map((size) => ({
    ...size,
    displayLabel: formatCrocsSizeLibraryLabel(size),
  }));

export const getCrocsSizeInputDisplayLabel = (euValue = "") => {
  const normalizedEu = String(euValue || "").trim();
  if (!normalizedEu) return "";

  for (const option of CROCS_SIZE_LIBRARY_OPTIONS) {
    const match = option.sizes.find((size) => String(size?.eu || "").trim() === normalizedEu);
    if (match) {
      return match.us ? `${match.eu} = ${match.us}` : match.eu;
    }
  }

  return normalizedEu;
};

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
  article_code: formatFieldValue(defaults.article_code ?? defaults.articleCode ?? defaults.variant_article_code),
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

const hasImages = (row = {}) =>
  Boolean(
    String(row.image_url || row.variant_image_url || row.color_image_url || row.image || "").trim() ||
      (Array.isArray(row.images) && row.images.length > 0) ||
      (Array.isArray(row.color_images) && row.color_images.length > 0)
  );

const isRemovableStarterRow = (row = {}, rows = [], productPrice = 0) => {
  const hasSavedId = Boolean(row.variantId || row.variant_id || row.idFromServer || row.database_id);
  const isStarterRow = row.isStarter !== false || rows.length === 1;
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
    isStarterRow &&
    !hasSavedId &&
    !hasManualSize &&
    !hasManualSku &&
    !hasManualBarcode &&
    !hasPlannedQty &&
    !hasRealStock &&
    !hasPriceOverride &&
    !hasImages(row)
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
    if (group?.__skipBulkSizes) {
      const { __skipBulkSizes, ...cleanGroup } = group;
      return cleanGroup;
    }
    if (targetGroupId && group.id !== targetGroupId) return group;

    const originalRows = Array.isArray(group.sizes) ? group.sizes : [];
    const preservedRows = originalRows.filter((row) => !isRemovableStarterRow(row, originalRows, price));
    const removedCount = originalRows.length - preservedRows.length;
    removedPlaceholderCount += removedCount;

    const existingSizes = new Set(
      preservedRows
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
    const nextRows = [
      ...preservedRows,
      ...missingSizes.map((size) =>
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
          })
        ),
    ];

    groupLogs.push({
      groupId: group.id,
      removedPlaceholders: removedCount,
      existingNormalizedSizes: Array.from(existingSizes),
      finalSizes: nextRows.map((row) => row.size).filter(Boolean),
    });

    if (missingSizes.length === 0 && removedCount === 0) return group;

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
