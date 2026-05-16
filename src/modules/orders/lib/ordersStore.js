export { formatCurrency } from "../../../shared/lib/currency";

const ORDERS_META_KEY = "erp.orders.meta";
const RETURNS_KEY = "erp.orders.returns";

export const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Paid",
  "Partially Paid",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Returned",
  "Refunded",
];

export const SHIPPING_STATUSES = [
  "Pending",
  "Packed",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Returned",
];

const safeWindow = () =>
  typeof window !== "undefined" ? window : null;

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;
  try {
    const value = win.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.setItem(key, JSON.stringify(value));
};

export const formatDateTime = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const getOrderMeta = (orderId) => readJson(ORDERS_META_KEY, {})[String(orderId)] || {};

export const upsertOrderMeta = (orderId, patch) => {
  const meta = readJson(ORDERS_META_KEY, {});
  const current = meta[String(orderId)] || {};
  const next = {
    ...meta,
    [String(orderId)]: {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
  writeJson(ORDERS_META_KEY, next);
  return next[String(orderId)];
};

export const getReturns = () => readJson(RETURNS_KEY, []);

export const addReturnRecord = (record) => {
  const items = getReturns();
  const next = [{ ...record, id: `ret-${Date.now()}` }, ...items];
  writeJson(RETURNS_KEY, next);
  return next[0];
};

export const normalizeOrder = (order, details = {}) => {
  const meta = getOrderMeta(order.id);
  const total = Number(order.total_price ?? order.total ?? details.total ?? 0);
  const status = order.status || details.status || meta.status || "Pending";
  const paymentStatus =
    order.payment_status ||
    meta.paymentStatus ||
    (status === "Paid" ? "Paid" : status === "Partially Paid" ? "Partially Paid" : "Unpaid");

  return {
    ...order,
    ...details,
    total,
    status,
    paymentStatus,
    customer_name: order.customer_name || details.customer_name || meta.customer_name || "Walk-in Customer",
    customer_phone: order.customer_phone || details.customer_phone || meta.customer_phone || "",
    channel: meta.channel || order.source || order.channel || "POS",
    source: meta.source || order.source || order.channel || "POS",
    customer_type: order.customer_type || meta.customer_type || "",
    customer_address: order.customer_address || "",
    governorate: order.governorate || "",
    city_area: order.city_area || "",
    landmark: order.landmark || "",
    delivery_notes: meta.delivery_notes || order.delivery_notes || "",
    order_notes: order.order_notes || "",
    delivery_fee: Number(order.delivery_fee ?? order.shipping_fee ?? 0),
    cod_amount: Number(order.cod_amount || 0),
    branch: meta.branch || order.branch || "Main",
    notes: meta.notes || order.notes || "",
    shipping_provider: meta.shipping_provider || order.shipping_provider || "",
    shipping_status: meta.shipping_status || order.shipping_status || order.delivery_status || "Pending",
    shipment_id: order.shipment_id || "",
    tracking_number: meta.tracking_number || order.tracking_number || "",
    tracking_url: order.tracking_url || "",
    courier_notes: order.courier_notes || "",
    shipping_fee: Number(meta.shipping_fee ?? order.shipping_fee ?? order.delivery_fee ?? 0),
    payment_method: order.payment_method || meta.payment_method || "",
    shipping_payment_method: order.shipping_payment_method || meta.shipping_payment_method || "",
    shipping_payment_screenshot: order.shipping_payment_screenshot || "",
    shipping_payment_reference: order.shipping_payment_reference || "",
    shipping_payment_verified_at: order.shipping_payment_verified_at || null,
    shipping_payment_verified_by: order.shipping_payment_verified_by || null,
    invoice_number:
      meta.invoice_number ||
      order.invoice_number ||
      `INV-${String(order.id).padStart(6, "0")}`,
    items: Array.isArray(details.items) ? details.items : Array.isArray(order.items) ? order.items : [],
  };
};

export const buildTimeline = (order) => {
  const timeline = [
    {
      label: "Order created",
      at: order.created_at || new Date().toISOString(),
      tone: "emerald",
    },
  ];

  if (order.notes) {
    timeline.push({
      label: "Notes updated",
      at: new Date().toISOString(),
      tone: "blue",
    });
  }

  if (order.shipping_provider || order.tracking_number) {
    timeline.push({
      label: "Shipping configured",
      at: new Date().toISOString(),
      tone: "amber",
    });
  }

  if (Array.isArray(order.timeline)) {
    timeline.push(...order.timeline);
  }

  return timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
};

export const deriveKpis = (orders) => {
  const totalOrders = orders.length;
  const paid = orders.filter((order) => order.paymentStatus === "Paid").length;
  const pending = orders.filter((order) => order.status === "Pending").length;
  const returned = orders.filter(
    (order) => order.status === "Returned" || order.paymentStatus === "Refunded"
  ).length;
  const revenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  return { totalOrders, paid, pending, returned, revenue };
};

export const buildSearchText = (order) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemText = items
    .map(
      (item) =>
        `${item.name || ""} ${item.product_name || ""} ${item.sku || ""} ${item.barcode || ""} ${item.color || ""} ${item.size || ""}`
    )
    .join(" ");

  return [
    order.invoice_number,
    order.id,
    order.customer_name,
    order.customer_phone,
    order.status,
    order.paymentStatus,
    order.channel,
    order.branch,
    itemText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

export const mockOrders = () => {
  const now = Date.now();
  return [
    normalizeOrder(
      {
        id: 10021,
        customer_name: "Ayman Khaled",
        customer_phone: "+20 100 123 0001",
        total_price: 1420,
        status: "Paid",
        created_at: new Date(now - 1000 * 60 * 60 * 4).toISOString(),
      },
      {
        items: [
          {
            id: 1,
            name: "Running Shoe Pro",
            sku: "RUN-1021",
            color: "Black",
            size: "42",
            quantity: 1,
            price: 1420,
          },
        ],
      }
    ),
    normalizeOrder(
      {
        id: 10022,
        customer_name: "Mona Saad",
        customer_phone: "+20 101 555 2200",
        total_price: 890,
        status: "Pending",
        created_at: new Date(now - 1000 * 60 * 60 * 12).toISOString(),
      },
      {
        items: [
          {
            id: 2,
            name: "Classic Tee",
            sku: "TEE-0048",
            color: "White",
            size: "L",
            quantity: 2,
            price: 445,
          },
        ],
      }
    ),
    normalizeOrder(
      {
        id: 10023,
        customer_name: "Omar Hassan",
        customer_phone: "+20 102 777 7788",
        total_price: 2380,
        status: "Shipped",
        created_at: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
      },
      {
        items: [
          {
            id: 3,
            name: "Training Set",
            sku: "TRN-7712",
            color: "Navy",
            size: "M",
            quantity: 1,
            price: 2380,
          },
        ],
      }
    ),
  ];
};
