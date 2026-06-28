import { useEffect, useMemo, useState } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";

import {
  Download,
  Minus,
  Package2,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";

import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import { api } from "../../../shared/api/api";
import { mergeProductRecord } from "../lib/catalog";
import {
  buildSelectedLabelItems,
  expandLabelCopies,
  getBarcodeSvg,
  getLabelIdentity,
  getLabelPriceInfo,
  getLabelQuantity,
  buildProductLabelItems,
  buildBarcodeShopLabelItem,
  buildSmartProductQrUrl,
  resolveBarcodeLabelImage,
} from "../lib/barcodeLabels";
import { generateBarcodeLabelsPdf } from "../lib/barcodePdfGenerator";
import { formatCurrency } from "../../../shared/lib/currency";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { BARCODE_PRINT_DEFAULTS, barcodePrintSettingsFromValues, normalizeBarcodePrintSettings, paginateBarcodeLabels, resolveBarcodePrintPaper } from "../../../../shared/barcodePrintSettings.js";
import {
  getProducts,
  getProductsWithVariants,
} from "../services/productsApi";

const LABEL_TEMPLATE_STANDARD = "standard";
const LABEL_TEMPLATE_THERMAL_PORTRAIT = "thermal_portrait";
const LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100 = "thermal_landscape_50x100";
const LABEL_TEMPLATE_PREMIUM_RETAIL_50X100 = "premium_retail_50x100";
const SINGLE_BARCODE_TEMPLATE_LABEL = "50x100 Landscape Label";
const PREMIUM_RETAIL_LABEL_WIDTH_MM = 50;
const PREMIUM_RETAIL_LABEL_HEIGHT_MM = 100;
const PREMIUM_RETAIL_BARCODE_WIDTH = 680;
const PREMIUM_RETAIL_BARCODE_HEIGHT = 288;
const PREMIUM_RETAIL_GRID_ROWS = "33mm 12mm 11mm 11mm 20.8mm 7mm";

const resolveTemplatePrintContext = (template, settings, sheetMode) => {
  const normalized = normalizeBarcodePrintSettings({ ...settings, paperSize: sheetMode });
  if (template === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100) {
    const landscapeSettings = normalizeBarcodePrintSettings({
      ...normalized,
      paperSize: "custom",
      customPaperWidthMm: 50,
      customPaperHeightMm: 100,
      labelWidthMm: 100,
      labelHeightMm: 50,
      labelsPerRow: 1,
      labelsPerPage: 1,
      gapMm: 0,
      marginTopMm: 1.5,
      marginRightMm: 1.5,
      marginBottomMm: 1.5,
      marginLeftMm: 1.5,
      barcodeWidthScale: 100,
      barcodeHeight: Math.max(100, Number(normalized.barcodeHeight || 88)),
    });
    return {
      template,
      printSettings: landscapeSettings,
      paper: {
        paperWidthMm: 50,
        paperHeightMm: 100,
        pageCss: "50mm 100mm",
      },
    };
  }
  if (template === LABEL_TEMPLATE_THERMAL_PORTRAIT) {
    const portraitSettings = normalizeBarcodePrintSettings({
      ...normalized,
      paperSize: "custom",
      customPaperWidthMm: 50,
      customPaperHeightMm: 100,
      labelWidthMm: 50,
      labelHeightMm: 100,
      labelsPerRow: 1,
      labelsPerPage: 1,
      gapMm: 0,
      marginTopMm: 1.5,
      marginRightMm: 1.5,
      marginBottomMm: 1.5,
      marginLeftMm: 1.5,
    });
    return {
      template,
      printSettings: portraitSettings,
      paper: {
        paperWidthMm: 50,
        paperHeightMm: 100,
        pageCss: "50mm 100mm",
      },
    };
  }
  if (template === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100) {
    const premiumSettings = normalizeBarcodePrintSettings({
      ...normalized,
      paperSize: "custom",
      customPaperWidthMm: 50,
      customPaperHeightMm: 100,
      labelWidthMm: 50,
      labelHeightMm: 100,
      labelsPerRow: 1,
      labelsPerPage: 1,
      gapMm: 0,
      marginTopMm: 1.2,
      marginRightMm: 1.2,
      marginBottomMm: 1.2,
      marginLeftMm: 1.2,
      barcodeWidthScale: 100,
      barcodeHeight: Math.max(520, Number(normalized.barcodeHeight || 88) * 6),
    });
    return {
      template,
      printSettings: premiumSettings,
      paper: {
        paperWidthMm: 50,
        paperHeightMm: 100,
        pageCss: "50mm 100mm",
      },
    };
  }
  return {
    template,
    printSettings: normalized,
    paper: resolveBarcodePrintPaper(normalized),
  };
};

const nextPaint = () =>
  new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });

const waitForImages = async (root) => {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (!img) {
            resolve();
            return;
          }
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    )
  );
};

const waitForBarcodePrintReady = async (root = null) => {
  if (typeof document === "undefined") return;
  await nextPaint();
  await waitForImages(root || document);
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font readiness errors and proceed with print.
    }
  }
  await nextPaint();
};

const safeText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return (
      value.name ||
      value.title ||
      value.label ||
      value.value ||
      fallback
    );
  }
  return fallback;
};

const formatLabelCurrency = (value) =>
  formatCurrency(Math.round(Number(value || 0))).replace(/([.,٫]\d{2})(?=\s|$)/g, "");

const getProductImage = (product) =>
  product?.image_url ||
  product?.product_image_url ||
  product?.image ||
  product?.photo_url ||
  product?.thumbnail_url ||
  "";

function resolveAssetUrl(url) {
  return resolveProductImageUrl(safeText(url));
}

const preserveVariantImageFields = (product, variant) => {
  const productImage = safeText(product?.image_url || product?.product_image_url);
  const variantImage = safeText(variant?.variant_image_url || variant?.color_image_url || variant?.image_url || variant?.image);
  const merged = mergeProductRecord(product, variant);

  return {
    ...merged,
    variant_id: variant?.variant_id ?? merged.variant_id,
    color_id: variant?.color_id ?? variant?.colorId ?? merged.color_id ?? null,
    image_url: variantImage || "",
        variant_image_url: safeText(variant?.variant_image_url || variantImage),
        color_image_url: safeText(variant?.color_image_url || variant?.variant_image_url || variantImage),
    product_image_url: safeText(product?.product_image_url || productImage),
    productFallbackImage: productImage,
  };
};

