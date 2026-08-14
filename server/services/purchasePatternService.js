import { resolveSizeGroups } from "../utils/sizeGroups.js";

export const PURCHASE_MODES = Object.freeze({ INDIVIDUAL: "INDIVIDUAL", FULL_COLOR_RUN: "FULL_COLOR_RUN", FULL_CARTON: "FULL_CARTON" });
const text = (value = "") => String(value ?? "").trim();
const colorKey = (value = "") => text(value).toLocaleLowerCase("en");

export const normalizePurchaseMode = (value, fallback = null) => {
  const normalized = text(value).toUpperCase().replace(/[\s-]+/g, "_");
  if (["UNIT", "SINGLE", "INDIVIDUAL"].includes(normalized)) return PURCHASE_MODES.INDIVIDUAL;
  if (["COLOR", "COLOR_RUN", "FULL_COLOR", "FULL_COLOR_RUN"].includes(normalized)) return PURCHASE_MODES.FULL_COLOR_RUN;
  if (["CARTON", "FULL_CARTON"].includes(normalized)) return PURCHASE_MODES.FULL_CARTON;
  return fallback;
};

export const parseCartonColors = (value) => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch {
    // A plain comma/newline-separated value is supported by the product form.
  }
  return value.split(/[,\n|]+/).map(text).filter(Boolean);
};

export const normalizeCartonColors = (value) => parseCartonColors(value);

const strictPositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const error = (code, message, details = {}) => ({ code, message, ...details });

export const validatePurchasePatternConfiguration = (product = {}, variants = []) => {
  const rawMode = text(product.purchase_mode);
  if (!rawMode) return { valid: true, configured: false, mode: null, errors: [] };

  const mode = normalizePurchaseMode(rawMode);
  const errors = [];
  if (!mode) errors.push(error("invalid_purchase_mode", `Unknown purchase mode: ${rawMode}`, { field: "purchase_mode" }));

  const hasMultiGroupValue = product.purchase_size_groups !== undefined && product.purchase_size_groups !== null;
  const rawGroups = hasMultiGroupValue ? product.purchase_size_groups : product.purchase_size_group;
  const resolvedGroups = resolveSizeGroups(rawGroups);
  const needsRun = mode === PURCHASE_MODES.FULL_COLOR_RUN || mode === PURCHASE_MODES.FULL_CARTON;
  if (needsRun && resolvedGroups.keys.length === 0) errors.push(error("size_group_required", "At least one size group is required", { field: "purchase_size_groups" }));
  if (resolvedGroups.invalid_keys.length) errors.push(error("invalid_size_group", `Unknown size group: ${resolvedGroups.invalid_keys.join(", ")}`, {
    field: "purchase_size_groups", size_groups: resolvedGroups.invalid_keys,
  }));

  const piecesPerSize = needsRun ? strictPositiveInt(product.purchase_pieces_per_size) : null;
  if (needsRun && piecesPerSize === null) {
    errors.push(error("invalid_pieces_per_size", "Pieces per size must be a positive integer", { field: "purchase_pieces_per_size" }));
  }

  const rawColors = parseCartonColors(product.purchase_carton_colors);
  const colorsPerCarton = mode === PURCHASE_MODES.FULL_CARTON ? strictPositiveInt(product.purchase_colors_per_carton) : null;
  if (mode === PURCHASE_MODES.FULL_CARTON && colorsPerCarton === null) {
    errors.push(error("invalid_colors_per_carton", "Colors per carton must be a positive integer", { field: "purchase_colors_per_carton" }));
  }
  if (mode === PURCHASE_MODES.FULL_CARTON && rawColors.length === 0) {
    errors.push(error("carton_colors_required", "Carton colors are required", { field: "purchase_carton_colors" }));
  }

  const seen = new Set();
  const duplicates = [];
  for (const color of rawColors) {
    const key = colorKey(color);
    if (seen.has(key)) duplicates.push(color);
    seen.add(key);
  }
  if (duplicates.length) {
    errors.push(error("duplicate_carton_colors", `Duplicate carton colors: ${duplicates.join(", ")}`, { field: "purchase_carton_colors", colors: duplicates }));
  }
  if (mode === PURCHASE_MODES.FULL_CARTON && colorsPerCarton !== null && rawColors.length !== colorsPerCarton) {
    errors.push(error("carton_color_count_mismatch", `Expected ${colorsPerCarton} carton colors, received ${rawColors.length}`, {
      field: "purchase_carton_colors", expected: colorsPerCarton, actual: rawColors.length,
    }));
  }

  if (mode === PURCHASE_MODES.FULL_CARTON && variants.length) {
    const available = new Set(variants.map((variant) => colorKey(variant.color)).filter(Boolean));
    const unknown = rawColors.filter((color) => !available.has(colorKey(color)));
    if (unknown.length) errors.push(error("unknown_carton_colors", `Unknown carton colors: ${unknown.join(", ")}`, { colors: unknown }));
  }

  return {
    valid: errors.length === 0,
    configured: true,
    mode,
    size_group: resolvedGroups.keys[0] || null,
    size_groups: resolvedGroups.keys,
    size_group_label: resolvedGroups.groups.map((group) => group.label).join(" + "),
    size_group_labels: resolvedGroups.groups.map((group) => group.label),
    size_range: resolvedGroups.range,
    sizes: resolvedGroups.sizes,
    pieces_per_size: piecesPerSize,
    colors_per_carton: colorsPerCarton,
    carton_colors: rawColors,
    pieces_per_color_run: resolvedGroups.count && piecesPerSize ? resolvedGroups.count * piecesPerSize : 0,
    pieces_per_carton: resolvedGroups.count && piecesPerSize && colorsPerCarton ? resolvedGroups.count * piecesPerSize * colorsPerCarton : 0,
    errors,
  };
};

