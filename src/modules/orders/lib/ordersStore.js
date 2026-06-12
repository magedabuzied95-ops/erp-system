export { formatCurrency } from "../../../shared/lib/currency";
import { displayPublicOrderNumber } from "../../../shared/utils/publicOrderNumber";
import {
  ORDER_LIFECYCLE_STATUSES,
  SHIPPING_LIFECYCLE_STATUSES,
  normalizeOrderLifecycleStatus,
  normalizeShippingLifecycleStatus,
} from "../../../../shared/orderStatus.js";

const ORDERS_META_KEY = "erp.orders.meta";
const RETURNS_KEY = "erp.orders.returns";

export const ORDER_STATUSES = ORDER_LIFECYCLE_STATUSES;

export const SHIPPING_STATUSES = SHIPPING_LIFECYCLE_STATUSES;

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
  if (!value) return "-";
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

const normalizePaymentStatusLabel = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (["paid", "shipping_paid", "confirmed", "approved"].includes(normalized)) return "مدفوع";
  if (["partially_paid", "partially paid", "partial"].includes(normalized)) return "مدفوع جزئياً";
  if (normalized === "awaiting_verification") return "بانتظار المراجعة";
  if (["refunded", "refund", "fully_refunded"].includes(normalized)) return "مسترد";
  if (["partially_refunded", "partially refunded", "partial_refund"].includes(normalized)) return "مسترد جزئياً";
  if (normalized === "rejected") return "مرفوض";
  if (normalized === "cod") return "COD";
  if (normalized === "unpaid") return "غير مدفوع";
  return value;
};

const normalizeComparable = (value = "") => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export const RETURNED_ORDER_STATUS_KEYS = [
  "returned",
  "refunded",
  "fully_refunded",
  "partially_refunded",
  "partial_refund",
  "return_completed",
  "completed_return",
  "return_requested",
  "refund_requested",
];

export const isReturnedOrRefundedOrder = (order = {}) => {
  const values = [
    order.status,
    order.payment_status,
    order.paymentStatus,
    order.return_status,
    order.refund_status,
    order.transfer_proof_status,
  ].map(normalizeComparable);
  const hasReturnStatus = values.some((value) => RETURNED_ORDER_STATUS_KEYS.includes(value));
  const hasReturnTimestamp = Boolean(order.returned_at || order.refunded_at || order.refund_completed_at || order.return_completed_at);
  const hasRefundAmount = Number(order.refund_amount || order.refunded_amount || order.total_refund_amount || 0) > 0;
  const hasReturnedItems = Array.isArray(order.items) && order.items.some((item) => Number(item.returned_quantity || item.refunded_quantity || 0) > 0);
  return hasReturnStatus || hasReturnTimestamp || hasRefundAmount || hasReturnedItems;
};

export const getReturnedOrders = (orders = []) => orders.filter(isReturnedOrRefundedOrder);

export const getReturnedOrdersCount = (orders = []) => getReturnedOrders(orders).length;

export const getReturns = () => readJson(RETURNS_KEY, []);

export const addReturnRecord = (record) => {
  const items = getReturns();
  const next = [{ ...record, id: `ret-${Date.now()}` }, ...items];
  writeJson(RETURNS_KEY, next);
  return next[0];
};

export const updateReturnRecord = (returnId, patch) => {
  const items = getReturns();
  const next = items.map((item) => (
    String(item.id) === String(returnId)
      ? { ...item, ...patch, id: item.id, updatedAt: new Date().toISOString() }
      : item
  ));
  writeJson(RETURNS_KEY, next);
  return next.find((item) => String(item.id) === String(returnId)) || null;
};

export const deleteReturnRecord = (returnId) => {
  const items = getReturns();
  const next = items.filter((item) => String(item.id) !== String(returnId));
  writeJson(RETURNS_KEY, next);
  return next;
};

