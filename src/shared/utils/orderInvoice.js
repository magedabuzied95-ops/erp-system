import { displayPublicOrderNumber } from "./publicOrderNumber";
import { resolveInvoiceItemImageValue } from "../lib/invoiceItemImages";
import { formatCurrency } from "../lib/currency";
import { getCurrentTenant } from "../auth/authStorage";
import { resolveBrandImageUrl } from "../lib/imageUrls";

const M1_STORE_NAME = "M1 Store";
const M1_STORE_WEBSITE_TEXT = "Www.m1store-egy.com";
const M1_STORE_PHONE = "01000659301";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";

const getTenantBranding = () => {
  const tenant = getCurrentTenant() || {};
  const settings = tenant.settings || {};
  return {
    name: firstText(
      settings["general.company_name"],
      settings["storefront.store_name"],
      M1_STORE_NAME
    ),
    logoUrl: firstText(
      settings["general.company_logo_url"],
      settings["storefront.store_logo_url"],
      ""
    ),
  };
};

const resolveStoreBrandLogoUrl = (order = {}, options = {}) => {
  const tenant = getCurrentTenant() || {};
  const tenantBranding = getTenantBranding();
  const candidates = [
    options.logoUrl,
    tenantBranding.logoUrl,
    order.store?.logoUrl,
    order.store?.logo_url,
    order.logoUrl,
    order.logo_url,
    order.company_logo_url,
    order.companyLogoUrl,
    order.settings?.logoUrl,
    order.settings?.logo_url,
    order.system_settings?.logoUrl,
    order.system_settings?.logo_url,
    order.tenant?.logoUrl,
    order.tenant?.logo_url,
    tenant.companyLogoUrl,
    tenant.company_logo_url,
    tenant.logoUrl,
    tenant.logo_url,
    tenant.settings?.logoUrl,
    tenant.settings?.logo_url,
  ];
  return resolveBrandImageUrl(candidates.map((value) => String(value || "").trim()).find(Boolean) || "");
};

const resolveStoreBrandName = (order = {}, options = {}) => {
  const tenantBranding = getTenantBranding();
  const candidates = [
    options.storeName,
    tenantBranding.name,
    order.store?.name,
    order.company_name,
    order.tenant_name,
    order.tenantName,
    order.companyName,
    order.storeName,
    M1_STORE_NAME,
  ];
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || M1_STORE_NAME;
};

const resolveOrderTotal = (order = {}) =>
  toNumber(
    order.total_amount ??
      order.total_price ??
      order.total ??
      order.grand_total ??
      order.totals?.total,
    0
  );

const resolveShippingFee = (order = {}) =>
  toNumber(order.shipping_fee ?? order.delivery_fee ?? order.service_fee ?? order.totals?.shipping ?? order.totals?.service, 0);

const resolveDiscount = (order = {}) =>
  toNumber(order.discount_amount ?? order.invoice_discount ?? order.discount ?? order.totals?.discount, 0);

const resolveRawItems = (order = {}, explicitItems = null) => {
  if (Array.isArray(explicitItems)) return explicitItems;
  if (Array.isArray(order.items)) return order.items;
  if (Array.isArray(order.order_items)) return order.order_items;
  if (Array.isArray(order.lines)) return order.lines;
  return [];
};

export const resolveInvoiceItemPrice = (item = {}, quantity = 1, fallbackLineTotal = 0) => {
  const directPrice = toNumber(item.unit_price ?? item.price ?? item.sale_price ?? item.selling_price ?? item.final_price, 0);
  if (directPrice > 0) return directPrice;

  const lineTotal = toNumber(item.total_amount ?? item.line_total ?? item.total, 0);
  if (lineTotal > 0 && quantity > 0) return lineTotal / quantity;

  if (fallbackLineTotal > 0 && quantity > 0) return fallbackLineTotal / quantity;
  return 0;
};