export const resolveProductPurchasePattern = (product = {}, variants = []) => validatePurchasePatternConfiguration(product, variants);

const variantIndex = (variants = []) => {
  const index = new Map();
  for (const variant of variants) {
    const key = `${colorKey(variant.color)}|${text(variant.size)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(variant);
  }
  return index;
};

export const buildPurchaseComposition = ({ product = {}, variants = [], triggerColor = "", triggerVariantIds = [], packs = 1 } = {}) => {
  const pattern = validatePurchasePatternConfiguration(product, variants);
  const multiplier = strictPositiveInt(packs);
  const productId = product.product_id || product.id || variants[0]?.product_id || null;
  if (!pattern.configured) return { ...pattern, lines: [], missing_variants: [], total_pieces: 0, legacy: true };

  const errors = [...pattern.errors];
  if (multiplier === null) errors.push(error("invalid_pack_count", "Pack count must be a positive integer", { field: "packs" }));
  if (errors.length) return { ...pattern, valid: false, errors, lines: [], missing_variants: [], total_pieces: 0, legacy: false };

  if (pattern.mode === PURCHASE_MODES.INDIVIDUAL) {
    const selected = new Set(triggerVariantIds.map(String));
    const candidates = selected.size ? variants.filter((variant) => selected.has(String(variant.variant_id || variant.id))) : variants;
    const lines = candidates.map((variant) => ({
      product_id: productId || variant.product_id,
      variant_id: variant.variant_id || variant.id,
      color: text(variant.color),
      size: text(variant.size),
      quantity: (strictPositiveInt(variant.default_purchase_qty) || 1) * multiplier,
      last_purchase_cost: Number(variant.last_purchase_cost ?? variant.cost_price ?? 0),
    })).filter((line) => line.variant_id);
    return { ...pattern, valid: true, colors: [...new Set(lines.map((line) => line.color).filter(Boolean))], lines, missing_variants: [],
      total_pieces: lines.reduce((sum, line) => sum + line.quantity, 0), legacy: false };
  }

  const colors = pattern.mode === PURCHASE_MODES.FULL_CARTON ? pattern.carton_colors : [text(triggerColor)].filter(Boolean);
  if (!colors.length) {
    const colorError = error("trigger_color_required", "A color is required for a full color run", { field: "triggerColor" });
    return { ...pattern, valid: false, errors: [...errors, colorError], colors: [], lines: [], missing_variants: [], total_pieces: 0, legacy: false };
  }

  const index = variantIndex(variants);
  const lines = [];
  const missing = [];
  const duplicateVariants = [];
  for (const color of colors) {
    for (const size of pattern.sizes) {
      const matches = index.get(`${colorKey(color)}|${text(size)}`) || [];
      if (matches.length === 0) {
        missing.push({ product_id: productId, product_name: text(product.name || product.product_name), color, size });
        continue;
      }
      if (matches.length > 1) {
        duplicateVariants.push({ product_id: productId, product_name: text(product.name || product.product_name), color, size, variant_ids: matches.map((row) => row.variant_id || row.id) });
        continue;
      }
      const variant = matches[0];
      lines.push({
        product_id: productId || variant.product_id,
        variant_id: variant.variant_id || variant.id,
        color: text(variant.color) || color,
        size: text(variant.size) || size,
        quantity: pattern.pieces_per_size * multiplier,
        last_purchase_cost: Number(variant.last_purchase_cost ?? variant.cost_price ?? 0),
      });
    }
  }

  if (missing.length || duplicateVariants.length) {
    const compositionErrors = [
      ...missing.map((item) => error("missing_variant", `Missing variant: ${item.color} / ${item.size}`, item)),
      ...duplicateVariants.map((item) => error("duplicate_variant", `Duplicate variant: ${item.color} / ${item.size}`, item)),
    ];
    return { ...pattern, valid: false, errors: compositionErrors, colors, lines: [], missing_variants: missing,
      duplicate_variants: duplicateVariants, total_pieces: 0,
      expected_total_pieces: (pattern.mode === PURCHASE_MODES.FULL_CARTON ? pattern.pieces_per_carton : pattern.pieces_per_color_run) * multiplier,
      legacy: false };
  }

  return { ...pattern, valid: true, errors: [], colors, lines, missing_variants: [], duplicate_variants: [],
    total_pieces: lines.reduce((sum, line) => sum + line.quantity, 0),
    expected_total_pieces: (pattern.mode === PURCHASE_MODES.FULL_CARTON ? pattern.pieces_per_carton : pattern.pieces_per_color_run) * multiplier,
    legacy: false };
};

export const formatPurchasePatternErrors = (errors = []) => errors.map((item) => item.message).join("; ");