export const normalizeOrder = (order, details = {}) => {
  const meta = getOrderMeta(order.id);
  const total = Number(order.total_price ?? order.total_amount ?? order.total ?? details.total ?? details.total_amount ?? 0);
  const items = Array.isArray(details.items) ? details.items : Array.isArray(order.items) ? order.items : [];
  const totalQuantity = Number(
    order.total_quantity ??
    order.total_items ??
    order.item_count ??
    details.total_quantity ??
    details.total_items ??
    details.item_count ??
    items.reduce((sum, item) => sum + Number(item.quantity || item.qty || 0), 0)
  );
  const paidAmount = Number(order.paid_amount ?? order.amount_paid ?? order.payment_paid_amount ?? order.total_paid ?? details.paid_amount ?? details.amount_paid ?? 0);
  const status = normalizeOrderLifecycleStatus(order.status || details.status || meta.status, "pending");
  const paymentStatus =
    normalizePaymentStatusLabel(
      order.payment_status ||
      meta.paymentStatus ||
      (status === "Paid" ? "Paid" : status === "Partially Paid" ? "Partially Paid" : "Unpaid")
    );

  return {
    ...order,
    ...details,
    total,
    status,
    paymentStatus,
    customer_name: order.customer_name || details.customer_name || meta.customer_name || "عميل متجول",
    customer_phone: order.customer_phone || order.phone || order.customer?.phone || details.customer_phone || details.phone || meta.customer_phone || "",
    phone: order.phone || order.customer_phone || order.customer?.phone || details.phone || details.customer_phone || "",
    total_quantity: totalQuantity,
    total_items: totalQuantity,
    item_count: totalQuantity,
    paid_amount: paidAmount,
    amount_paid: paidAmount,
    payment_paid_amount: paidAmount,
    total_paid: paidAmount,
    payment_method: order.payment_method || order.paymentMethod || meta.payment_method || "",
    payment_type: order.payment_type || order.paymentType || "",
    cash_amount: Number(order.cash_amount ?? order.cashAmount ?? details.cash_amount ?? 0),
    card_amount: Number(order.card_amount ?? order.cardAmount ?? details.card_amount ?? 0),
    wallet_payment_amount: Number(order.wallet_payment_amount ?? order.wallet_amount ?? order.walletAmount ?? details.wallet_payment_amount ?? 0),
    sales_employee_name: order.sales_employee_name || details.sales_employee_name || "",
    seller_name: order.seller_name || details.seller_name || "",
    salesperson_name: order.salesperson_name || details.salesperson_name || "",
    assigned_seller_name: order.assigned_seller_name || details.assigned_seller_name || "",
    channel: meta.channel || order.source || order.channel || "نقطة البيع",
    source: meta.source || order.source || order.channel || "نقطة البيع",
    customer_type: order.customer_type || meta.customer_type || "",
    customer_address: order.customer_address || "",
    governorate: order.governorate || "",
    city_area: order.city_area || "",
    landmark: order.landmark || "",
    street_address: order.street_address || "",
    building_number: order.building_number || "",
    floor_number: order.floor_number || "",
    apartment_number: order.apartment_number || "",
    delivery_notes: meta.delivery_notes || order.delivery_notes || "",
    order_notes: order.order_notes || "",
    delivery_fee: Number(order.delivery_fee ?? order.shipping_fee ?? 0),
    cod_amount: Number(order.cod_amount || 0),
    branch: meta.branch || order.branch || "الرئيسية",
    notes: meta.notes || order.notes || "",
    shipping_provider: meta.shipping_provider || order.shipping_provider || "",
    shipping_provider_id: order.shipping_provider_id || meta.shipping_provider_id || order.shipping_provider || "",
    shipping_city_id: order.shipping_city_id || order.city_id || "",
    shipping_zone_id: order.shipping_zone_id || "",
    shipping_district_id: order.shipping_district_id || order.area_id || "",
    shipping_address_line: order.shipping_address_line || order.customer_address || "",
    shipping_provider_delivery_id: order.shipping_provider_delivery_id || order.shipment_id || "",
    shipping_label_url: order.shipping_label_url || "",
    shipping_cost: Number(order.shipping_cost ?? order.shipping_fee ?? order.delivery_fee ?? 0),
    shipping_status: normalizeShippingLifecycleStatus(meta.shipping_status || order.shipment_status || order.shipping_status || order.delivery_status, "pending"),
    shipment_status: normalizeShippingLifecycleStatus(meta.shipment_status || order.shipment_status || order.shipping_status || order.delivery_status, "pending"),
    shipment_id: order.shipment_id || "",
    tracking_number: meta.tracking_number || order.shipping_tracking_number || order.tracking_number || "",
    tracking_url: order.tracking_url || "",
    courier_notes: order.courier_notes || "",
    shipment_timeline: Array.isArray(order.shipment_timeline) ? order.shipment_timeline : [],
    shipping_fee: Number(meta.shipping_fee ?? order.shipping_fee ?? order.delivery_fee ?? 0),
    shipping_payment_method: order.shipping_payment_method || meta.shipping_payment_method || "",
    shipping_payment_screenshot: order.shipping_payment_screenshot || order.payment_proof_url || order.shipping_proof_url || order.proof_image_url || order.payment_screenshot_url || "",
    payment_proof_url: order.payment_proof_url || order.shipping_payment_screenshot || order.shipping_proof_url || order.proof_image_url || order.payment_screenshot_url || "",
    shipping_proof_url: order.shipping_proof_url || order.shipping_payment_screenshot || order.payment_proof_url || order.proof_image_url || order.payment_screenshot_url || "",
    proof_image_url: order.proof_image_url || order.shipping_payment_screenshot || order.payment_proof_url || order.shipping_proof_url || order.payment_screenshot_url || "",
    payment_screenshot_url: order.payment_screenshot_url || order.shipping_payment_screenshot || order.payment_proof_url || order.shipping_proof_url || order.proof_image_url || "",
    shipping_payment_reference: order.shipping_payment_reference || "",
    transfer_proof_status: order.transfer_proof_status || "",
    shipping_payment_verified_at: order.shipping_payment_verified_at || null,
    shipping_payment_verified_by: order.shipping_payment_verified_by || null,
    invoice_number:
      meta.invoice_number ||
      order.invoice_number ||
      `INV-${order.id}`,
    public_order_number: displayPublicOrderNumber(order),
    display_order_number: displayPublicOrderNumber(order),
    items,
  };
};

