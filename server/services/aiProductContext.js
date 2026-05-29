const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value = "") => String(value ?? "").trim();
const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const splitSizes = (value) => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(",")
    .map(text)
    .filter(Boolean);
};

const trimSlashes = (value = "") => text(value).replace(/^\/+|\/+$/g, "");

const storeBaseUrl = () =>
  text(process.env.STORE_FRONT_URL || process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");

const firstImageValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return text(value);
  if (typeof value === "object") {
    return text(value.secure_url || value.image_url || value.url || value.path || value.image || "");
  }
  return "";
};

const resolvePublicUrl = (value = "", { baseUrl = storeBaseUrl(), uploads = false } = {}) => {
  const raw = firstImageValue(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!baseUrl) return "";
  const path = trimSlashes(raw);
  if (!path) return "";
  if (uploads && !path.startsWith("uploads/") && !path.startsWith("shop/")) {
    return `${baseUrl}/uploads/products/${path}`;
  }
  return `${baseUrl}/${path}`;
};

const productIdentifier = (product = {}) =>
  text(product.slug || product.canonical_slug || product.id || product.product_id);

const productImageUrl = (product = {}) => {
  const images = asArray(product.images || product.product_images || product.gallery_images);
  return resolvePublicUrl(
    product.secure_url ||
      product.imageUrl ||
      product.image_url ||
      product.main_image ||
      product.thumbnail ||
      product.product_image_url ||
      product.variant_image_url ||
      images.map(firstImageValue).find(Boolean),
    { uploads: true }
  );
};

const productUrl = (product = {}) => {
  const baseUrl = storeBaseUrl();
  const existing = text(product.productUrl || product.product_url);
  if (/^https?:\/\//i.test(existing)) return existing;
  if (existing && baseUrl) return `${baseUrl}/${trimSlashes(existing)}`;
  const identifier = productIdentifier(product);
  if (!baseUrl || !identifier) return "";
  return `${baseUrl}/shop/product/${encodeURIComponent(identifier)}`;
};

export function buildProductContext(product) {
  if (!product) return null;

  const stockQuantity = numberValue(product.stock_quantity ?? product.total_stock ?? product.stock ?? product.available_stock);
  const sizes = [
    ...splitSizes(product.sizes),
    ...splitSizes(product.size),
    ...asArray(product.variants).flatMap((variant) => splitSizes(variant?.size)),
  ].filter((item, index, items) => item && items.indexOf(item) === index);

  return {
    id: product.id || product.product_id,
    slug: text(product.slug || product.canonical_slug),
    name: product.name || product.title || product.product_name,
    brand: product.brand || product.brand_name || product.manufacturer || product.manufacturer_name || "",
    model: product.model || product.product_model || product.edition_name || product.sku || "",
    price: product.price || product.final_price || product.selling_price || product.regular_price || product.product_price,
    salePrice: product.sale_price || product.salePrice,
    imageUrl: productImageUrl(product),
    productUrl: productUrl(product),
    inStock:
      product.in_stock ??
      product.is_in_stock ??
      (stockQuantity > 0 || String(product.availability || product.stock_state || "").toLowerCase() === "available"),
    sizes,
  };
}

export function ensureProductLinkInReply(reply = "", productContext = null) {
  const productUrl = text(productContext?.productUrl || productContext?.product_url);
  const safeReply = text(reply);
  if (!safeReply || !productUrl || safeReply.includes(productUrl)) return safeReply;
  const lines = safeReply.split("\n").map(text).filter(Boolean);
  const lastLine = lines.at(-1) || "";
  const linkLines = ["شوفه من هنا:", productUrl];
  if (/[?؟]$|طں$/.test(lastLine) && lines.length > 1) {
    return [...lines.slice(0, -1), ...linkLines, lastLine].join("\n");
  }
  return [...lines, ...linkLines].join("\n");
}
