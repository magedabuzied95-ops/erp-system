import { displayPublicOrderNumber } from "./publicOrderNumber";
import { resolveInvoiceItemImageValue } from "../lib/invoiceItemImages";
import { formatCurrency } from "../lib/currency";
import { getCurrentTenant } from "../auth/authStorage";
import { resolveBrandImageUrl } from "../lib/imageUrls";
import { normalizeInvoicePaymentBreakdown } from "./invoicePaymentBreakdown";
import { invoiceTemplateForOutput } from "../../../shared/invoiceTemplate.js";

export { normalizeInvoicePaymentBreakdown } from "./invoicePaymentBreakdown";

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

// shipping_cost is the canonical column on orders; shipping_fee/delivery_fee are
// the older aliases that some paths still write.
const resolveShippingFee = (order = {}) =>
  toNumber(order.shipping_cost ?? order.shipping_fee ?? order.delivery_fee ?? order.totals?.shipping, 0);

// The composer stores the address in parts. Print it as one line, skipping the
// parts that were left empty.
const composeCustomerAddress = (order = {}) =>
  [
    order.street_address,
    order.building_number ? `مبنى ${order.building_number}` : "",
    order.floor_number ? `دور ${order.floor_number}` : "",
    order.apartment_number ? `شقة ${order.apartment_number}` : "",
    order.landmark,
    order.city_area,
    order.governorate,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" — ");

const resolveCollectedPaymentMethod = (order = {}) => {
  const methods = normalizeInvoicePaymentBreakdown(
    order.payment_breakdown ?? order.paymentBreakdown ?? order.payments
  ).map((payment) => payment.method);
  if (methods.length > 1) return "mixed";
  return methods[0] || firstText(order.collected_payment_method, order.actual_payment_method, order.totals?.collected_payment_method, order.payment_method, order.totals?.payment_method);
};

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
  const paidAmount = toNumber(order.paid_amount ?? order.amount_paid ?? order.total_paid ?? order.totals?.paid_amount ?? order.totals?.paid, 0);
  // A fully collected invoice has nothing outstanding — never trust a stale
  // denormalized remaining_amount over the paid/total the invoice itself carries.
  const settledInFull = grandTotal > 0 && paidAmount >= grandTotal - 0.009;
  const remainingAmount = settledInFull ? 0 : Math.max(0, toNumber(
    order.remaining_amount ?? order.remainingAmount ?? order.due_amount ?? order.totals?.remaining_amount ?? order.totals?.remaining,
    Math.max(0, grandTotal - paidAmount)
  ));
  const exchangeMode = Boolean(order.exchange_mode || order.exchangeMode || exchangeCredit > 0);
  const paymentBreakdown = normalizeInvoicePaymentBreakdown(
    order.payment_breakdown ?? order.paymentBreakdown ?? order.payments ?? order.totals?.payment_breakdown
  );

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
        options.template?.identity?.phone,
        M1_STORE_PHONE
      ),
      website: firstText(
        order.store?.website,
        order.website,
        order.company_website,
        order.companyWebsite,
        order.settings?.website,
        order.system_settings?.website,
        options.template?.identity?.website_text,
        M1_STORE_WEBSITE_TEXT
      ),
    },
    invoiceNumber: firstText(order.invoice_number, order.invoiceNumber, displayPublicOrderNumber(order), order.id, "DRAFT"),
    source: firstText(order.source, order.channel, options.source, "Website"),
    customer: {
      name: firstText(order.customer_name, order.customer?.name, options.customerName, "عميلنا العزيز"),
      phone: firstText(order.customer_phone, order.phone, order.customer?.phone, options.customerPhone),
      address: firstText(composeCustomerAddress(order), order.customer_address, order.address, order.customer?.address),
    },
    status: firstText(order.status, order.order_status, "pending"),
    paymentMethod: firstText(resolveCollectedPaymentMethod(order), options.paymentMethod, "cod"),
    paymentBreakdown,
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
      paidAmount,
      remainingAmount,
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
  // The message obeys the same template as the printed and on-screen invoice. With no
  // template resolved the defaults apply, which is every section on — the message this
  // builder has always produced.
  const tpl = invoiceTemplateForOutput(options.template || {}, "whatsapp");
  const show = tpl.fields;
  const showTotals = tpl.totals;
  const parts = tpl.outputs.whatsapp;
  const money = (value) => formatCurrency(value, invoice.currency ? { code: invoice.currency } : {});
  const lines = [
    `*${tpl.identity.store_name || invoice.store?.name || M1_STORE_NAME}*`,
    "فاتورة طلب",
    `رقم الطلب: ${invoice.invoiceNumber || "n/a"}`,
    show.show_customer_name ? `العميل: ${invoice.customer?.name || "عميلنا العزيز"}` : "",
    show.show_customer_phone && invoice.customer?.phone ? `رقم الهاتف: ${invoice.customer.phone}` : "",
    show.show_order_status ? `الحالة: ${invoice.status || "pending"}` : "",
    show.show_payment_method ? `طريقة الدفع: ${invoice.paymentMethod || "cod"}` : "",
  ].filter(Boolean);

  // No blank separator before these two blocks: the original array ran through
  // .filter(Boolean), which stripped the "" spacers it looked like it emitted. The
  // link block below did keep its blank line, because it was pushed after the filter.
  if (parts.include_items) {
    lines.push(
      "المنتجات:",
      ...invoice.items.map((item) => {
        const variant = show.show_product_variant ? [item.color, item.size].filter(Boolean).join(" / ") : "";
        return `- ${item.name}${variant ? ` (${variant})` : ""} × ${item.quantity} = ${money(item.lineTotal)}`;
      })
    );
  }

  if (parts.include_totals) {
    lines.push(
      ...[
        showTotals.show_subtotal ? `المجموع: ${money(invoice.totals?.subtotal)}` : "",
        showTotals.show_discount ? `الخصم: ${money(invoice.totals?.discount)}` : "",
        showTotals.show_shipping ? `الشحن: ${money(invoice.totals?.shipping)}` : "",
        showTotals.show_grand_total ? `الإجمالي: ${money(invoice.totals?.grandTotal)}` : "",
      ].filter(Boolean)
    );
  }

  if (parts.include_public_link && invoice.publicUrl) {
    lines.push("", "رابط الفاتورة:", invoice.publicUrl);
  }

  return lines.join("\n");
};
