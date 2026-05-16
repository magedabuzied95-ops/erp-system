const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";

export const normalizeOrderInvoiceData = (order = {}, explicitItems = [], options = {}) => {
  const rawItems = Array.isArray(explicitItems) && explicitItems.length
    ? explicitItems
    : Array.isArray(order.items)
      ? order.items
      : Array.isArray(order.order_items)
        ? order.order_items
        : [];
  const shipping = toNumber(order.shipping_fee ?? order.delivery_fee ?? order.service_fee ?? order.totals?.shipping ?? order.totals?.service, 0);
  const discount = toNumber(order.discount_amount ?? order.invoice_discount ?? order.discount ?? order.totals?.discount, 0);
  const total = toNumber(order.total_amount ?? order.total_price ?? order.total ?? order.grand_total ?? order.totals?.total, 0);
  const fallbackSubtotal = Math.max(0, total - shipping + discount);
  const quantitySum = rawItems.reduce((sum, item) => sum + Math.max(1, toNumber(item.quantity, 1)), 0) || 1;
  const hasPricedLine = rawItems.some((item) => toNumber(item.unit_price ?? item.price ?? item.sale_price, 0) > 0 || toNumber(item.total_amount ?? item.line_total ?? item.total, 0) > 0);

  const items = rawItems.map((item, index) => {
    const quantity = Math.max(1, toNumber(item.quantity, 1));
    const fallbackLine = hasPricedLine ? 0 : (fallbackSubtotal * quantity) / quantitySum;
    const lineTotal = toNumber(item.total_amount ?? item.line_total ?? item.total, 0) || fallbackLine;
    const unitPrice = toNumber(item.unit_price ?? item.price ?? item.sale_price, 0) || (lineTotal > 0 ? lineTotal / quantity : 0);
    return {
      id: item.id || `${item.product_id || "item"}-${item.variant_id || index}`,
      name: firstText(item.product_name, item.name, item.title, `Item ${index + 1}`),
      color: firstText(item.color, item.color_name),
      size: firstText(item.size, item.size_name),
      quantity,
      unitPrice,
      lineTotal: lineTotal || unitPrice * quantity,
      imageUrl: firstText(item.product_image, item.image_url, item.image, item.variant_image_url),
    };
  });
  const subtotal = toNumber(order.subtotal ?? order.sub_total ?? order.totals?.subtotal, 0) || items.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    store: { name: firstText(options.storeName, order.store?.name, order.company_name, "ERP Store") },
    invoiceNumber: firstText(order.invoice_number, order.invoiceNumber, order.order_number, order.id, "n/a"),
    source: firstText(order.source, order.channel, options.source, "Website"),
    customer: {
      name: firstText(order.customer_name, order.customer?.name, options.customerName, "Walk-in Customer"),
      phone: firstText(order.customer_phone, order.phone, order.customer?.phone, options.customerPhone),
    },
    status: firstText(order.status, order.order_status, "Pending"),
    paymentMethod: firstText(order.payment_method, options.paymentMethod, "cod"),
    paymentStatus: firstText(order.payment_status, order.paymentStatus, "Pending"),
    items,
    totals: { subtotal, discount, shipping, grandTotal: total || Math.max(0, subtotal + shipping - discount) },
    publicUrl: firstText(order.public_invoice_url, order.invoice_public_url, options.publicUrl),
  };
};

export const buildOrderInvoiceWhatsappText = (invoice) => [
  `*${invoice.store?.name || "ERP Store"}*`,
  "Invoice",
  `Invoice: ${invoice.invoiceNumber || "n/a"}`,
  `Source: ${invoice.source || "Website"}`,
  `Customer: ${invoice.customer?.name || "Walk-in Customer"}`,
  invoice.customer?.phone ? `Phone: ${invoice.customer.phone}` : "",
  `Status: ${invoice.status || "Pending"}`,
  `Payment: ${invoice.paymentMethod || invoice.paymentStatus || "Pending"}`,
  "",
  "Items:",
  ...invoice.items.map((item) => {
    const variant = [item.color, item.size].filter(Boolean).join(" / ");
    return `- ${item.name}${variant ? ` (${variant})` : ""} x${item.quantity}: ${item.lineTotal.toFixed(2)} EGP`;
  }),
  "",
  `Subtotal: ${Number(invoice.totals?.subtotal || 0).toFixed(2)} EGP`,
  `Discount: ${Number(invoice.totals?.discount || 0).toFixed(2)} EGP`,
  `Shipping: ${Number(invoice.totals?.shipping || 0).toFixed(2)} EGP`,
  `Total: ${Number(invoice.totals?.grandTotal || 0).toFixed(2)} EGP`,
  invoice.publicUrl ? `Invoice link: ${invoice.publicUrl}` : "",
].filter(Boolean).join("\n");