const getSafeLabelImage = (imageUrl, item) => {
  const resolvedImage = resolveAssetUrl(String(imageUrl || ""));
  if (!resolvedImage) return "";
  if (resolvedImage.startsWith("data:")) return resolvedImage;

  const separator = resolvedImage.includes("?") ? "&" : "?";
  return `${resolvedImage}${separator}v=${encodeURIComponent(item.variantId || item.key || item.copyIndex || Date.now())}`;
};

const getLabelRenderKey = (item, index, suffix = "label") =>
  [
    suffix,
    item.productId || "product",
    item.variantId || item.key || "variant",
    item.color || "default",
    item.size || "size",
    item.copyIndex || index,
    index,
  ].join("-");

const SMART_QR_SIZE = 168;
const SMART_QR_MARGIN_MODULES = 4;

const buildSmartQrSvgMarkup = (value = "", size = SMART_QR_SIZE) => {
  const safeValue = String(value || "").trim();
  if (!safeValue) return "";
  return renderToStaticMarkup(
    <QRCodeSVG
      value={safeValue}
      size={size}
      marginSize={SMART_QR_MARGIN_MODULES}
      bgColor="#ffffff"
      fgColor="#111827"
      level="H"
      includeMargin
    />
  );
};

const enrichLabelWithSmartQr = (item, enabled) => {
  const smartQrUrl = String(
    item?.smartQrUrl ||
      buildSmartProductQrUrl({
        productId: item?.productId,
        variantId: item?.variantId,
        colorId: item?.colorId,
      }) ||
      ""
  ).trim();
  if (!enabled || !smartQrUrl) {
    return {
      ...item,
      showSmartProductQr: false,
      smartQrUrl,
      smartQrSvgMarkup: "",
    };
  }
  return {
    ...item,
    showSmartProductQr: true,
    smartQrUrl,
    smartQrSvgMarkup: buildSmartQrSvgMarkup(smartQrUrl),
  };
};

const toSearchText = (row) =>
  [
    row.name,
    row.sku,
    row.barcode,
    row.brand,
    row.category,
    ...(Array.isArray(row.variants)
      ? row.variants.flatMap((variant) => [variant.color, variant.size, variant.sku, variant.barcode])
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const flattenVariantRows = (rows = []) =>
  rows.flatMap((row) => {
    if (Array.isArray(row?.variants) && row.variants.length > 0) {
      return row.variants.map((variant) => ({
        ...variant,
        product_id: row.product_id ?? row.id ?? variant.product_id ?? null,
        product: row,
      }));
    }

    if (row?.variant_id || row?.variantId || row?.size || row?.color) {
      return [row];
    }

    return [];
  });

const barcodeSheetModeFromPaperSize = (paperSize = "") => {
  const value = String(paperSize || "").trim().toLowerCase();
  return ["a4", "a5", "thermal", "custom"].includes(value) ? value : BARCODE_PRINT_DEFAULTS.paperSize;
};

const readBarcodePrintSettings = (settings = []) =>
  normalizeBarcodePrintSettings(
    barcodePrintSettingsFromValues(
      Array.isArray(settings)
        ? settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
          }, {})
        : {}
    )
  );

