import { mergeProductRecord } from "../../products/lib/catalog";
import { formatCurrency } from "../../../shared/lib/currency";
import { formatLocalizedNumber } from "../../../shared/lib/locale";
export { formatCurrency };
import {
  buildInvoiceMessageTemplate,
  buildOrderStatusMessageTemplate,
  buildWhatsappDeepLink,
  formatWhatsappPhone,
  isValidWhatsappPhone,
  normalizePhoneNumber,
} from "../../../shared/utils/whatsapp.js";
import { safeSetLocalStorage, safeSetSessionStorage } from "../../../utils/safeStorage";

const CART_STORAGE_KEY = "erp.pos.cart";
const STATE_STORAGE_KEY = "erp.pos.state";
const SESSION_STORAGE_KEY = "erp.pos.session";
const CUSTOMER_STATE_KEYS = new Set(["customerSearch", "selectedCustomerId", "customerId", "selectedCustomer"]);

const omitCustomerState = (state = {}) =>
  Object.fromEntries(
    Object.entries(state || {}).filter(([key]) => !CUSTOMER_STATE_KEYS.has(key))
  );

export const formatNumber = (value, language = "") => formatLocalizedNumber(value, language);

export const generateInvoiceNumber = () => {
  return "INV-PENDING";
};

export const readPosPersistedState = () => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    return raw ? omitCustomerState(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
};

export const writePosPersistedState = (state) => {
  if (typeof window === "undefined") return;
  safeSetLocalStorage(STATE_STORAGE_KEY, omitCustomerState(state), { maxBytes: 48 * 1024 });
};

export const readPosCart = () => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY) || window.sessionStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const writePosCart = (cart) => {
  if (typeof window === "undefined") return;
  const trimCart = (items = []) => (Array.isArray(items) ? items.slice(-50) : []);
  safeSetLocalStorage(CART_STORAGE_KEY, cart, { maxBytes: 96 * 1024, trim: trimCart });
  safeSetSessionStorage(CART_STORAGE_KEY, cart, { maxBytes: 96 * 1024, trim: trimCart });
};

export const readPosSession = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY) || window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const writePosSession = (session) => {
  if (typeof window === "undefined") return;
  const nextSession = { ...(session || {}), updatedAt: new Date().toISOString() };
  safeSetLocalStorage(SESSION_STORAGE_KEY, nextSession, { maxBytes: 32 * 1024 });
  safeSetSessionStorage(SESSION_STORAGE_KEY, nextSession, { maxBytes: 32 * 1024 });
};

export const clearPosPersistedState = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CART_STORAGE_KEY);
  window.localStorage.removeItem(STATE_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(CART_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
};

export const groupProductCatalog = (productsResponse, variantsResponse) => {
  const baseProducts = Array.isArray(productsResponse?.products)
    ? productsResponse.products
    : [];
  const variantRows = Array.isArray(variantsResponse?.products)
    ? variantsResponse.products
    : [];

  const groupedVariants = variantRows.reduce((acc, row) => {
    const id = String(row.id);
    if (!acc[id]) acc[id] = [];
    if (row.variant_id) {
      acc[id].push({
        ...row,
        variant_id: row.variant_id,
      });
    }
    return acc;
  }, {});

  return baseProducts.map((product) => {
    const variants = groupedVariants[String(product.id)] || [];
    const primaryVariant = variants[0] || null;
    const merged = mergeProductRecord(product, primaryVariant);

    return {
      ...merged,
      variants: variants.map((variant) => ({
        ...variant,
        variant_id: variant.variant_id ?? variant.id,
        price: Number(variant.price || merged.sale_price || 0),
        stock: Number(variant.stock || 0),
      })),
    };
  });
};

export const pickFirstVariant = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length > 0) return variants[0];

  if (String(product?.variation_mode || "").trim().toLowerCase() === "simple") {
    return {
      variant_id: null,
      product_id: product?.product_id ?? product?.id ?? null,
      name: product?.name || "",
      product_name: product?.product_name || product?.name || "",
      color: "",
      size: "",
      sku: product?.sku || "",
      barcode: product?.barcode || "",
      image_url: product?.image_url || product?.product_image_url || "",
      product_image_url: product?.product_image_url || product?.image_url || "",
      variant_image_url: "",
      price: Number(product?.sale_price ?? product?.price ?? 0),
      sale_price: Number(product?.sale_price ?? product?.price ?? 0),
      stock: Number(product?.stock || 0),
    };
  }

  return null;
};

