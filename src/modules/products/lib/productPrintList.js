const STORAGE_KEY = "m1.product-print-list.v1";

const text = (value) => String(value ?? "").trim();

export const readProductPrintList = () => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeProductPrintList = (products = []) => {
  const normalized = Array.isArray(products) ? products.filter((product) => product?.id) : [];
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new Event("product-print-list:changed"));
  }
  return normalized;
};

export const addProductsToPrintList = (products = []) => {
  const byId = new Map(readProductPrintList().map((product) => [String(product.id), product]));
  for (const product of Array.isArray(products) ? products : []) {
    if (!product?.id) continue;
    byId.set(String(product.id), {
      ...product,
      variants: Array.isArray(product.variants) ? product.variants : [],
      added_to_print_list_at: new Date().toISOString(),
    });
  }
  return writeProductPrintList([...byId.values()]);
};

export const removeProductFromPrintList = (productId) =>
  writeProductPrintList(readProductPrintList().filter((product) => String(product.id) !== String(productId)));

export const clearProductPrintList = () => writeProductPrintList([]);

export const printListSection = (product = {}) => {
  const value = text(product.product_type || product.type || product.category).toLowerCase();
  if (/bag|bags|handbag|شنط|حقيبة/.test(value)) return "bags";
  if (/crocs|croc/.test(value)) return "crocs";
  if (/slipper|slippers|slide|slides|شبشب|سليبر/.test(value)) return "slippers";
  return "sneakers";
};

export const productPrintAudiences = (product = {}) => {
  const values = [
    ...(Array.isArray(product.audiences) ? product.audiences : []),
    product.gender,
    ...(Array.isArray(product.variants) ? product.variants.flatMap((variant) => String(variant.audience || "").split(",")) : []),
  ].map((value) => text(value).toLowerCase());
  const audiences = [];
  if (values.some((value) => ["men", "man", "male"].includes(value))) audiences.push("men");
  if (values.some((value) => ["women", "woman", "female"].includes(value))) audiences.push("women");
  if (values.some((value) => ["kids", "kid", "children"].includes(value))) audiences.push("kids");
  return audiences.length ? audiences : ["men"];
};

export const productPrintAudience = (product = {}) => productPrintAudiences(product)[0];
