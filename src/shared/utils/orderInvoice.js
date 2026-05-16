const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";

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

const resolveItemImage = (item = {}) =>
  firstText(
    item.product_image,
    item.image_url,
    item.image,
    item.variant_image_url,
    item.variant_image,
    item.thumbnail,
    item.product?.image_url,
    item.product?.image,
    item.variant?.image_url,
    item.variant?.image
  );

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
      productId: item.product_id || item.productId || null,
      variantId: item.variant_id || item.variantId || null,
      name: firstText(item.product_name, item.name, item.title, `منتج ${index + 1}`),
      color,
      size,
      quantity,
      unitPrice,
      lineTotal,
      sku: firstText(item.sku, item.barcode),
      imageUrl: resolveItemImage(item),
    };
  });

  const computedSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const subtotal = toNumber(order.subtotal ?? order.sub_total ?? order.totals?.subtotal, 0) || computedSubtotal;
  const grandTotal = total || Math.max(0, subtotal + shipping - discount);

  return {
    store: {
      name: firstText(options.storeName, order.store?.name, order.company_name, "Tiger Store"),
      logoUrl: firstText(options.logoUrl, order.store?.logo_url, order.store?.logoUrl, order.logo_url),
      phone: firstText(order.store?.phone, order.store_phone),
      website: firstText(order.store?.website, order.website),
    },
    invoiceNumber: firstText(order.invoice_number, order.invoiceNumber, order.order_number, order.id, "DRAFT"),
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
    },
    publicUrl: firstText(order.public_invoice_url, order.invoice_public_url, order.public_invoice_short_url, order.short_invoice_url, options.publicUrl),
  };
};

export const buildOrderInvoiceWhatsappText = (orderOrInvoice = {}, explicitItems = null, options = {}) => {
  const invoice = orderOrInvoice.items?.[0]?.lineTotal !== undefined
    ? orderOrInvoice
    : normalizeOrderInvoiceData(orderOrInvoice, explicitItems, options);
  const lines = [
    `*${invoice.store?.name || "Tiger Store"}*`,
    "فاتورة طلب",
    `رقم الفاتورة: ${invoice.invoiceNumber || "n/a"}`,
    `المصدر: ${invoice.source || "Website"}`,
    `العميل: ${invoice.customer?.name || "عميلنا العزيز"}`,
    invoice.customer?.phone ? `الموبايل: ${invoice.customer.phone}` : "",
    `الحالة: ${invoice.status || "pending"}`,
    `الدفع: ${invoice.paymentMethod || "cod"}`,
    "",
    "المنتجات:",
    ...invoice.items.map((item) => {
      const variant = [item.color, item.size].filter(Boolean).join(" / ");
      return `- ${item.name}${variant ? ` (${variant})` : ""} × ${item.quantity} = ${item.lineTotal.toFixed(2)} EGP`;
    }),
    "",
    `المجموع: ${Number(invoice.totals?.subtotal || 0).toFixed(2)} EGP`,
    `الخصم: ${Number(invoice.totals?.discount || 0).toFixed(2)} EGP`,
    `الشحن: ${Number(invoice.totals?.shipping || 0).toFixed(2)} EGP`,
    `الإجمالي: ${Number(invoice.totals?.grandTotal || 0).toFixed(2)} EGP`,
  ].filter(Boolean);

  if (invoice.publicUrl) {
    lines.push("", "رابط الفاتورة:", invoice.publicUrl);
  }

  return lines.join("\n");
};
