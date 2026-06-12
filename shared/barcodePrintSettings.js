export const BARCODE_PRINT_DEFAULTS = {
  paperSize: "a4",
  customPaperWidthMm: 210,
  customPaperHeightMm: 297,
  labelWidthMm: 92,
  labelHeightMm: 62,
  labelsPerRow: 2,
  labelsPerPage: 0,
  gapMm: 6,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  barcodeWidthScale: 100,
  barcodeHeight: 88,
  showProductImage: true,
  showProductName: true,
  showPrice: true,
  showSkuArticle: true,
  showSizeColor: true,
};

export const DISPLAY_REFILL_BARCODE_DEFAULTS = {
  defaultPrinter: "",
  labelSize: "50x30",
  copies: 1,
  autoPrintWhenDisplayed: false,
};

export const BARCODE_PRINT_SETTING_KEYS = [
  "general.barcode_print_paper_size",
  "general.barcode_print_custom_paper_width_mm",
  "general.barcode_print_custom_paper_height_mm",
  "general.barcode_print_label_width_mm",
  "general.barcode_print_label_height_mm",
  "general.barcode_print_labels_per_row",
  "general.barcode_print_labels_per_page",
  "general.barcode_print_gap_mm",
  "general.barcode_print_margin_top_mm",
  "general.barcode_print_margin_right_mm",
  "general.barcode_print_margin_bottom_mm",
  "general.barcode_print_margin_left_mm",
  "general.barcode_print_barcode_width_scale",
  "general.barcode_print_barcode_height",
  "general.barcode_print_show_product_image",
  "general.barcode_print_show_product_name",
  "general.barcode_print_show_price",
  "general.barcode_print_show_sku_article",
  "general.barcode_print_show_size_color",
  "general.barcode_print_default_printer",
  "general.barcode_print_display_label_size",
  "general.barcode_print_display_copies",
  "general.barcode_print_auto_print_on_displayed",
];

const DISPLAY_REFILL_LABEL_SIZES = new Set(["40x30", "50x30", "50x100"]);

const PAPER_PRESETS = {
  a4: { widthMm: 210, heightMm: 297, pageCss: "A4 portrait" },
  a5: { widthMm: 148, heightMm: 210, pageCss: "A5 portrait" },
  thermal: { widthMm: 80, heightMm: null, pageCss: null },
  custom: { widthMm: null, heightMm: null, pageCss: null },
};

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const coerceBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return fallback;
};

export const barcodePrintSettingsFromValues = (values = {}) => ({
  paperSize: values["general.barcode_print_paper_size"],
  customPaperWidthMm: values["general.barcode_print_custom_paper_width_mm"],
  customPaperHeightMm: values["general.barcode_print_custom_paper_height_mm"],
  labelWidthMm: values["general.barcode_print_label_width_mm"],
  labelHeightMm: values["general.barcode_print_label_height_mm"],
  labelsPerRow: values["general.barcode_print_labels_per_row"],
  labelsPerPage: values["general.barcode_print_labels_per_page"],
  gapMm: values["general.barcode_print_gap_mm"],
  marginTopMm: values["general.barcode_print_margin_top_mm"],
  marginRightMm: values["general.barcode_print_margin_right_mm"],
  marginBottomMm: values["general.barcode_print_margin_bottom_mm"],
  marginLeftMm: values["general.barcode_print_margin_left_mm"],
  barcodeWidthScale: values["general.barcode_print_barcode_width_scale"],
  barcodeHeight: values["general.barcode_print_barcode_height"],
  showProductImage: values["general.barcode_print_show_product_image"],
  showProductName: values["general.barcode_print_show_product_name"],
  showPrice: values["general.barcode_print_show_price"],
  showSkuArticle: values["general.barcode_print_show_sku_article"],
  showSizeColor: values["general.barcode_print_show_size_color"],
});