export const findVariant = (product, color, size) => {
  if (!product) return null;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (String(product?.variation_mode || "").trim().toLowerCase() === "simple") {
    return pickFirstVariant(product);
  }

  const exact = variants.find(
    (variant) =>
      String(variant.color || "").toLowerCase() === String(color || "").toLowerCase() &&
      String(variant.size || "").toLowerCase() === String(size || "").toLowerCase()
  );

  if (exact) return exact;

  const byColor = variants.find(
    (variant) => String(variant.color || "").toLowerCase() === String(color || "").toLowerCase()
  );

  if (byColor) return byColor;

  const bySize = variants.find(
    (variant) => String(variant.size || "").toLowerCase() === String(size || "").toLowerCase()
  );

  return bySize || variants[0] || null;
};

export const calcTotals = ({
  cart,
  invoiceDiscount = 0,
  serviceFee = 0,
  loyaltyDiscount = 0,
  couponDiscount = 0,
}) => {
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  );

  const itemDiscountTotal = cart.reduce(
    (sum, item) =>
      sum + Number(item.lineDiscount || 0) * Number(item.quantity || 0),
    0
  );

  const baseAfterItemDiscount = Math.max(0, subtotal - itemDiscountTotal);
  const invoiceDiscountValue = Math.min(Math.max(0, Number(invoiceDiscount || 0)), Math.max(0, subtotal));
  const afterInvoiceDiscount = Math.max(
    0,
    baseAfterItemDiscount - invoiceDiscountValue
  );
  const taxableBase = Math.max(0, afterInvoiceDiscount + Number(serviceFee || 0));
  const taxAmount = 0;
  const preLoyaltyTotal = taxableBase;
  const loyaltyDiscountValue = Math.max(0, Number(loyaltyDiscount || 0));
  const couponDiscountValue = Math.max(0, Number(couponDiscount || 0));
  const total = Math.max(0, preLoyaltyTotal - loyaltyDiscountValue - couponDiscountValue);

  return {
    subtotal,
    itemDiscountTotal,
    invoiceDiscount: invoiceDiscountValue,
    serviceFee: Number(serviceFee || 0),
    taxableBase,
    taxAmount,
    loyaltyDiscount: loyaltyDiscountValue,
    couponDiscount: couponDiscountValue,
    preLoyaltyTotal,
    total,
  };
};

export const derivePaymentSummary = ({
  total,
  paymentMode,
  cashAmount = 0,
  cardAmount = 0,
  walletAmount = 0,
  vodafoneCashAmount = 0,
  customerWalletAmount = 0,
}) => {
  const normalizedMode = String(paymentMode || "").toLowerCase();
  if (normalizedMode === "personal" || normalizedMode === "credit_sale") {
    const totalAmount = Math.max(0, Number(total || 0));
    return {
      paidAmount: normalizedMode === "credit_sale" ? 0 : totalAmount,
      changeAmount: 0,
      dueAmount: totalAmount,
      paymentStatus: normalizedMode === "credit_sale" ? "Pending" : totalAmount > 0 ? "Paid" : "Pending",
      walletAmount: 0,
      vodafoneCashAmount: 0,
      customerWalletAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      remainingCashOrCard: totalAmount,
    };
  }
  const rawPaidAmount =
    paymentMode === "split"
      ? Number(cashAmount || 0) + Number(cardAmount || 0) + Number(walletAmount || 0) + Number(vodafoneCashAmount || 0) + Number(customerWalletAmount || 0)
      : paymentMode === "customer_wallet"
        ? Number(customerWalletAmount || 0)
        : Number(cashAmount || cardAmount || walletAmount || vodafoneCashAmount || 0);
  const paidAmount = Math.min(Math.max(0, rawPaidAmount), Math.max(0, Number(total || 0)));

  const changeAmount = 0;
  const dueAmount = Math.max(0, Number(total || 0) - paidAmount);

  let paymentStatus = "Pending";
  if (Number(total || 0) <= 0 || (paidAmount >= Number(total || 0) && Number(total || 0) > 0)) {
    paymentStatus = "Paid";
  } else if (paidAmount > 0) {
    paymentStatus = "Partial";
  }

  return {
    paidAmount,
    changeAmount,
    dueAmount,
    paymentStatus,
    walletAmount: Number(walletAmount || 0),
    vodafoneCashAmount: Number(vodafoneCashAmount || 0),
    customerWalletAmount: Number(customerWalletAmount || 0),
    cashAmount: Number(cashAmount || 0),
    cardAmount: Number(cardAmount || 0),
    remainingCashOrCard: Math.max(0, Number(total || 0) - Number(walletAmount || 0) - Number(vodafoneCashAmount || 0) - Number(customerWalletAmount || 0)),
  };
};

