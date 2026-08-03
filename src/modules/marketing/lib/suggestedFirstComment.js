import { resolveStorefrontPriceBreakdown } from "../../../shared/lib/storefrontPricing.js";
import { publicStorefrontUrl } from "../../../shared/lib/publicStorefront.js";

const text = (value) => String(value || "").trim();
const list = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(list);
  if (typeof value === "string") {
    const clean = value.trim();
    if (!clean) return [];
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) return parsed.flatMap(list);
    } catch {
      // Plain delimited value.
    }
    return clean.split(/[,\n|]+/).map(text).filter(Boolean);
  }
  return [text(value)].filter(Boolean);
};
const unique = (...values) => Array.from(new Set(values.flatMap(list).filter(Boolean)));
const currency = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number)
    : "";
};
const discount = (originalPrice, currentPrice) => {
  const original = Number(originalPrice || 0);
  const current = Number(currentPrice || 0);
  if (!Number.isFinite(original) || !Number.isFinite(current) || original <= 0 || current <= 0 || current >= original) return "";
  return `${Math.max(1, Math.round(((original - current) / original) * 100))}%`;
};
const COLOR_NAMES = {
  black: "أسود", white: "أبيض", gray: "رمادي", grey: "رمادي", silver: "فضي", gold: "ذهبي",
  red: "أحمر", blue: "أزرق", navy: "كحلي", green: "أخضر", olive: "زيتي", yellow: "أصفر",
  orange: "برتقالي", pink: "وردي", purple: "بنفسجي", brown: "بني", beige: "بيج", nude: "نود",
  tan: "تان", maroon: "خمري", burgundy: "عنابي", cream: "كريمي", charcoal: "فحمي",
  "off white": "أوف وايت", offwhite: "أوف وايت",
};
const localizeColor = (value) => {
  const clean = text(value);
  if (!clean) return "";
  const arabic = clean.match(/[\u0600-\u06ff]+/);
  if (arabic) return arabic[0];
  const normalized = clean.toLowerCase().replace(/[(){}\[\]]/g, " ").replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();
  return COLOR_NAMES[normalized] || COLOR_NAMES[normalized.replace(/\s+/g, "")] || COLOR_NAMES[normalized.split(" ")[0]] || clean;
};
const fullUrl = (value) => {
  const clean = text(value);
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : publicStorefrontUrl(clean.startsWith("/") ? clean : `/${clean}`);
};

export const collectFirstCommentAvailability = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const activeVariants = variants.filter((variant) => {
    const quantity = Number(variant?.quantity ?? variant?.stock ?? variant?.stock_quantity ?? variant?.available_quantity ?? 0);
    return quantity > 0 || variant?.available === true || variant?.in_stock === true;
  });
  const pick = (...values) => text(values.find((value) => text(value)));
  const sizes = unique(activeVariants.map((variant) => pick(variant?.size_name, variant?.size_label, variant?.size, variant?.variant_size, variant?.size_value, variant?.label)));
  const colors = unique(activeVariants.map((variant) => localizeColor(pick(variant?.color_name, variant?.color_label, variant?.color, variant?.colour, variant?.variant_color))));
  const stockFromVariants = activeVariants.reduce((sum, variant) => {
    const quantity = Number(variant?.quantity ?? variant?.stock ?? variant?.stock_quantity ?? variant?.available_quantity ?? 0);
    return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
  return {
    sizes: sizes.length ? sizes : unique(product.available_sizes, product.sizes),
    colors: colors.length ? colors : unique(product.available_colors, product.colors, product.color_names).map(localizeColor).filter(Boolean),
    stock: stockFromVariants || Math.max(0, Number(product.stock_quantity ?? product.available_stock ?? product.stock ?? product.quantity ?? 0)),
  };
};

export const buildSuggestedFirstComment = (product = {}, options = {}) => {
  const pricing = resolveStorefrontPriceBreakdown(product);
  const availability = collectFirstCommentAvailability(product);
  const productUrl = fullUrl(product.product_url || product.url || "");
  const sku = text(product.sku || product.sku_code || product.product_sku || product.skuId || "");
  const currentPrice = Number(pricing.current_price || pricing.current || 0);
  const originalPrice = Number(pricing.old_crossed_price || pricing.original_price || pricing.original || 0);
  const hasSale = Boolean(pricing.sale_active || (currentPrice > 0 && originalPrice > currentPrice));
  const lines = [];

  if (hasSale && currentPrice > 0) {
    lines.push(`💰 السعر الآن: ${currency(currentPrice)} ج.م`);
    if (originalPrice > currentPrice) {
      lines.push(`🏷️ قبل الخصم: ${currency(originalPrice)} ج.م`);
      const percent = discount(originalPrice, currentPrice);
      if (percent) lines.push(`💸 وفر ${percent}`);
    }
    lines.push("⏳ عرض لفترة محدودة.");
  } else if (currentPrice > 0) {
    lines.push(`💰 السعر: ${currency(currentPrice)} ج.م`);
  }
  if (availability.sizes.length) lines.push("", `📏 المقاسات: ${availability.sizes.join(" • ")}`);
  if (sku) lines.push("", `🏷️ كود المنتج: ${sku}`);
  if (availability.colors.length) lines.push("", `🎨 ${availability.colors.length === 1 ? "اللون" : "الألوان"}: ${availability.colors.join(" • ")}`);
  lines.push("", availability.stock > 0 ? (availability.stock < 5 ? "⚠️ الحالة: الكمية محدودة." : "✅ الحالة: متوفر الآن.") : "❌ الحالة: غير متوفر حالياً.");
  if (options.includeShipping !== false) lines.push("", "🚚 الشحن: شحن لجميع المحافظات");
  if (options.includeLocation !== false) lines.push("", "📍 الموقع: دمياط الجديدة");
  lines.push("", "💬 للحجز: للحجز أو الاستفسار ابعتلنا رسالة.");
  if (productUrl) lines.push("", "🛒 اطلب الآن:", productUrl);

  return lines.map((line) => text(line)).filter((line, index, array) => line !== "" || array[index - 1] !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
