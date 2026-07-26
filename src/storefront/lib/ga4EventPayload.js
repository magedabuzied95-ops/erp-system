const text = (value = "") => String(value ?? "").trim();
const numberValue = (value = 0) => {
  const parsed = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const quantityValue = (value = 1) => Math.max(1, Math.floor(Number(value || 1) || 1));

export const ga4ItemId = (product = {}, variant = {}) => {
  const productId = text(product.product_id || product.productId || product.id);
  const variantId = text(variant.variant_id || variant.variantId || variant.id);
  return productId && variantId ? `${productId}-${variantId}` : productId;
};

export const ga4CustomerPrice = ({ product = {}, variant = {}, line = null, value = null } = {}) =>
  numberValue(
    value ??
      line?.price ??
      line?.unit_price ??
      line?.selling_price ??
      variant.display_price ??
      variant.final_price ??
      variant.selling_price ??
      variant.price ??
      product.display_price ??
      product.final_price ??
      product.selling_price ??
      product.price
  );

export const buildGa4Item = ({ product = {}, variant = {}, line = null, quantity = 1, price = null, index = null } = {}) => {
  const safeLine = line || {};
  const safeProduct = product && typeof product === "object" ? product : {};
  const safeVariant = variant && typeof variant === "object" ? variant : {};
  const itemId = ga4ItemId(
    { ...safeProduct, product_id: safeLine.product_id || safeProduct.product_id || safeProduct.id },
    { ...safeVariant, variant_id: safeLine.variant_id || safeVariant.variant_id || safeVariant.id }
  );
  if (!itemId) return null;
  const color = text(safeLine.color || safeVariant.color || safeVariant.color_name);
  const size = text(safeLine.size || safeVariant.size);
  const brand = text(
    safeLine.brand ||
      safeLine.brand_name ||
      safeVariant.brand ||
      safeVariant.brand_name ||
      safeProduct.brand?.name ||
      safeProduct.brand_name ||
      safeProduct.brand
  );
  const category = text(
    safeLine.category ||
      safeLine.category_name ||
      safeVariant.category_name ||
      safeProduct.category?.name ||
      safeProduct.category_name ||
      safeProduct.product_type
  );
  const item = {
    item_id: itemId,
    item_name: text(safeLine.name || safeLine.product_name || safeProduct.name || safeProduct.product_name || safeProduct.title) || itemId,
    price: ga4CustomerPrice({ product: safeProduct, variant: safeVariant, line: safeLine, value: price }),
    quantity: quantityValue(safeLine.quantity || safeLine.qty || quantity),
  };
  if (brand) item.item_brand = brand;
  if (category) item.item_category = category;
  if (color || size) item.item_variant = [color, size].filter(Boolean).join(" / ");
  if (color) item.item_color = color;
  if (size) item.item_size = size;
  if (Number.isInteger(index) && index >= 0) item.index = index;
  return item;
};

export const buildGa4Items = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((line, index) =>
      buildGa4Item({
        product: line?.product || line,
        variant: line?.variant || line?.selected_variant || line,
        line,
        quantity: line?.quantity || line?.qty,
        index,
      })
    )
    .filter(Boolean);

export const ga4CartPayload = (items = [], extras = {}) => {
  const normalizedItems = buildGa4Items(items);
  const itemValue = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    currency: "EGP",
    value: numberValue(extras.value ?? itemValue),
    items: normalizedItems,
    ...(text(extras.coupon) ? { coupon: text(extras.coupon) } : {}),
  };
};

export const ga4OrderId = (order = {}) =>
  text(order.id || order.order_id || order.invoice_number || order.order_number || order.public_order_number);

export const isGa4PurchaseEligible = (order = {}) => {
  const orderId = ga4OrderId(order);
  const status = text(order.status || order.order_status || order.payment_status).toLowerCase();
  const blocked = ["cancelled", "canceled", "failed", "payment_failed", "draft", "incomplete", "abandoned"];
  return Boolean(orderId && !blocked.includes(status));
};

export const buildGa4PurchasePayload = ({ order = {}, items = [], checkout = {}, value = null } = {}) => {
  if (!isGa4PurchaseEligible(order)) return null;
  const normalizedItems = buildGa4Items(items);
  if (!normalizedItems.length) return null;
  const itemsValue = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = numberValue(value ?? order.total_amount ?? order.total ?? order.total_price ?? checkout.total ?? itemsValue);
  if (!(total > 0)) return null;
  const shipping = numberValue(
    order.shipping_fee ??
      order.shipping_cost ??
      order.delivery_fee ??
      checkout.shipping_fee ??
      checkout.shipping_cost ??
      checkout.delivery_fee
  );
  const coupon = text(order.coupon_code || order.coupon || checkout.coupon_code || checkout.coupon);
  return {
    transaction_id: ga4OrderId(order),
    value: total,
    currency: "EGP",
    shipping,
    ...(coupon ? { coupon } : {}),
    items: normalizedItems,
  };
};