export const displayRefillBarcodeSettingsFromValues = (values = {}) => ({
  defaultPrinter: values["general.barcode_print_default_printer"],
  labelSize: values["general.barcode_print_display_label_size"],
  copies: values["general.barcode_print_display_copies"],
  autoPrintWhenDisplayed: values["general.barcode_print_auto_print_on_displayed"],
});

export const barcodePrintSettingsToValues = (settings = {}) => {
  const normalized = normalizeBarcodePrintSettings(settings);
  return {
    "general.barcode_print_paper_size": normalized.paperSize,
    "general.barcode_print_custom_paper_width_mm": normalized.customPaperWidthMm,
    "general.barcode_print_custom_paper_height_mm": normalized.customPaperHeightMm,
    "general.barcode_print_label_width_mm": normalized.labelWidthMm,
    "general.barcode_print_label_height_mm": normalized.labelHeightMm,
    "general.barcode_print_labels_per_row": normalized.labelsPerRow,
    "general.barcode_print_labels_per_page": normalized.labelsPerPage,
    "general.barcode_print_gap_mm": normalized.gapMm,
    "general.barcode_print_margin_top_mm": normalized.marginTopMm,
    "general.barcode_print_margin_right_mm": normalized.marginRightMm,
    "general.barcode_print_margin_bottom_mm": normalized.marginBottomMm,
    "general.barcode_print_margin_left_mm": normalized.marginLeftMm,
    "general.barcode_print_barcode_width_scale": normalized.barcodeWidthScale,
    "general.barcode_print_barcode_height": normalized.barcodeHeight,
    "general.barcode_print_show_product_image": normalized.showProductImage,
    "general.barcode_print_show_product_name": normalized.showProductName,
    "general.barcode_print_show_price": normalized.showPrice,
    "general.barcode_print_show_sku_article": normalized.showSkuArticle,
    "general.barcode_print_show_size_color": normalized.showSizeColor,
  };
};

export const displayRefillBarcodeSettingsToValues = (settings = {}) => {
  const normalized = normalizeDisplayRefillBarcodeSettings(settings);
  return {
    "general.barcode_print_default_printer": normalized.defaultPrinter,
    "general.barcode_print_display_label_size": normalized.labelSize,
    "general.barcode_print_display_copies": normalized.copies,
    "general.barcode_print_auto_print_on_displayed": normalized.autoPrintWhenDisplayed,
  };
};

export const normalizeBarcodePrintSettings = (settings = {}) => {
  const paperSize = String(settings.paperSize || BARCODE_PRINT_DEFAULTS.paperSize).trim().toLowerCase();
  const normalizedPaperSize = PAPER_PRESETS[paperSize] ? paperSize : BARCODE_PRINT_DEFAULTS.paperSize;
  return {
    paperSize: normalizedPaperSize,
    customPaperWidthMm: clampNumber(settings.customPaperWidthMm, BARCODE_PRINT_DEFAULTS.customPaperWidthMm, 20, 500),
    customPaperHeightMm: clampNumber(settings.customPaperHeightMm, BARCODE_PRINT_DEFAULTS.customPaperHeightMm, 20, 500),
    labelWidthMm: clampNumber(settings.labelWidthMm, BARCODE_PRINT_DEFAULTS.labelWidthMm, 15, 200),
    labelHeightMm: clampNumber(settings.labelHeightMm, BARCODE_PRINT_DEFAULTS.labelHeightMm, 15, 200),
    labelsPerRow: clampNumber(settings.labelsPerRow, BARCODE_PRINT_DEFAULTS.labelsPerRow, 1, 12),
    labelsPerPage: clampNumber(settings.labelsPerPage, BARCODE_PRINT_DEFAULTS.labelsPerPage, 0, 999),
    gapMm: clampNumber(settings.gapMm, BARCODE_PRINT_DEFAULTS.gapMm, 0, 40),
    marginTopMm: clampNumber(settings.marginTopMm, BARCODE_PRINT_DEFAULTS.marginTopMm, 0, 40),
    marginRightMm: clampNumber(settings.marginRightMm, BARCODE_PRINT_DEFAULTS.marginRightMm, 0, 40),
    marginBottomMm: clampNumber(settings.marginBottomMm, BARCODE_PRINT_DEFAULTS.marginBottomMm, 0, 40),
    marginLeftMm: clampNumber(settings.marginLeftMm, BARCODE_PRINT_DEFAULTS.marginLeftMm, 0, 40),
    barcodeWidthScale: clampNumber(settings.barcodeWidthScale, BARCODE_PRINT_DEFAULTS.barcodeWidthScale, 40, 200),
    barcodeHeight: clampNumber(settings.barcodeHeight, BARCODE_PRINT_DEFAULTS.barcodeHeight, 36, 160),
    showProductImage: coerceBoolean(settings.showProductImage, BARCODE_PRINT_DEFAULTS.showProductImage),
    showProductName: coerceBoolean(settings.showProductName, BARCODE_PRINT_DEFAULTS.showProductName),
    showPrice: coerceBoolean(settings.showPrice, BARCODE_PRINT_DEFAULTS.showPrice),
    showSkuArticle: coerceBoolean(settings.showSkuArticle, BARCODE_PRINT_DEFAULTS.showSkuArticle),
    showSizeColor: coerceBoolean(settings.showSizeColor, BARCODE_PRINT_DEFAULTS.showSizeColor),
  };
};