function BarcodeLabels() {
  const { t, i18n } = useTranslation();
  const language = i18n.language?.startsWith("ar") ? "ar" : "en";
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [catalog, setCatalog] = useState([]);
  const [products, setProducts] = useState([]);
  const [allVariantRows, setAllVariantRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sheetMode, setSheetMode] = useState("a4");
  const [labelTemplate, setLabelTemplate] = useState(LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100);
  const [barcodePrintSettings, setBarcodePrintSettings] = useState(() => normalizeBarcodePrintSettings(BARCODE_PRINT_DEFAULTS));
  const [selectedQuantities, setSelectedQuantities] = useState({});
  const [activeProduct, setActiveProduct] = useState(null);
  const [activeProductNotice, setActiveProductNotice] = useState("");
  const [routeLocked, setRouteLocked] = useState(false);
  const [barcodeShopQuantity, setBarcodeShopQuantity] = useState(1);
  const [includeSmartProductQr, setIncludeSmartProductQr] = useState(false);
  const productId = Number(searchParams.get("productId"));
  const mode = searchParams.get("mode");
  const isBarcodeShopMode = mode === "barcode-shop";
  const availableOnly = String(searchParams.get("availableOnly") || "").toLowerCase() === "true";
  const sheetModes = useMemo(
    () => [
      { value: "a4", label: t("products.barcodeLabels.a4Sheet") },
      { value: "a5", label: "A5" },
      { value: "thermal", label: t("products.barcodeLabels.thermalSheet") },
      { value: "custom", label: "مخصص" },
    ],
    [t]
  );
  const labelTemplates = useMemo(
    () => [{ value: LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100, label: SINGLE_BARCODE_TEMPLATE_LABEL }],
    []
  );
  const labelTemplateFieldLabel = language === "ar" ? "قالب الملصق" : "Label Template";
  const isLandscapeTemplate = labelTemplate === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100;
  const isPremiumRetailTemplate = labelTemplate === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100;

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");

      const [baseProducts, variantRows, generalSettingsPayload] = await Promise.all([
        getProducts(),
        getProductsWithVariants(),
        api.get("/settings/barcode_printing").catch(() => null),
      ]);
      const nextPrintSettings = generalSettingsPayload?.settings?.length
        ? readBarcodePrintSettings(generalSettingsPayload.settings)
        : normalizeBarcodePrintSettings(BARCODE_PRINT_DEFAULTS);
      setBarcodePrintSettings(nextPrintSettings);
      setSheetMode(barcodeSheetModeFromPaperSize(nextPrintSettings.paperSize));
      const flattenedVariantRows = flattenVariantRows(variantRows);

      setProducts(baseProducts);
      setAllVariantRows(flattenedVariantRows);
      const groupedVariants = flattenedVariantRows.reduce((acc, item) => {
        const id = String(item.product_id ?? item.id);
        if (!acc[id]) acc[id] = [];
        if (item.variant_id) acc[id].push(item);
        return acc;
      }, {});

      const mergedCatalog = baseProducts.map((product) => {
        const variants = groupedVariants[String(product.id)] || [];
        const productRecord = {
          ...mergeProductRecord(product, null),
          product_image_url: product.product_image_url || product.image_url || "",
          image_url: product.image_url || product.product_image_url || "",
        };

        return {
          ...productRecord,
          variants: variants.length > 0 ? variants.map((variant) => preserveVariantImageFields(product, variant)) : [productRecord],
        };
      });

      setCatalog(mergedCatalog);

      if (Number.isFinite(productId) && productId > 0) {
        const matchedProduct = mergedCatalog.find((item) => Number(item.id) === Number(productId));
        if (matchedProduct) {
          setActiveProduct(matchedProduct);
          setRouteLocked(true);
          const variantCount = (matchedProduct.variants || []).filter((variant) =>
            availableOnly ? Number(variant.stock || 0) > 0 : true
          ).length;
          setActiveProductNotice(
            isBarcodeShopMode
              ? t("products.barcodeLabels.barcodeShopTitle") + " QR"
              : availableOnly && variantCount === 0
              ? t("products.barcodeLabels.noAvailableStock")
              : availableOnly
                ? `${safeText(matchedProduct.name, t("products.barcodeLabels.product"))} · ${t("products.barcodeLabels.availableVariants", { count: variantCount })}`
                : `${safeText(matchedProduct.name, t("products.barcodeLabels.product"))} · ${t("products.barcodeLabels.variantCount", { count: variantCount })}`
          );
        } else {
          setActiveProduct(null);
          setRouteLocked(true);
          setActiveProductNotice(t("products.barcodeLabels.productNotFound"));
        }
      } else {
        setActiveProduct(null);
        setRouteLocked(false);
        setActiveProductNotice("");
      }
    } catch (err) {
      setError(t("products.barcodeLabels.loadProductsFailed"));
      toast.error(t("products.barcodeLabels.loadFailed"));
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [productId, availableOnly, isBarcodeShopMode]);

  const visibleCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (routeLocked && activeProduct) return [activeProduct];
    if (routeLocked && !activeProduct) return [];
    if (!query) return catalog;
    return catalog.filter((product) => toSearchText(product).includes(query));
  }, [catalog, search, routeLocked, activeProduct]);

  const selectedProduct = useMemo(
    () => {
      if (!Number.isFinite(productId)) return activeProduct;
      return (
        activeProduct ||
        catalog.find((product) => Number(product.id) === Number(productId)) ||
        products.find((product) => Number(product.id) === Number(productId)) ||
        null
      );
    },
    [catalog, products, productId, activeProduct]
  );

  const selectedProductVariants = useMemo(
    () =>
      allVariantRows.filter((row) => {
        const rowProductId =
          row.product_id ??
          row.productId ??
          row.id_product ??
          row.parent_product_id ??
          row.id;

        return Number(rowProductId) === Number(productId);
      }),
    [allVariantRows, productId]
  );

  const selectedProductPriceFallbackVariant = useMemo(
    () =>
      selectedProductVariants.find((variant) =>
        Number(variant?.sale_price || variant?.selling_price || variant?.regular_price || variant?.price || variant?.variant_price || 0) > 0
      ) || selectedProductVariants[0] || null,
    [selectedProductVariants]
  );

  const selectedItems = useMemo(
    () =>
      isBarcodeShopMode && activeProduct
        ? [buildBarcodeShopLabelItem(activeProduct, barcodeShopQuantity, selectedProductPriceFallbackVariant)].filter(Boolean)
        : routeLocked && activeProduct
        ? buildProductLabelItems({ product: activeProduct, availableOnly })
        : buildSelectedLabelItems(catalog, selectedQuantities),
    [catalog, selectedQuantities, routeLocked, activeProduct, availableOnly, isBarcodeShopMode, barcodeShopQuantity, selectedProductPriceFallbackVariant]
  );

  const qrReadyItems = useMemo(
    () => selectedItems.map((item) => enrichLabelWithSmartQr(item, includeSmartProductQr && !isBarcodeShopMode)),
    [includeSmartProductQr, isBarcodeShopMode, selectedItems]
  );

  const expandedLabels = useMemo(() => expandLabelCopies(qrReadyItems), [qrReadyItems]);
  const templateContext = useMemo(
    () => resolveTemplatePrintContext(labelTemplate, barcodePrintSettings, sheetMode),
    [barcodePrintSettings, labelTemplate, sheetMode]
  );
  const activePrintSettings = templateContext.printSettings;
  const activePaper = templateContext.paper;
  const activeSheetLabel = useMemo(
    () =>
      labelTemplates.find((item) => item.value === labelTemplate)?.label ||
      sheetModes.find((item) => item.value === sheetMode)?.label ||
      sheetMode.toUpperCase(),
    [labelTemplate, labelTemplates, sheetMode, sheetModes]
  );
  const previewPages = useMemo(
    () => paginateBarcodeLabels(expandedLabels, activePrintSettings.labelsPerPage),
    [expandedLabels, activePrintSettings.labelsPerPage]
  );

  const totals = useMemo(
    () => ({
      variants: qrReadyItems.length,
      labels: expandedLabels.length,
      products: new Set(qrReadyItems.map((item) => item.productId)).size,
    }),
    [qrReadyItems, expandedLabels]
  );

  const updateQuantity = (key, nextValue) => {
    const quantity = getLabelQuantity(nextValue);
    setSelectedQuantities((prev) => {
      if (quantity <= 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: quantity };
    });
  };

  const clearSelections = () => setSelectedQuantities({});
  const clearRouteFilter = () => {
    setActiveProduct(null);
    setActiveProductNotice("");
    setRouteLocked(false);
    setSelectedQuantities({});
  };

  const handlePrint = async () => {
    if (expandedLabels.length === 0) {
      toast.error(activeProductNotice || t("products.barcodeLabels.selectLabelFirst"));
      return;
    }

    try {
      const result = await generateBarcodeLabelsPdf(expandedLabels, {
        title: t("products.barcodeLabels.labelSheetTitle"),
        filename: `barcode-labels-${Date.now()}.pdf`,
      });
      const pdfBlob = result?.blob;
      const url = URL.createObjectURL(pdfBlob);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        URL.revokeObjectURL(url);
        toast.error(t("products.barcodeLabels.popupBlocked"));
        return;
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      console.warn("[barcode-pdf] generation failed", error);
      toast.error(t("products.barcodeLabels.popupBlocked"));
    }
  };

  const handlePreviewFallback = () => {
    void handlePrint();
  };

  if (isBarcodeShopMode) {
    const normalizedProduct = selectedProduct || activeProduct || null;
    const qrIdentifier =
      normalizedProduct?.slug ||
      normalizedProduct?.canonical_slug ||
      (normalizedProduct?.id ? String(normalizedProduct.id) : "");
    const shopItem =
      normalizedProduct
        ? {
            ...(buildBarcodeShopLabelItem(normalizedProduct, barcodeShopQuantity, selectedProductPriceFallbackVariant) || {}),
            productId: normalizedProduct.id,
            productName: safeText(normalizedProduct.name, t("products.barcodeLabels.product")),
            imageUrl: getProductImage(normalizedProduct),
            qrToken: safeText(qrIdentifier),
            quantity: getLabelQuantity(barcodeShopQuantity) || 1,
          }
        : null;
    const shopLabels = expandLabelCopies(shopItem ? [shopItem] : []);

    return (
      <>
        <div className="print:hidden">
          <ProductsShell
            title={t("products.barcodeLabels.barcodeShopTitle")}
            description={t("products.barcodeLabels.barcodeShopDescription")}
            actions={
              <button
                type="button"
                onClick={handlePrint}
                disabled={loading || !shopItem?.qrToken}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer size={18} />
                {t("products.barcodeLabels.printBarcodeShop")}
              </button>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
                {loading ? (
                  <StateCard title={t("products.barcodeLabels.loadingBarcodeShop")} subtitle={t("products.barcodeLabels.loadingSubtitle")} />
                ) : error ? (
                  <StateCard title={t("products.barcodeLabels.barcodeShopUnavailable")} subtitle={error} />
                ) : !normalizedProduct ? (
                  <StateCard title={t("products.barcodeLabels.barcodeShopNotFound")} subtitle={t("products.barcodeLabels.barcodeShopNotFoundSubtitle")} />
                ) : !shopItem?.qrToken ? (
                  <StateCard title={t("products.barcodeLabels.qrUnavailable")} subtitle={t("products.barcodeLabels.qrUnavailableSubtitle")} />
                ) : (
                  <>
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                      <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 lg:w-36">
                        <ImageWithFallback src={resolveAssetUrl(shopItem.imageUrl)} alt={safeText(shopItem.productName, t("products.barcodeLabels.product"))} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-[0.22em] text-emerald-300">{t("products.barcodeLabels.productLevelQr")}</div>
                        <h2 className="mt-2 text-3xl font-black text-white">{safeText(shopItem.productName, t("products.barcodeLabels.product"))}</h2>
                        <p className="mt-2 text-sm text-zinc-400">{t("products.barcodeLabels.qrToken")}: {safeText(shopItem.qrToken)}</p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {t("products.barcodeLabels.variantRowsLoaded", { count: selectedProductVariants.length })}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-4">
                      <button
                        type="button"
                        onClick={() => setBarcodeShopQuantity((value) => Math.max(1, Number(value || 1) - 1))}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <label className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("products.barcodeLabels.labelQuantity")}</div>
                        <input
                          type="number"
                          min="1"
                          value={barcodeShopQuantity}
                          onChange={(event) => setBarcodeShopQuantity(Math.max(1, getLabelQuantity(event.target.value) || 1))}
                          className="mt-1 w-full bg-transparent text-xl font-black text-white outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setBarcodeShopQuantity((value) => Math.min(999, Number(value || 1) + 1))}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
                <div className="mb-4 text-sm font-semibold text-white">{t("products.barcodeLabels.printPreview")}</div>
                {shopItem ? <BarcodeShopLabel item={shopItem} /> : null}
              </div>
            </div>
          </ProductsShell>
        </div>

        <div className="hidden print:block">
          <div className="grid gap-4 p-4">
            {shopLabels.map((item, index) => (
              <BarcodeShopLabel key={`${item.key}:${index}`} item={item} print />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: ${activePaper.pageCss};
            margin: 0;
          }
        }
      `}</style>
      <div className="barcode-preview-only print:hidden">
        <ProductsShell
          title={t("products.barcodeLabels.labelSheetTitle")}
          description={t("products.barcodeLabels.labelSheetDescription")}
          actions={
            <>
              <button
                type="button"
                onClick={handlePreviewFallback}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
              >
                <Download size={18} />
                {t("products.barcodeLabels.downloadPrintFallback")}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 font-semibold text-white transition hover:bg-emerald-400"
              >
                <Printer size={18} />
                {t("products.barcodeLabels.printLabels")}
              </button>
            </>
          }
        >
          <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="relative">
                <Search className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("products.barcodeLabels.searchPlaceholder")}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 ps-11 pe-4 text-white outline-none placeholder:text-zinc-500"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
                  {sheetModes.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setSheetMode(mode.value)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                        sheetMode === mode.value ? "bg-emerald-500 text-black" : "text-zinc-300 hover:bg-white/10"
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={clearSelections}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("products.barcodeLabels.clearSelection")}
                </button>
              </div>
            </div>

            {activeProductNotice ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {activeProductNotice}
                {routeLocked ? (
                  <button
                    type="button"
                    onClick={clearRouteFilter}
                    className="ml-3 underline decoration-emerald-200/60 underline-offset-4"
                  >
                    {t("products.barcodeLabels.showAllProducts")}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label={t("products.barcodeLabels.selectedProducts")} value={totals.products} />
              <Metric label={t("products.barcodeLabels.selectedVariants")} value={totals.variants} />
              <Metric label={t("products.barcodeLabels.labelCopies")} value={totals.labels} />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 items-start gap-6 2xl:grid-cols-[1.45fr_1.55fr]">
            <div className="space-y-4">
                {loading ? (
                  <StateCard title={t("products.barcodeLabels.loadingLabels")} subtitle={t("products.barcodeLabels.loadingLabelsSubtitle")} />
                ) : error ? (
                  <StateCard
                  title={t("products.barcodeLabels.barcodeLabelsUnavailable")}
                  subtitle={error}
                  action={
                    <button
                      type="button"
                      onClick={loadData}
                      className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black"
                    >
                      {t("products.shared.retry")}
                    </button>
                  }
                />
              ) : visibleCatalog.length === 0 ? (
                <StateCard
                  title={t("products.barcodeLabels.noProductsFound")}
                  subtitle={t("products.barcodeLabels.noProductsSubtitle")}
                />
              ) : (
                visibleCatalog.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    sheetMode={sheetMode}
                    selectedQuantities={selectedQuantities}
                    onQuantityChange={updateQuantity}
                  />
                ))
              )}
            </div>

            <div className="space-y-4">
              <div className="min-h-[820px] rounded-[32px] border border-white/10 bg-zinc-950 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                <div className="flex flex-col gap-4">
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-3">
                    <div className="mb-2 px-1 text-[11px] font-black uppercase tracking-[0.22em] text-emerald-300">
                      {labelTemplateFieldLabel}
                    </div>
                    <div className="rounded-[22px] border border-emerald-300/25 bg-emerald-500/10 px-4 py-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-200">
                        {SINGLE_BARCODE_TEMPLATE_LABEL}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-zinc-100/80">
                        {language === "ar"
                          ? "قالب واحد للطباعة على رول 50×100 مع محتوى Landscape."
                          : "Single print template for 50x100 roll labels with landscape content."}
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-white">طباعة QR ذكي للمنتج</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        يضيف QR لفتح المنتج من الهاتف بدون التأثير على باركود الـ SKU.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={includeSmartProductQr}
                      onClick={() => setIncludeSmartProductQr((value) => !value)}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                        includeSmartProductQr
                          ? "border-emerald-300/50 bg-emerald-500/80"
                          : "border-white/10 bg-white/10"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                          includeSmartProductQr ? "translate-x-[1.35rem]" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </label>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                    <h2 className="text-xl font-black tracking-tight text-white">{t("products.barcodeLabels.previewBeforePrint")}</h2>
                      <p className="mt-1 text-sm text-zinc-400">
                      {activeSheetLabel} · {activePaper.paperWidthMm}mm × {Math.round(activePaper.paperHeightMm)}mm
                      </p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-300">
                      {t("products.barcodeLabels.labelsCount", { count: expandedLabels.length })}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4">
                  {expandedLabels.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
                      {t("products.barcodeLabels.selectLabelFirst")}
                    </div>
                  ) : (
                    previewPages.map((pageLabels, pageIndex) => (
                      <div key={`preview-page-${pageIndex}`} className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold text-zinc-400">
                          <span>{language === "ar" ? `صفحة ${pageIndex + 1}` : `Page ${pageIndex + 1}`}</span>
                          <span>{pageLabels.length} / {expandedLabels.length}</span>
                        </div>
                        <div
                          className={`grid gap-3 ${isLandscapeTemplate ? "w-full justify-items-stretch" : isPremiumRetailTemplate ? "w-full place-items-center" : "mx-auto justify-start"}`}
                          style={{
                            width: isLandscapeTemplate || isPremiumRetailTemplate ? "100%" : `${Math.max(20, activePaper.paperWidthMm - activePrintSettings.marginLeftMm - activePrintSettings.marginRightMm)}mm`,
                            maxWidth: isLandscapeTemplate || isPremiumRetailTemplate ? "100%" : undefined,
                            gridTemplateColumns: isLandscapeTemplate
                              ? "minmax(0, 1fr)"
                              : isPremiumRetailTemplate
                                ? "minmax(0, 1fr)"
                              : `repeat(${Math.max(1, activePrintSettings.labelsPerRow)}, minmax(0, ${activePrintSettings.labelWidthMm}mm))`,
                            gap: `${activePrintSettings.gapMm}mm`,
                            paddingTop: `${activePrintSettings.marginTopMm}mm`,
                            paddingRight: `${activePrintSettings.marginRightMm}mm`,
                            paddingBottom: `${activePrintSettings.marginBottomMm}mm`,
                            paddingLeft: `${activePrintSettings.marginLeftMm}mm`,
                            minHeight: isLandscapeTemplate
                              ? "clamp(260px, 34vw, 430px)"
                              : isPremiumRetailTemplate
                                ? "clamp(720px, 82vh, 980px)"
                                : `${activePaper.paperHeightMm}mm`,
                            background: "#ffffff",
                          }}
                        >
                          {pageLabels.map((item, index) => (
                            <LabelCard
                              key={getLabelRenderKey(item, index + pageIndex * Math.max(1, activePrintSettings.labelsPerPage || pageLabels.length))}
                              item={item}
                              printSettings={activePrintSettings}
                              template={labelTemplate}
                              preview={isLandscapeTemplate || isPremiumRetailTemplate}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-6 text-zinc-400">
                  {t("products.barcodeLabels.variantImageNote")}
                </div>
              </div>
            </div>
          </div>
        </ProductsShell>
      </div>

    </>
  );
}

function ProductCard({ product, selectedQuantities, onQuantityChange, sheetMode }) {
  const { t } = useTranslation();
  const variants = Array.isArray(product.variants) && product.variants.length > 0 ? product.variants : [null];

  return (
    <article className="rounded-[28px] border border-white/10 bg-zinc-950/90 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 lg:h-32 lg:w-32 lg:flex-shrink-0">
          <ImageWithFallback src={resolveAssetUrl(resolveBarcodeLabelImage({ ...product, ...(variants[0] || {}) }))} alt={safeText(product.name, t("products.barcodeLabels.product"))} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              {safeText(product.brand, t("products.barcodeLabels.brand"))}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
              {safeText(product.category, t("products.barcodeLabels.category"))}
            </span>
          </div>

          <h3 className="mt-3 text-2xl font-black text-white">{safeText(product.name, t("products.barcodeLabels.product"))}</h3>
          <div className="mt-2 text-sm text-zinc-400">
            {t("products.barcodeLabels.variantCount", { count: variants.length })}
          </div>

          <div className="mt-4 space-y-3">
            {variants.map((variant, index) => {
              const key = getLabelIdentity(product, variant);
              const quantity = getLabelQuantity(selectedQuantities[key]);
              const imageUrl = resolveBarcodeLabelImage({ ...product, ...(variant || {}) });

              return (
                <VariantRow
                  key={[
                    product.id || "product",
                    variant?.variant_id || variant?.id || key || "variant",
                    variant?.color || "default",
                    variant?.size || "size",
                    index,
                  ].join("-")}
                  product={product}
                  variant={variant}
                  imageUrl={imageUrl}
                  quantity={quantity}
                  sheetMode={sheetMode}
                  onQuantityChange={(value) => onQuantityChange(key, value)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
}

function VariantRow({ product, variant, imageUrl, quantity, onQuantityChange, sheetMode }) {
  const { t } = useTranslation();
  const price = getLabelPriceInfo(product, variant).price;
  const safeImage = resolveAssetUrl(imageUrl);

  return (
    <div
      className={`rounded-[22px] border p-3 transition ${
        quantity > 0 ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
            <ImageWithFallback src={safeImage} alt={`${safeText(product.name, t("products.barcodeLabels.product"))} ${safeText(variant?.color, t("products.barcodeLabels.default"))}`} imageClassName="p-2" />
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {safeText(variant?.color, t("products.barcodeLabels.default"))} / {safeText(variant?.size, t("products.barcodeLabels.oneSize"))}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
              <span>SKU {safeText(variant?.sku || product.sku, "n/a")}</span>
              <span>Barcode {safeText(variant?.barcode || product.barcode, "n/a")}</span>
              <span>{formatCurrency(price)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onQuantityChange(Math.max(0, quantity - 1))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white transition hover:bg-white/10"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            min="0"
            step="1"
            value={quantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            className="w-20 rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-center text-sm font-semibold text-white outline-none"
          />
          <button
            type="button"
            onClick={() => onQuantityChange(quantity + 1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white transition hover:bg-white/10"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400 sm:grid-cols-4">
              <Chip label={t("products.barcodeLabels.image")} value={variant?.image_url || variant?.variant_image_url || variant?.color_image_url ? t("products.barcodeLabels.variant") : product.image_url ? t("products.barcodeLabels.product") : t("products.barcodeLabels.placeholder")} />
        <Chip label={t("products.barcodeLabels.color")} value={safeText(variant?.color, t("products.barcodeLabels.default"))} />
        <Chip label={t("products.barcodeLabels.size")} value={safeText(variant?.size, t("products.barcodeLabels.oneSize"))} />
        <Chip label={t("products.barcodeLabels.layout")} value={sheetMode === "thermal" ? t("products.barcodeLabels.thermal") : sheetMode === "a5" ? "A5" : sheetMode === "custom" ? "مخصص" : t("products.barcodeLabels.a4")} />
      </div>
    </div>
  );
}

function SmartQrBlock({ item, compact = false }) {
  const qrMarkup = String(item?.smartQrSvgMarkup || "").trim();
  if (!item?.showSmartProductQr || !qrMarkup) return null;
  return (
    <div className={`mt-3 flex items-center justify-center rounded-[18px] border border-zinc-200 bg-white p-3 ${compact ? "max-w-[28mm] self-center" : ""}`}>
      <div
        className={`h-auto w-full [&_svg]:h-auto [&_svg]:w-full ${compact ? "max-w-[98px]" : "max-w-[128px]"}`}
        dangerouslySetInnerHTML={{ __html: qrMarkup }}
      />
    </div>
  );
}

function LabelCard({ item, printSettings, template = LABEL_TEMPLATE_STANDARD, preview = false }) {
  if (template === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100) {
    return <ThermalLandscapeLabel item={item} printSettings={printSettings} preview={preview} />;
  }
  if (template === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100) {
    return <PremiumRetailLabel item={item} printSettings={printSettings} preview={preview} />;
  }
  const { t } = useTranslation();
  const imageUrl = resolveBarcodeLabelImage(item);
  const safeImage = getSafeLabelImage(imageUrl, item);
  const productName = safeText(item.productName, t("products.barcodeLabels.product"));
  const metaItems = [
    printSettings.showSizeColor ? { label: t("products.barcodeLabels.color"), value: item.color } : null,
    printSettings.showSizeColor ? { label: t("products.barcodeLabels.size"), value: item.size } : null,
    printSettings.showSkuArticle ? { label: t("products.barcodeLabels.sku"), value: item.sku } : null,
    printSettings.showPrice ? { label: t("products.barcodeLabels.price"), value: formatCurrency(item.salePrice) } : null,
  ].filter(Boolean);
  const barcodeSvg = useMemo(
    () =>
      getBarcodeSvg(item.barcodeValue, {
        width: Math.round(420 * (Number(printSettings.barcodeWidthScale || 100) / 100)),
        height: Number(printSettings.barcodeHeight || 88),
        displayText: item.barcode,
      }),
    [item.barcode, item.barcodeValue, printSettings.barcodeHeight, printSettings.barcodeWidthScale]
  );

  return (
    <article
      className="h-full rounded-[26px] border border-zinc-200 bg-white p-4 text-zinc-900 shadow-[0_16px_50px_rgba(15,23,42,0.08)]"
      style={{ width: `${printSettings.labelWidthMm}mm`, minHeight: `${printSettings.labelHeightMm}mm` }}
    >
      <div
        className="grid h-full gap-4"
        style={{ gridTemplateColumns: printSettings.showProductImage ? `minmax(${Math.max(18, Math.min(printSettings.labelWidthMm * 0.3, 32))}mm, ${Math.max(18, Math.min(printSettings.labelWidthMm * 0.36, 42))}mm) minmax(0,1fr)` : "minmax(0,1fr)" }}
      >
        {printSettings.showProductImage ? (
          <div className="flex items-center justify-center overflow-hidden rounded-[24px] border border-zinc-200 bg-zinc-50 p-3" style={{ minHeight: `${Math.max(24, Math.min(printSettings.labelHeightMm - 10, 54))}mm` }}>
            <ImageWithFallback src={safeImage} alt={productName} iconClassName="text-zinc-400" />
          </div>
        ) : null}

        <div className="min-w-0">
          {printSettings.showProductName ? <h3 className="font-black leading-tight text-zinc-900 text-[18px]">{productName}</h3> : null}

          {metaItems.length ? <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{metaItems.map((meta) => <Meta key={`${meta.label}-${meta.value}`} label={meta.label} value={meta.value} />)}</div> : null}

          <div className="mt-4 rounded-[20px] border border-zinc-200 bg-white p-2">
            <div dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
          </div>
          <SmartQrBlock item={item} />
        </div>
      </div>
    </article>
  );
}

function PremiumRetailLabel({ item, printSettings, print = false }) {
  const { t } = useTranslation();
  const imageUrl = resolveBarcodeLabelImage(item);
  const safeImage = getSafeLabelImage(imageUrl, item);
  const productName = safeText(item.productName, t("products.barcodeLabels.product"));
  const sizeValue = safeText(item.size, t("products.barcodeLabels.oneSize"));
  const colorValue = safeText(item.color, t("products.barcodeLabels.default"));
  const barcodeSvg = getBarcodeSvg(item.barcodeValue, {
    width: Math.round(PREMIUM_RETAIL_BARCODE_WIDTH * (Number(printSettings.barcodeWidthScale || 100) / 100)),
    height: PREMIUM_RETAIL_BARCODE_HEIGHT,
    displayText: item.barcode,
  });
  return (
    <article
      className={`relative grid overflow-hidden border border-zinc-200 bg-white text-zinc-900 ${print ? "shadow-none" : "shadow-[0_12px_30px_rgba(15,23,42,0.08)]"}`}
      data-premium-label-root="true"
      style={{
        boxSizing: "border-box",
        width: `${PREMIUM_RETAIL_LABEL_WIDTH_MM}mm`,
        height: `${PREMIUM_RETAIL_LABEL_HEIGHT_MM}mm`,
        gridTemplateRows: PREMIUM_RETAIL_GRID_ROWS,
        pageBreakInside: "avoid",
        breakInside: "avoid",
      }}
    >
      <div className="relative min-h-0 overflow-hidden border border-zinc-200 bg-zinc-50" data-premium-label-part="image">
        <ImageWithFallback
          src={safeImage}
          alt={productName}
          containerClassName="relative flex h-full w-full items-start justify-center"
          imageClassName="p-[0.35mm] pt-0 object-top"
          iconClassName="text-zinc-400"
        />
      </div>
      <div className="min-h-0 overflow-hidden border border-zinc-200 bg-zinc-50 px-[0.8mm] py-[0.55mm]" data-premium-label-part="title">
          <h3 className="line-clamp-2 text-[11px] font-black leading-[1.04] text-zinc-950">{productName}</h3>
      </div>
      <div className="min-h-0 overflow-hidden border border-zinc-200 bg-zinc-950 px-[0.75mm] py-[0.5mm] text-white" data-premium-label-part="price">
          <div className="text-[5px] font-black uppercase leading-none tracking-[0.18em] text-zinc-300">{t("products.barcodeLabels.price")}</div>
          <div className="mt-[0.25mm] truncate text-[15px] font-black leading-none">{formatCurrency(item.salePrice)}</div>
      </div>
      <div className="grid min-h-0 grid-cols-2 gap-0 overflow-hidden" data-premium-label-part="size-color">
          <div className="border border-zinc-200 bg-zinc-100 px-[0.75mm] py-[0.5mm] text-zinc-950">
            <div className="text-[5px] font-black uppercase leading-none tracking-[0.18em] text-zinc-500">{t("products.barcodeLabels.size")}</div>
            <div className="mt-[0.25mm] truncate text-[16px] font-black leading-none">{sizeValue}</div>
          </div>
          <div className="border border-zinc-200 bg-zinc-100 px-[0.75mm] py-[0.5mm] text-zinc-950">
            <div className="text-[5px] font-black uppercase leading-none tracking-[0.18em] text-zinc-500">{t("products.barcodeLabels.color")}</div>
            <div className="mt-[0.25mm] truncate text-[10px] font-black uppercase leading-none">{colorValue}</div>
          </div>
      </div>
      <div className="flex min-h-0 flex-col items-center justify-center overflow-hidden border border-zinc-200 bg-white px-[0.45mm] py-0" data-premium-label-part="barcode">
          <div className="w-[95%] max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
      </div>
      <div className="min-h-0 overflow-hidden px-[0.5mm] pt-0 text-center text-[8px] font-black leading-none text-zinc-800" data-premium-label-part="sku">
          {item.sku}
      </div>
      {item?.showSmartProductQr ? (
        <div className="absolute bottom-[8mm] right-[1mm] z-[2] w-[16mm] overflow-hidden rounded-[2.2mm] border border-zinc-200 bg-white p-[1mm]">
          <div className="[&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: item.smartQrSvgMarkup || "" }} />
        </div>
      ) : null}
    </article>
  );
}

function ThermalLandscapeLabel({ item, printSettings, print = false, preview = false }) {
  const { t } = useTranslation();
  const imageUrl = resolveBarcodeLabelImage(item);
  const safeImage = getSafeLabelImage(imageUrl, item);
  const productName = safeText(item.productName, t("products.barcodeLabels.product"));
  const sizeValue = safeText(item.size, t("products.barcodeLabels.oneSize"));
  const rawColorValue = safeText(item.color, t("products.barcodeLabels.default"));
  const colorValue = /[\u0600-\u06FF]/.test(rawColorValue) ? rawColorValue : rawColorValue.toUpperCase();
  const articleValue = safeText(item.sku, "").trim();
  const showArticleBox = Boolean(articleValue);
  const barcodeSvg = getBarcodeSvg(item.barcodeValue, {
    width: Math.round(720 * (Number(printSettings.barcodeWidthScale || 100) / 100)),
    height: Math.max(112, Number(printSettings.barcodeHeight || 88)),
    displayText: item.barcode,
  });
  const landscapeWidth = preview && !print ? "100%" : `${printSettings.labelWidthMm}mm`;
  const landscapeMinHeight = preview && !print ? "clamp(220px, 28vw, 320px)" : `${printSettings.labelHeightMm}mm`;
  const landscapeCard = (
    <article
      className="overflow-hidden border border-zinc-200 bg-white text-zinc-900 shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
      style={{ width: landscapeWidth, minHeight: landscapeMinHeight }}
    >
      <div className="flex h-full flex-col gap-[1mm] p-[1.2mm]">
        {printSettings.showProductName ? (
          <h3 className="line-clamp-2 min-h-0 text-[15px] font-black leading-[1.02] text-zinc-950">
            {productName}
          </h3>
        ) : null}

        <div
          className="grid min-h-0 flex-1 gap-[1.2mm]"
          style={{ gridTemplateColumns: printSettings.showProductImage ? "43% 57%" : "minmax(0,1fr)" }}
        >
          {printSettings.showProductImage ? (
            <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-[8px] border border-zinc-200 bg-zinc-50 p-[1.05mm]">
              <ImageWithFallback
                src={safeImage}
                alt={productName}
                imageClassName="object-contain p-[0.15mm]"
                iconClassName="text-zinc-400"
              />
            </div>
          ) : null}

          <div className="flex min-w-0 flex-col gap-[0.9mm] overflow-hidden">
            <div className="grid min-w-0 gap-[0.8mm]" style={{ gridTemplateColumns: showArticleBox ? "1fr 1fr" : "1fr" }}>
              <div className="rounded-[8px] border border-zinc-950 bg-zinc-950 px-[1.2mm] py-[0.9mm] text-center text-white">
                <div className="text-[3.6px] font-black uppercase leading-none tracking-[0.22em] text-zinc-300">
                  {t("products.barcodeLabels.size")}
                </div>
                <div className="mt-[0.35mm] text-[24px] font-black leading-none">
                  {sizeValue}
                </div>
              </div>

              {showArticleBox ? (
                <div className="rounded-[8px] border border-zinc-200 bg-zinc-100 px-[1mm] py-[0.8mm] text-center text-zinc-950">
                  <div className="text-[3.6px] font-black uppercase leading-none tracking-[0.22em] text-zinc-500">
                    {t("products.barcodeLabels.sku", "ARTICLE/SKU")}
                  </div>
                  <div className="mt-[0.35mm] truncate text-[12px] font-black leading-none">
                    {articleValue}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-[8px] border border-zinc-200 bg-zinc-100 px-[1mm] py-[0.8mm] text-center text-zinc-950">
              <div className="text-[3.6px] font-black uppercase leading-none tracking-[0.22em] text-zinc-500">
                {t("products.barcodeLabels.color")}
              </div>
              <div className="mt-[0.35mm] truncate text-[12px] font-black uppercase leading-none">
                {colorValue}
              </div>
            </div>

            {!showArticleBox ? <div className="mt-auto truncate text-center text-[11px] font-black leading-none text-zinc-800">{articleValue}</div> : null}
          </div>
        </div>

        <div className="rounded-[8px] border border-zinc-200 bg-white px-[1.2mm] pb-[0.6mm] pt-[0.8mm]">
          <div className="w-full overflow-hidden" style={{ minHeight: "14mm" }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
          <div className="mt-[0.5mm] text-center text-[8px] font-black leading-none text-zinc-800">
            {item.barcode}
          </div>
        </div>
      </div>
    </article>
  );

  if (!print) {
    return landscapeCard;
  }

  return (
    <div
      className="relative overflow-hidden bg-white"
      style={{ width: "50mm", height: "100mm", boxSizing: "border-box" }}
    >
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden"
        style={{
          width: "100mm",
          height: "50mm",
          transform: "translate(-50%, -50%) rotate(90deg)",
          transformOrigin: "center center",
          boxSizing: "border-box",
        }}
      >
        {landscapeCard}
      </div>
    </div>
  );
}

function PrintLabel({ item, printSettings, template = LABEL_TEMPLATE_STANDARD }) {
  if (template === LABEL_TEMPLATE_THERMAL_LANDSCAPE_50X100) {
    return <ThermalLandscapeLabel item={item} printSettings={printSettings} print />; 
  }
  if (template === LABEL_TEMPLATE_PREMIUM_RETAIL_50X100) {
    return <PremiumRetailLabel item={item} printSettings={printSettings} print />;
  }
  const { t } = useTranslation();
  const imageUrl = resolveBarcodeLabelImage(item);
  const safeImage = getSafeLabelImage(imageUrl, item);
  const productName = safeText(item.productName, t("products.barcodeLabels.product"));
  const metaItems = [
    printSettings.showSizeColor ? { label: t("products.barcodeLabels.color"), value: item.color } : null,
    printSettings.showSizeColor ? { label: t("products.barcodeLabels.size"), value: item.size } : null,
    printSettings.showSkuArticle ? { label: t("products.barcodeLabels.sku"), value: item.sku } : null,
    printSettings.showPrice ? { label: t("products.barcodeLabels.price"), value: formatCurrency(item.salePrice) } : null,
  ].filter(Boolean);
  const barcodeSvg = getBarcodeSvg(item.barcodeValue, {
    width: Math.round(420 * (Number(printSettings.barcodeWidthScale || 100) / 100)),
    height: Number(printSettings.barcodeHeight || 88),
    displayText: item.barcode,
  });

  return (
    <article
      className="overflow-hidden rounded-[20px] border border-zinc-200 bg-white p-3 text-zinc-900 shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
      style={{ width: `${printSettings.labelWidthMm}mm`, minHeight: `${printSettings.labelHeightMm}mm` }}
    >
      <div
        className="grid min-w-0 flex-1 gap-3"
        style={{ gridTemplateColumns: printSettings.showProductImage ? `${Math.max(18, Math.min(printSettings.labelWidthMm * 0.36, 42))}mm minmax(0,1fr)` : "minmax(0,1fr)" }}
      >
        {printSettings.showProductImage ? (
          <div className="overflow-hidden rounded-[18px] border border-zinc-200 bg-zinc-50" style={{ height: `${Math.max(24, Math.min(printSettings.labelHeightMm - 10, 54))}mm` }}>
            <ImageWithFallback src={safeImage} alt={productName} imageClassName="p-2" iconClassName="text-zinc-400" />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col">
          {printSettings.showProductName ? <h3 className="font-black leading-tight text-zinc-900 text-[18px]">{productName}</h3> : null}
          {metaItems.length ? <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{metaItems.map((meta) => <Meta key={`${meta.label}-${meta.value}`} label={meta.label} value={meta.value} />)}</div> : null}
          <div className="mt-auto rounded-[16px] border border-zinc-200 bg-white p-1">
            <div dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
          </div>
          <SmartQrBlock item={item} />
        </div>
      </div>
    </article>
  );
}

function BarcodeShopLabel({ item, print = false }) {
  const { t } = useTranslation();
  const productName = safeText(item.productName, t("products.barcodeLabels.product"));
  const qrToken = safeText(item.qrToken);
  const qrValue = safeText(item.qrValue, qrToken);
  const effectivePrice = Number(item.effectivePrice ?? item.displayPrice ?? item.salePrice ?? 0);
  const price = formatCurrency(effectivePrice);

  return (
    <article className={`w-full rounded-[28px] border border-zinc-200 bg-white p-6 text-center text-zinc-900 ${print ? "" : "shadow-[0_18px_60px_rgba(0,0,0,0.16)]"}`}>
      <h2 className="mx-auto max-w-[260px] text-2xl font-black leading-tight tracking-tight text-zinc-950">{productName}</h2>
      <div className="mx-auto mt-6 flex w-fit rounded-[30px] border border-zinc-200 bg-white p-3 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
        <QRCodeCanvas value={String(qrValue || "")} size={print ? 172 : 190} />
      </div>
      <div className="mt-6">
        <p className="text-3xl font-black leading-none tracking-tight text-zinc-950">{price}</p>
      </div>
      <div className="mt-3 truncate rounded-full bg-zinc-100 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
        {qrToken}
      </div>
      {!print && qrValue !== qrToken ? (
        <div className="mt-2 break-all rounded-2xl bg-zinc-50 px-3 py-2 text-[10px] font-semibold normal-case tracking-normal text-zinc-500">
          {qrValue}
        </div>
      ) : null}
    </article>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{safeText(label)}</div>
      <div className="mt-1 text-lg font-black text-white">{safeText(value)}</div>
    </div>
  );
}

function StateCard({ title, subtitle, action }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 text-center text-zinc-400">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl border border-white/10 bg-zinc-900 text-zinc-300">
        <Package2 className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-xl font-black text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{subtitle}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function ImageWithFallback({
  src,
  alt,
  imageClassName = "",
  iconClassName = "text-zinc-500",
  containerClassName = "relative flex h-full w-full items-center justify-center",
}) {
  return (
    <div className={containerClassName}>
      <Package2 className={`absolute ${iconClassName}`} size={24} />
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={`relative z-10 h-full w-full object-contain ${imageClassName}`}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}

function Chip({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2">
      <div className="text-[9px] tracking-[0.18em] text-zinc-500">{safeText(label)}</div>
      <div className="mt-1 truncate text-[11px] font-semibold text-white">{safeText(value)}</div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <div>{safeText(label)}</div>
      <div className="mt-1 truncate text-sm font-semibold normal-case tracking-normal text-zinc-900">{safeText(value)}</div>
    </div>
  );
}

export default BarcodeLabels;