export const normalizeOrderInvoiceData = (order = {}, explicitItems = null, options = {}) => {
  const rawItems = resolveRawItems(order, explicitItems);
  const discount = resolveDiscount(order);
  const shipping = resolveShippingFee(order);
  const total = resolveOrderTotal(order);
  const itemQuantitySum = rawItems.reduce((sum, item) => sum + Math.max(1, toNumber(item.quantity, 1)), 0) || 1;
  const fallbackItemsTotal = Math.max(0, total - shipping + discount);
  const hasAnyLinePrice = rawItems.some((item) => {
    const quantity = Math.max(1, toNumber(item.quantity, 1));
    return resolveInvoiceItemPrice(item, quantity, 0) > 0 || toNumber(item.total_amount ?? item.line_total ?? item.total, 0) > 0;
  });

  const items = rawItems.map((item, index) => {
    const quantity = Math.max(1, toNumber(item.quantity, 1));
    const fallbackLineTotal = hasAnyLinePrice ? 0 : (fallbackItemsTotal * quantity) / itemQuantitySum;
    const unitPrice = resolveInvoiceItemPrice(item, quantity, fallbackLineTotal);
    const lineTotal = toNumber(item.total_amount ?? item.line_total ?? item.total, 0) || unitPrice * quantity;
    const color = firstText(item.color, item.color_name, item.variant?.color);
    const size = firstText(item.size, item.size_name, item.variant?.size);

    return {
      id: item.id || item.order_item_id || `${item.product_id || "item"}-${item.variant_id || index}`,
      rawItem: item,
      productId: item.product_id || item.productId || null,
      variantId: item.variant_id || item.variantId || null,
      product_id: item.product_id || item.productId || null,
      variant_id: item.variant_id || item.variantId || null,
      name: firstText(item.product_name, item.name, item.title, `منتج ${index + 1}`),
      color,
      size,
      quantity,
      unitPrice,
      lineTotal,
      sku: firstText(item.sku, item.barcode),
      image_url: item.image_url || item.imageUrl || "",
      product_image: item.product_image || item.productImage || "",
      variant_image: item.variant_image || item.variantImage || "",
      product: item.product || null,
      variant: item.variant || item.product_variant || null,
      imageUrl: resolveInvoiceItemImageValue(item),
    };
  });

  const computedSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const subtotal = toNumber(order.subtotal ?? order.sub_total ?? order.totals?.subtotal, 0) || computedSubtotal;
  const grandTotal = total || Math.max(0, subtotal + shipping - discount);
  const exchangeCredit = toNumber(order.exchange_credit_amount ?? order.exchangeCreditAmount ?? order.totals?.exchange_credit, 0);
  const newItemsTotal = toNumber(order.new_order_total ?? order.newOrderTotal ?? order.totals?.new_items_total, 0) || grandTotal;
  const amountPaidNow = toNumber(order.amount_due_now ?? order.amountDueNow ?? order.totals?.amount_paid_now ?? order.paid_amount, 0);
  const exchangeMode = Boolean(order.exchange_mode || order.exchangeMode || exchangeCredit > 0);

  return {
    store: {
      name: resolveStoreBrandName(order, options),
      logoUrl: firstText(
        resolveStoreBrandLogoUrl(order, options),
        ""
      ),
      phone: firstText(
        order.store?.phone,
        order.store_phone,
        order.company_phone,
        order.companyPhone,
        order.settings?.phone,
        order.system_settings?.phone,
        M1_STORE_PHONE
      ),
      website: firstText(
        order.store?.website,
        order.website,
        order.company_website,
        order.companyWebsite,
        order.settings?.website,
        order.system_settings?.website,
        M1_STORE_WEBSITE_TEXT
      ),
    },
    invoiceNumber: firstText(order.invoice_number, order.invoiceNumber, displayPublicOrderNumber(order), order.id, "DRAFT"),
    source: firstText(order.source, order.channel, options.source, "Website"),
    customer: {
      name: firstText(order.customer_name, order.customer?.name, options.customerName, "عميلنا العزيز"),
      phone: firstText(order.customer_phone, order.phone, order.customer?.phone, options.customerPhone),
      address: firstText(order.customer_address, order.address, order.customer?.address),
    },
    status: firstText(order.status, order.order_status, "pending"),
    paymentMethod: firstText(order.payment_method, order.totals?.payment_method, options.paymentMethod, "cod"),
    paymentStatus: firstText(order.payment_status, order.paymentStatus, "pending"),
    createdAt: firstText(order.created_at, order.order_date, order.date, new Date().toISOString()),
    items,
    totals: {
      subtotal,
      discount,
      shipping,
      grandTotal,
      exchangeMode,
      exchangeInvoiceNumber: firstText(order.exchange_invoice_number, order.exchangeInvoiceNumber, order.totals?.exchange_invoice_number),
      exchangeCredit,
      newItemsTotal,
      amountPaidNow,
      remainingCustomerCredit: Math.max(0, exchangeCredit - newItemsTotal),
    },
    currency: firstText(options.currency, order.currency, order.currency_code, order.store?.currency),
    publicUrl: firstText(order.public_invoice_url, order.invoice_public_url, order.public_invoice_short_url, order.short_invoice_url, options.publicUrl),
  };
};

export const buildOrderInvoiceWhatsappText = (orderOrInvoice = {}, explicitItems = null, options = {}) => {
  const invoice = orderOrInvoice.items?.[0]?.lineTotal !== undefined
    ? orderOrInvoice
    : normalizeOrderInvoiceData(orderOrInvoice, explicitItems, options);
  const money = (value) => formatCurrency(value, invoice.currency ? { code: invoice.currency } : {});
  const lines = [
    `*${invoice.store?.name || M1_STORE_NAME}*`,
    "فاتورة طلب",
    `رقم الطلب: ${invoice.invoiceNumber || "n/a"}`,
    `العميل: ${invoice.customer?.name || "عميلنا العزيز"}`,
    invoice.customer?.phone ? `رقم الهاتف: ${invoice.customer.phone}` : "",
    `الحالة: ${invoice.status || "pending"}`,
    `طريقة الدفع: ${invoice.paymentMethod || "cod"}`,
    "",
    "المنتجات:",
    ...invoice.items.map((item) => {
      const variant = [item.color, item.size].filter(Boolean).join(" / ");
      return `- ${item.name}${variant ? ` (${variant})` : ""} × ${item.quantity} = ${money(item.lineTotal)}`;
    }),
    "",
    `المجموع: ${money(invoice.totals?.subtotal)}`,
    `الخصم: ${money(invoice.totals?.discount)}`,
    `الشحن: ${money(invoice.totals?.shipping)}`,
    `الإجمالي: ${money(invoice.totals?.grandTotal)}`,
  ].filter(Boolean);

  if (invoice.publicUrl) {
    lines.push("", "رابط الفاتورة:", invoice.publicUrl);
  }

  return lines.join("\n");
};