export const buildTimeline = (order) => {
  const timeline = [
    {
      label: "تم إنشاء الطلب",
      at: order.created_at || new Date().toISOString(),
      tone: "emerald",
    },
  ];

  if (order.notes) {
    timeline.push({
      label: "تم تحديث الملاحظات",
      at: new Date().toISOString(),
      tone: "blue",
    });
  }

  if (order.shipping_provider || order.tracking_number) {
    timeline.push({
      label: "تم إعداد الشحن",
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
  const returned = getReturnedOrdersCount(orders);
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
    order.public_order_number,
    order.display_order_number,
    order.id,
    order.customer_name,
    order.customer_phone,
    order.phone,
    order.sales_employee_name,
    order.seller_name,
    order.salesperson_name,
    order.assigned_seller_name,
    order.status,
    order.paymentStatus,
    order.payment_status,
    order.payment_method,
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
        paid_amount: 1420,
        payment_method: "cash",
        cash_amount: 1420,
        sales_employee_name: "POS Seller",
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
        paid_amount: 300,
        payment_status: "partially_paid",
        payment_method: "split",
        cash_amount: 150,
        card_amount: 150,
        seller_name: "Floor Seller",
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
        paid_amount: 0,
        payment_status: "deferred",
        payment_method: "credit",
        salesperson_name: "Credit Seller",
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