export const normalizeDisplayRefillBarcodeSettings = (settings = {}) => {
  const labelSize = String(settings.labelSize || DISPLAY_REFILL_BARCODE_DEFAULTS.labelSize).trim().toLowerCase();
  return {
    defaultPrinter: String(settings.defaultPrinter || DISPLAY_REFILL_BARCODE_DEFAULTS.defaultPrinter).trim(),
    labelSize: DISPLAY_REFILL_LABEL_SIZES.has(labelSize) ? labelSize : DISPLAY_REFILL_BARCODE_DEFAULTS.labelSize,
    copies: clampNumber(settings.copies, DISPLAY_REFILL_BARCODE_DEFAULTS.copies, 1, 999),
    autoPrintWhenDisplayed: coerceBoolean(settings.autoPrintWhenDisplayed, DISPLAY_REFILL_BARCODE_DEFAULTS.autoPrintWhenDisplayed),
  };
};

export const resolveBarcodePrintPaper = (settings = {}) => {
  const normalized = normalizeBarcodePrintSettings(settings);
  const preset = PAPER_PRESETS[normalized.paperSize] || PAPER_PRESETS.a4;
  const paperWidthMm = preset.widthMm ?? normalized.customPaperWidthMm;
  const labelsPerPage = Math.max(0, Number(normalized.labelsPerPage || 0));
  const labelsPerRow = Math.max(1, Number(normalized.labelsPerRow || 1));
  const gapMm = Number(normalized.gapMm || 0);
  const rowsPerPage = labelsPerPage > 0 ? Math.ceil(labelsPerPage / labelsPerRow) : 0;
  const autoHeightMm = normalized.marginTopMm + normalized.marginBottomMm + (rowsPerPage > 0 ? rowsPerPage * normalized.labelHeightMm + Math.max(0, rowsPerPage - 1) * gapMm : normalized.labelHeightMm);
  const paperHeightMm = preset.heightMm ?? (normalized.paperSize === "custom" ? normalized.customPaperHeightMm : autoHeightMm);
  const pageCss = preset.pageCss || `${paperWidthMm}mm ${paperHeightMm}mm`;
  return {
    paperWidthMm,
    paperHeightMm,
    pageCss,
  };
};

export const paginateBarcodeLabels = (labels = [], labelsPerPage = 0) => {
  const safePerPage = Math.max(0, Number(labelsPerPage || 0));
  if (!safePerPage) return [Array.isArray(labels) ? labels : []];
  const pages = [];
  for (let index = 0; index < labels.length; index += safePerPage) {
    pages.push(labels.slice(index, index + safePerPage));
  }
  return pages.length ? pages : [[]];
};
