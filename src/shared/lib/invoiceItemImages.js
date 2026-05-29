import { resolveProductImageUrl } from "./imageUrls";

export const DEFAULT_PRODUCT_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='18' fill='%23f1f5f9'/%3E%3Cpath d='M26 34.5 48 22l22 12.5v27L48 74 26 61.5v-27Z' fill='%23e2e8f0' stroke='%2394a3b8' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='m26 35 22 12.5L70 35M48 47.5V74' fill='none' stroke='%2394a3b8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const unwrapImageValue = (value) => {
  if (!value) return "";
  if (Array.isArray(value)) return unwrapImageValue(value[0]);
  if (typeof value === "object") {
    return (
      value.image ||
      value.image_url ||
      value.url ||
      value.path ||
      value.src ||
      value.secure_url ||
      ""
    );
  }
  return value;
};

export const resolveInvoiceItemImageValue = (item = {}) => {
  const variant = item.variant || item.product_variant || {};
  const product = item.product || {};

  const candidates = [
    variant.image,
    variant.image_url,
    variant.images?.[0],
    item.variant_image,
    item.variant_image_url,
    item.product_variant_image,
    item.product_variant_image_url,
    item.variant_images?.[0],
    item.color?.image,
    item.color?.image_url,
    item.color_image_url,
    product.image,
    product.image_url,
    product.images?.[0],
    item.product_image,
    item.product_image_url,
    item.product_images?.[0],
    item.imageUrl,
    item.image,
    item.image_url,
    item.images?.[0],
    product.thumbnail,
    product.thumbnail_url,
    item.thumbnail,
    item.thumbnail_url,
    item.cover_image,
    product.cover_image,
    item.gallery?.[0],
    product.gallery?.[0],
  ];

  return candidates.map(unwrapImageValue).find(Boolean) || "";
};

export const resolveInvoiceItemImageUrl = (item = {}, fallback = DEFAULT_PRODUCT_PLACEHOLDER) =>
  resolveProductImageUrl(resolveInvoiceItemImageValue(item)) || fallback;