export { normalizePhoneNumber, formatWhatsappPhone, isValidWhatsappPhone };

export const buildWhatsAppMessage = ({
  invoiceNumber,
  customerName,
  total,
  paymentStatus,
  cart,
  companyName,
}) =>
  encodeURIComponent(
    buildInvoiceMessageTemplate({
      invoiceNumber,
      customerName,
      total: formatCurrency(total),
      paymentStatus,
      items: cart,
      companyName,
    })
  );

export const buildWhatsAppInvoiceLink = ({ phone, invoiceNumber, customerName, total, paymentStatus, cart, companyName, invoiceUrl = "" }) =>
  buildWhatsappDeepLink({
    phone,
    message: buildInvoiceMessageTemplate({
      invoice: {
        store: { name: companyName || "ERP Store" },
        invoiceNumber,
        source: "POS",
        customer: { name: customerName },
        status: paymentStatus,
        paymentMethod: paymentStatus,
        paymentStatus,
        items: (cart || []).map((item, index) => ({
          id: item.id || index,
          name: item.product_name || item.name,
          color: item.color,
          size: item.size,
          quantity: Number(item.quantity || 1),
          unitPrice: Number(item.unit_price ?? item.price ?? item.sale_price ?? 0),
          lineTotal: Number(item.total_amount ?? item.line_total ?? item.total ?? 0) || Number(item.unit_price ?? item.price ?? item.sale_price ?? 0) * Number(item.quantity || 1),
          imageUrl: item.product_image || item.image_url || item.image,
        })),
        totals: {
          subtotal: (cart || []).reduce((sum, item) => sum + (Number(item.total_amount ?? item.line_total ?? item.total ?? 0) || Number(item.unit_price ?? item.price ?? item.sale_price ?? 0) * Number(item.quantity || 1)), 0),
          discount: 0,
          shipping: 0,
          grandTotal: Number(total || 0),
        },
        publicUrl: invoiceUrl,
      },
      invoiceNumber,
      customerName,
      total: formatCurrency(total),
      paymentStatus,
      items: cart,
      companyName,
      invoiceUrl,
    }),
  });

export const buildWhatsAppOrderStatusLink = ({
  phone,
  invoiceNumber,
  customerName,
  status,
  paymentStatus,
  trackingNumber,
  deliveryStatus,
  total,
  companyName,
}) =>
  buildWhatsappDeepLink({
    phone,
    message: buildOrderStatusMessageTemplate({
      invoiceNumber,
      customerName,
      status,
      paymentStatus,
      trackingNumber,
      deliveryStatus,
      total: formatCurrency(total),
      companyName,
    }),
  });

export const mergeCartItem = (existingItem, nextItem) => ({
  ...existingItem,
  ...nextItem,
  quantity: Number(existingItem.quantity || 0) + Number(nextItem.quantity || 0),
  lineDiscount: Number(nextItem.lineDiscount ?? existingItem.lineDiscount ?? 0),
});
